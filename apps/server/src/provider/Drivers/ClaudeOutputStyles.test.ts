import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { prepareClaudeOutputStyle } from "./ClaudeOutputStyles.ts";

const withTempStateDir = <A, E, R>(
  use: (stateDir: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-output-styles-test-" });
      return yield* use(stateDir);
    }),
  ) as Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path>;

it.layer(NodeServices.layer)("ClaudeOutputStyles", (it) => {
  describe("prepareClaudeOutputStyle", () => {
    it.effect("passes named styles through without touching disk", () =>
      withTempStateDir((stateDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const prepared = yield* prepareClaudeOutputStyle({
            styleName: "Explanatory",
            stateDir,
          });
          expect(prepared).toEqual({ outputStyle: "Explanatory" });
          const path = yield* Path.Path;
          expect(yield* fs.exists(path.join(stateDir, "claude-output-styles"))).toBe(false);
        }),
      ),
    );

    it.effect("returns null for blank names", () =>
      withTempStateDir((stateDir) =>
        Effect.gen(function* () {
          expect(yield* prepareClaudeOutputStyle({ styleName: "   ", stateDir })).toBeNull();
        }),
      ),
    );

    it.effect("materializes custom styles as a local plugin", () =>
      withTempStateDir((stateDir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const prepared = yield* prepareClaudeOutputStyle({
            styleName: "My Fancy Style",
            styleContent: "Respond in haiku form only.",
            stateDir,
          });
          expect(prepared?.outputStyle).toBe("t3-output-styles:My Fancy Style");
          expect(prepared?.pluginPath).toBeDefined();
          const pluginPath = prepared?.pluginPath ?? "";

          const manifest = JSON.parse(
            yield* fs.readFileString(path.join(pluginPath, ".claude-plugin", "plugin.json")),
          ) as { name: string };
          expect(manifest.name).toBe("t3-output-styles");

          const styleDocument = yield* fs.readFileString(
            path.join(pluginPath, "output-styles", "my-fancy-style.md"),
          );
          expect(styleDocument).toContain("name: My Fancy Style");
          expect(styleDocument).toContain("Respond in haiku form only.");
        }),
      ),
    );

    it.effect("content-addresses the plugin dir and reuses it across turns", () =>
      withTempStateDir((stateDir) =>
        Effect.gen(function* () {
          const input = {
            styleName: "Concise",
            styleContent: "Keep it short.",
            stateDir,
          };
          const first = yield* prepareClaudeOutputStyle(input);
          const second = yield* prepareClaudeOutputStyle(input);
          expect(first).toEqual(second);

          const changed = yield* prepareClaudeOutputStyle({
            ...input,
            styleContent: "Keep it very short.",
          });
          expect(changed?.pluginPath).not.toBe(first?.pluginPath);
        }),
      ),
    );

    it.effect("sanitizes YAML-hostile characters out of the style name", () =>
      withTempStateDir((stateDir) =>
        Effect.gen(function* () {
          const prepared = yield* prepareClaudeOutputStyle({
            styleName: 'Weird: "Name"\nInjected',
            styleContent: "Body",
            stateDir,
          });
          expect(prepared?.outputStyle).toBe("t3-output-styles:Weird Name Injected");
        }),
      ),
    );
  });
});
