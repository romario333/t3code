import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";

/**
 * `-i` blocks idle sleep, `-m` disk sleep, `-s` system sleep on AC power; the display may sleep.
 * `-w` ends caffeinate with the server, so a killed server cannot pin the Mac awake.
 */
export const caffeinateArgs = (serverPid: number): ReadonlyArray<string> => [
  "-ims",
  "-w",
  String(serverPid),
];

const RESPAWN_DELAY = "5 seconds";

/** Holds `caffeinate` for as long as the `keepAwake` setting is on, whether or not agents work. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if ((yield* HostProcess.Platform) !== "darwin") return;
    const settings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const hold = Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("caffeinate", caffeinateArgs(process.pid)),
        );
        yield* Effect.logInfo("always-awake holding caffeinate", { pid: Number(child.pid) });
        const code = yield* child.exitCode;
        yield* Effect.logWarning("always-awake caffeinate exited", { code: Number(code) });
      }),
    ).pipe(
      Effect.catchCause((cause) => Effect.logWarning("always-awake caffeinate failed", { cause })),
      Effect.andThen(Effect.sleep(RESPAWN_DELAY)),
      Effect.forever,
    );

    const enabled = Stream.unwrap(
      Effect.gen(function* () {
        const changes = yield* settings.subscribeChanges;
        const current = yield* settings.getSettings.pipe(
          Effect.map((value) => value.keepAwake),
          Effect.orElseSucceed(() => false),
        );
        return Stream.concat(
          Stream.succeed(current),
          Stream.map(changes, (value) => value.keepAwake),
        );
      }),
    );

    yield* forkParked(
      enabled.pipe(
        Stream.changes,
        Stream.switchMap((on) => (on ? Stream.fromEffect(hold) : Stream.empty)),
        Stream.runDrain,
        Effect.catchCause((cause) => Effect.logWarning("always-awake stopped", { cause })),
      ),
    );
  }),
);
