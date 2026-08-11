import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export {
  CLAUDE_OUTPUT_STYLE_CONTENT_OPTION_ID,
  CLAUDE_OUTPUT_STYLE_OPTION_ID,
} from "@t3tools/shared/outputStyles";

/**
 * Plugin name for the ephemeral local plugin that carries custom output
 * styles. Claude Code resolves plugin-provided styles under
 * `<plugin-name>:<style-name>`.
 */
const OUTPUT_STYLE_PLUGIN_NAME = "t3-output-styles";

export type ClaudeOutputStylePreparation = {
  /** Value for `settings.outputStyle` in the Claude query options. */
  readonly outputStyle: string;
  /** Local plugin directory to pass via `plugins` when the style is custom. */
  readonly pluginPath?: string;
};

/**
 * Frontmatter names must survive a YAML round-trip and later match the
 * `settings.outputStyle` reference verbatim, so keep them single-line and
 * free of YAML-significant characters.
 */
function sanitizeStyleName(name: string): string {
  return name
    .replace(/[\r\n:"'#{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function styleFileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "custom-style";
}

/**
 * Resolve a per-turn output-style selection into Claude query inputs.
 *
 * Named styles pass straight through as `settings.outputStyle`. Custom styles
 * (name + markdown content) are materialized on disk as a minimal local
 * plugin whose `output-styles/` directory holds the style, because that is
 * the only way to hand Claude Code a style body without touching the user's
 * `~/.claude` or the project checkout. The directory is content-addressed so
 * repeated turns with the same style reuse it without rewrites.
 */
export const prepareClaudeOutputStyle = Effect.fn("prepareClaudeOutputStyle")(function* (input: {
  readonly styleName: string;
  readonly styleContent?: string | undefined;
  readonly stateDir: string;
}): Effect.fn.Return<
  ClaudeOutputStylePreparation | null,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const name = sanitizeStyleName(input.styleName);
  if (name.length === 0) {
    return null;
  }
  const content = input.styleContent?.trim();
  if (content === undefined || content.length === 0) {
    return { outputStyle: name };
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const digest = NodeCrypto.createHash("sha256")
    .update(`${name}\0${content}`)
    .digest("hex")
    .slice(0, 16);
  const pluginPath = path.join(input.stateDir, "claude-output-styles", digest);
  const stylePath = path.join(pluginPath, "output-styles", `${styleFileSlug(name)}.md`);
  const manifestPath = path.join(pluginPath, ".claude-plugin", "plugin.json");

  const styleDocument = [
    "---",
    `name: ${name}`,
    "description: Custom output style configured in T3 Code.",
    "---",
    "",
    content,
    "",
  ].join("\n");
  const manifest = `${JSON.stringify(
    {
      name: OUTPUT_STYLE_PLUGIN_NAME,
      description: "Ephemeral T3 Code plugin carrying a custom output style.",
      version: "0.0.1",
    },
    null,
    2,
  )}\n`;

  const written = yield* Effect.gen(function* () {
    if (yield* fs.exists(stylePath)) {
      return true;
    }
    yield* fs.makeDirectory(path.dirname(manifestPath), { recursive: true });
    yield* fs.makeDirectory(path.dirname(stylePath), { recursive: true });
    yield* fs.writeFileString(manifestPath, manifest);
    yield* fs.writeFileString(stylePath, styleDocument);
    return true;
  }).pipe(
    // A style that fails to materialize should degrade to no style rather
    // than failing the turn.
    Effect.catchCause(() => Effect.succeed(false)),
  );

  if (!written) {
    return null;
  }

  return {
    outputStyle: `${OUTPUT_STYLE_PLUGIN_NAME}:${name}`,
    pluginPath,
  };
});
