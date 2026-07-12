/**
 * KeepAwake - keeps the host machine awake while the global `keepAwake`
 * server setting is enabled by holding a long-lived `caffeinate` child
 * process. macOS only; the layer is a no-op on other hosts.
 *
 * The layer reconciles against `ServerSettingsService`: it applies the
 * persisted value on startup and follows `streamChanges` afterwards, so
 * toggling the setting from any client (or editing the settings file)
 * starts or stops `caffeinate` immediately.
 *
 * @module keepAwake
 */
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { ServerSettingsService } from "./serverSettings.ts";

/**
 * `-i` blocks idle system sleep, `-m` blocks disk sleep, `-s` blocks system
 * sleep while on AC power. The display is deliberately left free to sleep.
 * `-w` ties the assertion to the server process so caffeinate exits on its own
 * if the server dies without running finalizers (a plain kill would otherwise
 * orphan it and pin the machine awake).
 */
export const caffeinateArgs = (serverPid: number): ReadonlyArray<string> => [
  "-ims",
  "-w",
  String(serverPid),
];

/** Backoff before respawning caffeinate after an unexpected exit or spawn failure. */
const RESPAWN_DELAY = "5 seconds";

const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  if (platform !== "darwin") {
    return;
  }

  const serverSettings = yield* ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  // Runs for as long as keep-awake stays enabled: holds a caffeinate child
  // (killed via the inner scope on interruption) and respawns it, after a
  // delay, if it exits underneath us or fails to spawn.
  const holdCaffeinate = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("caffeinate", caffeinateArgs(process.pid)),
      );
      yield* Effect.logInfo("Keep awake enabled: caffeinate started", { pid: handle.pid });
      const code = yield* handle.exitCode;
      yield* Effect.logWarning("caffeinate exited while keep awake is enabled", { code });
    }),
  ).pipe(
    Effect.catchCause((cause) => Effect.logWarning("Keep awake caffeinate failed", cause)),
    Effect.andThen(Effect.sleep(RESPAWN_DELAY)),
    Effect.forever,
  );

  const activeFiber = yield* Ref.make<Fiber.Fiber<unknown, unknown> | null>(null);

  // Called sequentially from a single watcher fiber, so read-then-set on the
  // Ref is race-free. The hold fiber attaches to the layer scope, keeping
  // caffeinate alive across reconciles and killing it on server shutdown.
  const reconcile = (keepAwake: boolean) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(activeFiber);
      if (keepAwake && current === null) {
        yield* Ref.set(activeFiber, yield* Effect.forkScoped(holdCaffeinate));
      } else if (!keepAwake && current !== null) {
        yield* Ref.set(activeFiber, null);
        yield* Fiber.interrupt(current);
        yield* Effect.logInfo("Keep awake disabled: caffeinate stopped");
      }
    });

  yield* serverSettings.getSettings.pipe(
    Effect.flatMap((settings) => reconcile(settings.keepAwake)),
    Effect.andThen(
      Stream.runForEach(serverSettings.streamChanges, (settings) => reconcile(settings.keepAwake)),
    ),
    Effect.catchCause((cause) => Effect.logError("Keep awake settings watcher failed", cause)),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(make);
