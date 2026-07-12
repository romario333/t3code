import { describe, expect, it } from "vite-plus/test";

import { deriveToolActivityPresentation, extractToolResultOutput } from "./toolActivity.ts";

describe("toolActivity", () => {
  it("normalizes command tools to a stable ran-command label", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "command_execution",
        title: "Terminal",
        detail: "Terminal",
        data: {
          command: "bun run lint",
        },
        fallbackSummary: "Terminal",
      }),
    ).toEqual({
      summary: "Ran command",
      detail: "bun run lint",
    });
  });

  it("uses structured file paths for read-file tools when available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          locations: [{ path: "/tmp/app.ts" }],
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
      detail: "/tmp/app.ts",
    });
  });

  it("drops duplicated generic read-file detail when no path is available", () => {
    expect(
      deriveToolActivityPresentation({
        itemType: "dynamic_tool_call",
        title: "Read File",
        detail: "Read File",
        data: {
          kind: "read",
          rawInput: {},
        },
        fallbackSummary: "Read File",
      }),
    ).toEqual({
      summary: "Read file",
    });
  });
});

describe("extractToolResultOutput", () => {
  it("extracts text from Claude tool_result blocks with string content", () => {
    expect(
      extractToolResultOutput({
        toolName: "Bash",
        input: { command: "ls" },
        result: {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "README.md\npackage.json",
        },
      }),
    ).toBe("README.md\npackage.json");
  });

  it("extracts text from Claude tool_result blocks with content block arrays", () => {
    expect(
      extractToolResultOutput({
        result: {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      }),
    ).toBe("line one\nline two");
  });

  it("extracts stdout and stderr from ACP rawOutput records", () => {
    expect(
      extractToolResultOutput({
        rawOutput: { stdout: "42 tests passed", stderr: "warning: slow test" },
      }),
    ).toBe("42 tests passed\nwarning: slow test");
  });

  it("extracts nested content text from ACP tool call content", () => {
    expect(
      extractToolResultOutput({
        content: [{ type: "content", content: { type: "text", text: "fetched page" } }],
      }),
    ).toBe("fetched page");
  });

  it("extracts aggregated output from Codex command execution items", () => {
    expect(
      extractToolResultOutput({
        item: { type: "commandExecution", command: "ls", aggregatedOutput: "src\ntest" },
      }),
    ).toBe("src\ntest");
  });

  it("returns undefined when no output-like data is present", () => {
    expect(extractToolResultOutput(undefined)).toBeUndefined();
    expect(extractToolResultOutput({ toolName: "Bash", input: { command: "ls" } })).toBeUndefined();
    expect(extractToolResultOutput({ result: { type: "diff", oldText: null } })).toBeUndefined();
  });

  it("truncates very long output", () => {
    const output = extractToolResultOutput({ rawOutput: { stdout: "x".repeat(30_000) } });
    expect(output?.length).toBeLessThan(21_000);
    expect(output?.endsWith("… [output truncated]")).toBe(true);
  });
});
