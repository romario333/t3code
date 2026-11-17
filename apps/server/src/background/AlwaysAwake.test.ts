import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { ServerSettingsService } from "../serverSettings.ts";
import * as AlwaysAwake from "./AlwaysAwake.ts";

type Transition =
  | { readonly type: "spawned"; readonly command: string; readonly args: ReadonlyArray<string> }
  | { readonly type: "killed" };

const makeHarness = (keepAwake: boolean) =>
  Effect.gen(function* () {
    const transitions = yield* Queue.unbounded<Transition>();
    const subscribed = yield* Deferred.make<void>();
    const changes = yield* PubSub.unbounded<ServerSettings>();
    const initial: ServerSettings = { ...DEFAULT_SERVER_SETTINGS, keepAwake };

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        const { command: name, args } = command as unknown as {
          readonly command: string;
          readonly args: ReadonlyArray<string>;
        };
        yield* Effect.addFinalizer(() => Queue.offer(transitions, { type: "killed" }));
        yield* Queue.offer(transitions, { type: "spawned", command: name, args });
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
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

    const settings: ServerSettingsService["Service"] = {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Effect.succeed(initial),
      updateSettings: () => Effect.succeed(initial),
      updateProviderInstance: () => Effect.succeed(initial),
      withSettingsSnapshot: (use) => use(initial),
      streamChanges: Stream.fromPubSub(changes),
      subscribeChanges: PubSub.subscribe(changes).pipe(
        Effect.tap(() => Deferred.succeed(subscribed, undefined)),
        Effect.map(Stream.fromSubscription),
      ),
    };

    const layer = AlwaysAwake.layer.pipe(
      Layer.provide(Layer.succeed(ServerSettingsService, settings)),
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    );
    const setKeepAwake = (value: boolean) =>
      PubSub.publish(changes, { ...initial, keepAwake: value });
    return { layer, transitions, subscribed, setKeepAwake };
  });

describe("AlwaysAwake", () => {
  it.effect("holds caffeinate while keepAwake is on and kills it when turned off", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(true);
      yield* Layer.build(harness.layer);

      expect(yield* Queue.take(harness.transitions)).toEqual({
        type: "spawned",
        command: "caffeinate",
        args: AlwaysAwake.caffeinateArgs(process.pid),
      });
      yield* Deferred.await(harness.subscribed);
      yield* harness.setKeepAwake(false);
      expect(yield* Queue.take(harness.transitions)).toEqual({ type: "killed" });
      yield* harness.setKeepAwake(true);
      expect((yield* Queue.take(harness.transitions)).type).toBe("spawned");
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "darwin")),
  );

  it.effect("kills caffeinate when the server shuts down", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(true);
      yield* Effect.scoped(
        Layer.build(harness.layer).pipe(Effect.andThen(Queue.take(harness.transitions))),
      );
      expect(yield* Queue.take(harness.transitions)).toEqual({ type: "killed" });
    }).pipe(Effect.provideService(HostProcess.Platform, "darwin")),
  );

  it.effect("does nothing off macOS", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(true);
      yield* Layer.build(harness.layer);
      expect(yield* Queue.size(harness.transitions)).toBe(0);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );
});
