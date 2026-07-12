// @effect-diagnostics nodeBuiltinImport:off - integration test observes real OS processes via pgrep.
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as KeepAwake from "./keepAwake.ts";
import { ServerSettingsService } from "./serverSettings.ts";

const caffeinatePids = (): ReadonlyArray<string> => {
  try {
    const pattern = `caffeinate ${KeepAwake.caffeinateArgs(process.pid).join(" ")}`;
    return NodeChildProcess.execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

const waitFor = (predicate: () => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return true;
      yield* Effect.sleep("50 millis");
    }
    return predicate();
  });

describe("keepAwake end-to-end (darwin only)", () => {
  it.live(
    "spawns and kills a real caffeinate process",
    () =>
      Effect.gen(function* () {
        // Resolves to the real process.platform (Context.Reference default).
        const platform = yield* HostProcessPlatform;
        if (platform !== "darwin") return;

        const changes = yield* PubSub.unbounded<ServerSettings>();
        const settings = yield* Ref.make<ServerSettings>({
          ...DEFAULT_SERVER_SETTINGS,
          keepAwake: false,
        });
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

        // Republishes until the expected process state is observed: the
        // watcher subscribes to the change PubSub asynchronously, so a single
        // publish can race the subscription. Reconciliation is idempotent.
        const toggleUntil = (keepAwake: boolean, predicate: () => boolean) =>
          Effect.gen(function* () {
            for (let attempt = 0; attempt < 100; attempt++) {
              yield* setKeepAwake(keepAwake);
              if (predicate()) return true;
              yield* Effect.sleep("50 millis");
            }
            return predicate();
          });

        expect(caffeinatePids()).toEqual([]);

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(
              KeepAwake.layer.pipe(
                Layer.provide(Layer.succeed(ServerSettingsService, settingsService)),
                Layer.provide(NodeServicesLayer),
              ),
            );
            yield* Effect.yieldNow;
            expect(yield* toggleUntil(true, () => caffeinatePids().length > 0)).toBe(true);
            expect(yield* toggleUntil(false, () => caffeinatePids().length === 0)).toBe(true);
            // Leave keep-awake enabled for the scope-close check.
            expect(yield* toggleUntil(true, () => caffeinatePids().length > 0)).toBe(true);
          }),
        );

        // Scope closed with keep-awake still enabled: caffeinate must die.
        expect(yield* waitFor(() => caffeinatePids().length === 0)).toBe(true);
      }),
    20000,
  );
});
