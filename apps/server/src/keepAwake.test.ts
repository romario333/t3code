import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as KeepAwake from "./keepAwake.ts";
import { ServerSettingsService } from "./serverSettings.ts";

type SpawnRecord = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

// Accesses private properties of ChildProcessCommand for testing purposes
function asSpawnRecord(command: unknown): SpawnRecord {
  return command as SpawnRecord;
}

const makeHarness = (input: { readonly keepAwake: boolean }) =>
  Effect.gen(function* () {
    const spawned = yield* Deferred.make<SpawnRecord>();
    const killed = yield* Deferred.make<void>();
    const spawnCount = yield* Ref.make(0);
    const changes = yield* PubSub.unbounded<ServerSettings>();
    const settings = yield* Ref.make<ServerSettings>({
      ...DEFAULT_SERVER_SETTINGS,
      keepAwake: input.keepAwake,
    });

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        yield* Ref.update(spawnCount, (count) => count + 1);
        yield* Effect.addFinalizer(() => Deferred.succeed(killed, undefined));
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          // caffeinate runs until it is killed. `spawned` resolves from here —
          // not from the spawn effect — so tests only proceed once the service
          // holds a fully set-up child (kill finalizer registered) and is
          // parked awaiting its exit; signalling earlier races scope close
          // against finalizer registration.
          exitCode: Deferred.succeed(spawned, asSpawnRecord(command)).pipe(
            Effect.andThen(Effect.never),
          ),
          isRunning: Effect.succeed(true),
          kill: () => Deferred.succeed(killed, undefined),
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    );

    const settingsService: ServerSettingsService["Service"] = {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Ref.get(settings),
      updateSettings: () => Ref.get(settings),
      get streamChanges() {
        return Stream.fromPubSub(changes);
      },
      get subscribeChanges() {
        return Effect.succeed(Stream.fromPubSub(changes));
      },
    };

    const setKeepAwake = (keepAwake: boolean) =>
      Ref.updateAndGet(settings, (current) => ({ ...current, keepAwake })).pipe(
        Effect.flatMap((next) => PubSub.publish(changes, next)),
      );

    // The watcher subscribes to the change PubSub asynchronously, so a single
    // publish can race the subscription. Reconciliation is idempotent, so the
    // tests republish until the expected effect is observed.
    const publishKeepAwakeUntil = <A>(keepAwake: boolean, done: Deferred.Deferred<A>) =>
      Effect.gen(function* () {
        while (Option.isNone(yield* Deferred.poll(done))) {
          yield* setKeepAwake(keepAwake);
          yield* Effect.yieldNow;
        }
      });

    return {
      spawned,
      killed,
      spawnCount,
      publishKeepAwakeUntil,
      layer: KeepAwake.layer.pipe(
        Layer.provide(Layer.succeed(ServerSettingsService, settingsService)),
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      ),
    };
  });

describe("keepAwake", () => {
  it.live("spawns caffeinate on darwin when enabled at startup", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ keepAwake: true });
      yield* Layer.build(harness.layer);

      const spawn = yield* Deferred.await(harness.spawned);
      expect(spawn.command).toBe("caffeinate");
      expect(spawn.args).toEqual(KeepAwake.caffeinateArgs(process.pid));
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "darwin")),
  );

  it.live("starts and stops caffeinate when the setting is toggled", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ keepAwake: false });
      yield* Layer.build(harness.layer);

      yield* harness.publishKeepAwakeUntil(true, harness.spawned);
      yield* Deferred.await(harness.spawned);

      yield* harness.publishKeepAwakeUntil(false, harness.killed);
      yield* Deferred.await(harness.killed);
      expect(yield* Ref.get(harness.spawnCount)).toBe(1);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "darwin")),
  );

  it.live("kills caffeinate when the layer scope closes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ keepAwake: true });
      yield* Effect.scoped(
        Layer.build(harness.layer).pipe(Effect.andThen(Deferred.await(harness.spawned))),
      );
      yield* Deferred.await(harness.killed);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "darwin")),
  );

  it.live("does nothing on non-darwin hosts", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ keepAwake: true });
      yield* Layer.build(harness.layer);
      yield* Effect.yieldNow;
      expect(yield* Ref.get(harness.spawnCount)).toBe(0);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );
});
