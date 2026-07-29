import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type { FileDiffMetadata } from "@pierre/diffs/types";

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES];

export function resolveDiffThemeName(theme: "light" | "dark"): DiffThemeName {
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

/** Diff line tints modelled on VS Code's diff editor.
 *
 *  The renderer normally tints a changed line by mixing the change color into
 *  the surface at 12% (light) / 20% (dark), which is close to invisible on our
 *  near-white and near-black diff surfaces. Pinning that mix to 0% turns the
 *  `*-override` colors below into the literal line background, and keeping them
 *  translucent lets one palette composite correctly over both themes — the same
 *  way VS Code layers `diffEditor.insertedLineBackground` (#9bb955) and
 *  `diffEditor.removedLineBackground` (#ff0000) over the editor background.
 *
 *  Pass to a diff/code view as `options.unsafeCSS` (concatenate with any
 *  view-specific CSS) so every diff surface in the app tints alike. */
export const DIFF_COLOR_UNSAFE_CSS = `
:host {
  --diffs-bg-addition-override: rgb(155 185 85 / 0.27);
  --diffs-bg-addition-number-override: rgb(155 185 85 / 0.35);
  --diffs-bg-addition-emphasis-override: rgb(156 204 44 / 0.28);

  --diffs-bg-deletion-override: rgb(255 0 0 / 0.2);
  --diffs-bg-deletion-number-override: rgb(255 0 0 / 0.27);
  --diffs-bg-deletion-emphasis-override: rgb(255 0 0 / 0.23);

  /* Token backgrounds default to \`inherit\`, which would paint the translucent
     line tint a second time behind every token. */
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
}

:where([data-background])
  :is([data-line], [data-no-newline], [data-gutter-buffer], [data-column-number]) {
  --mix-light: 0%;
  --mix-dark: 0%;
}

/* The renderer's hover tint rides on the same mix, so restore it here. */
@media (pointer: fine) {
  [data-line-type="change-addition"][data-hovered]:is([data-line], [data-no-newline]) {
    --diffs-diff-line-mix-target: rgb(155 185 85 / 0.35);
  }

  [data-line-type="change-addition"][data-hovered]:is([data-gutter-buffer], [data-column-number]) {
    --diffs-diff-line-mix-target: rgb(155 185 85 / 0.48);
  }

  [data-line-type="change-deletion"][data-hovered]:is([data-line], [data-no-newline]) {
    --diffs-diff-line-mix-target: rgb(255 0 0 / 0.27);
  }

  [data-line-type="change-deletion"][data-hovered]:is([data-gutter-buffer], [data-column-number]) {
    --diffs-diff-line-mix-target: rgb(255 0 0 / 0.37);
  }
}
`;

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}

export type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

export interface DiffLineStat {
  additions: number;
  deletions: number;
}

export function getDiffLineStat(files: ReadonlyArray<FileDiffMetadata>): DiffLineStat {
  return files.reduce<DiffLineStat>(
    (total, file) => {
      for (const hunk of file.hunks) {
        total.additions += hunk.additionLines;
        total.deletions += hunk.deletionLines;
      }

      return total;
    },
    { additions: 0, deletions: 0 },
  );
}

interface RenderablePatchOptions {
  /**
   * Pierre's partial-patch parser keeps hunk render starts in source-file
   * coordinates. Its virtualizer iterates partial patches as compact rows, so
   * review diffs need compact render starts while retaining collapsedBefore
   * for the "N unmodified lines" separator.
   */
  compactPartialHunkOffsets?: boolean;
}

export function compactPartialHunkOffsets(file: FileDiffMetadata): FileDiffMetadata {
  if (!file.isPartial) return file;

  let splitLineStart = 0;
  let unifiedLineStart = 0;
  const hunks = file.hunks.map((hunk) => {
    const compactHunk = {
      ...hunk,
      splitLineStart,
      unifiedLineStart,
    };
    splitLineStart += hunk.splitLineCount;
    unifiedLineStart += hunk.unifiedLineCount;
    return compactHunk;
  });

  return {
    ...file,
    hunks,
    splitLineCount: splitLineStart,
    unifiedLineCount: unifiedLineStart,
    ...(file.cacheKey ? { cacheKey: `${file.cacheKey}:compact-partial` } : {}),
  };
}

export function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
  options: RenderablePatchOptions = {},
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) =>
      options.compactPartialHunkOffsets
        ? parsedPatch.files.map(compactPartialHunkOffsets)
        : parsedPatch.files,
    );
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

export function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

export function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function getDiffCollapseIconClassName(fileDiff: FileDiffMetadata): string {
  switch (fileDiff.type) {
    case "new":
      return "text-[var(--diffs-addition-base)]";
    case "deleted":
      return "text-[var(--diffs-deletion-base)]";
    case "change":
    case "rename-pure":
    case "rename-changed":
      return "text-[var(--diffs-modified-base)]";
    default:
      return "text-muted-foreground/80";
  }
}
