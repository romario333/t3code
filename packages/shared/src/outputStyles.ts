import type { ProviderOptionSelection } from "@t3tools/contracts";

/**
 * Claude Code output-style support.
 *
 * The selected style rides the generic `ModelSelection.options` channel as
 * plain id/value selections, next to effort and fast mode. The name option
 * selects any style Claude Code can resolve itself (built-ins such as
 * "Explanatory", or files under `~/.claude/output-styles/`). Styles authored
 * in the web app exist only in the browser's localStorage, so they also send
 * their markdown body via the content option; the server materializes it for
 * the Claude CLI.
 */
export const CLAUDE_OUTPUT_STYLE_OPTION_ID = "outputStyle";
export const CLAUDE_OUTPUT_STYLE_CONTENT_OPTION_ID = "outputStyleContent";

/**
 * Option ids the composer forwards verbatim on dispatch. Unlike effort or
 * context window, these have no server-declared descriptor (custom styles are
 * client-defined), so the descriptor-driven dispatch path can't rebuild them.
 */
export const CLAUDE_OUTPUT_STYLE_PASSTHROUGH_OPTION_IDS: ReadonlyArray<string> = [
  CLAUDE_OUTPUT_STYLE_OPTION_ID,
  CLAUDE_OUTPUT_STYLE_CONTENT_OPTION_ID,
];

/** Output styles bundled with Claude Code. "Default" is the absence of a style. */
export const CLAUDE_BUILTIN_OUTPUT_STYLES: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
}> = [
  {
    name: "Explanatory",
    description: "Explains its work with educational insights along the way.",
  },
  {
    name: "Learning",
    description: "Collaborative learn-by-doing mode that leaves TODOs for you.",
  },
];

export function getClaudeOutputStyleSelections(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): Array<ProviderOptionSelection> {
  return (selections ?? []).filter(
    (selection) =>
      CLAUDE_OUTPUT_STYLE_PASSTHROUGH_OPTION_IDS.includes(selection.id) &&
      typeof selection.value === "string",
  );
}
