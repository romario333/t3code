import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDiffFileTreeUpdates,
  diffFileTreeEntries,
  orderDiffFilesLikeTree,
  pickListedDiffFile,
} from "./diffFileTree.logic";

function file(type: FileDiffMetadata["type"], name: string, prevName = name): FileDiffMetadata {
  return { type, name, prevName } as FileDiffMetadata;
}

describe("diffFileTreeEntries", () => {
  it("folds a file-to-symlink type change into one modified entry", () => {
    expect(
      diffFileTreeEntries([
        file("change", "CLAUDE.md"),
        file("deleted", "AGENTS.md"),
        file("new", "AGENTS.md"),
        file("new", "docs/new.md"),
      ]),
    ).toEqual([
      { path: "CLAUDE.md", status: "modified" },
      { path: "AGENTS.md", status: "modified" },
      { path: "docs/new.md", status: "added" },
    ]);
  });
});

describe("orderDiffFilesLikeTree", () => {
  it("pulls a test listed last into its directory, keeping the first-seen order", () => {
    expect(
      orderDiffFilesLikeTree([
        file("change", "server/device/Host.ts"),
        file("change", "web/settings.ts"),
        file("change", "server/ws.ts"),
        file("change", "server/device/Host.test.ts"),
        file("change", "web/settings.test.ts"),
      ]).map((entry) => entry.name),
    ).toEqual([
      "server/device/Host.ts",
      "server/device/Host.test.ts",
      "server/ws.ts",
      "web/settings.ts",
      "web/settings.test.ts",
    ]);
  });
});

describe("pickListedDiffFile", () => {
  const paths = ["a.ts", "b.ts", "c.ts"];

  it.each([
    { candidates: ["b.ts", "c.ts"], fallbackIndex: 0, expected: "b.ts" },
    { candidates: ["gone.ts", "c.ts"], fallbackIndex: 0, expected: "c.ts" },
    { candidates: ["gone.ts", null], fallbackIndex: 1, expected: "b.ts" },
    { candidates: [undefined, null], fallbackIndex: 5, expected: "c.ts" },
    { candidates: [undefined, null], fallbackIndex: -1, expected: "a.ts" },
  ])(
    "picks $expected from $candidates at $fallbackIndex",
    ({ candidates, fallbackIndex, expected }) => {
      expect(pickListedDiffFile(paths, candidates, fallbackIndex)).toBe(expected);
    },
  );

  it("picks nothing from an empty list", () => {
    expect(pickListedDiffFile([], ["a.ts"], 0)).toBeNull();
  });
});

describe("buildDiffFileTreeUpdates", () => {
  it("adds a new file's directories before the file", () => {
    expect(buildDiffFileTreeUpdates(["README.md"], ["README.md", "src/lib/a.ts"])).toEqual([
      { type: "add", path: "src/" },
      { type: "add", path: "src/lib/" },
      { type: "add", path: "src/lib/a.ts" },
    ]);
  });

  it("removes files before their now-empty directories, deepest first", () => {
    expect(buildDiffFileTreeUpdates(["src/lib/a.ts", "src/b.ts"], ["src/b.ts"])).toEqual([
      { type: "remove", path: "src/lib/a.ts" },
      { type: "remove", path: "src/lib/", recursive: true },
    ]);
  });
});
