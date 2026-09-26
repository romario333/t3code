import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { extractToolOutputText, readToolOutput } from "./toolOutputQuery.ts";

it("extracts output from each provider's completed tool payload", () => {
  const cases: Array<[unknown, string | null]> = [
    // Claude Bash
    [{ data: { result: { type: "tool_result", content: "line 1\nline 2" } } }, "line 1\nline 2"],
    // Claude MCP
    [
      {
        data: {
          result: {
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
          },
        },
      },
      "a\nb",
    ],
    // Codex command, with ANSI color codes
    [{ data: { item: { aggregatedOutput: "\u001b[32mok\u001b[0m\n" } } }, "ok\n"],
    // Codex MCP
    [{ data: { item: { result: { content: [{ type: "text", text: "mcp" }] } } } }, "mcp"],
    // ACP providers
    [{ data: { rawOutput: { stdout: "out", stderr: "err" } } }, "out\nerr"],
    [{ data: { content: [{ type: "content", content: { type: "text", text: "acp" } }] } }, "acp"],
    [{ data: { input: { command: "true" }, result: { content: "" } } }, null],
  ];
  for (const [payload, expected] of cases) {
    assert.strictEqual(extractToolOutputText(payload), expected);
  }
});

it.effect("reads the latest completed output for a tool call and caps long output", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const threadId = ThreadId.make("thread-1");
    const insert = (id: string, kind: string, sequence: number, content: string) => {
      const payloadJson = JSON.stringify({
        itemType: "command_execution",
        toolCallId: "call-1",
        data: { result: { content } },
      });
      return sql`
        INSERT INTO projection_thread_activities
          (activity_id, thread_id, tone, kind, summary, payload_json, created_at, sequence)
        VALUES (${id}, ${threadId}, 'tool', ${kind}, 'Command run', ${payloadJson},
          '2026-09-26T00:00:00.000Z', ${sequence})
      `;
    };
    yield* insert("a", "tool.updated", 1, "partial");
    yield* insert("b", "tool.completed", 2, "first run");
    yield* insert("c", "tool.completed", 3, `start${"x".repeat(100_000)}end`);

    const result = yield* readToolOutput({ threadId, toolCallId: "call-1" });
    assert.isTrue(result.truncated);
    assert.isTrue(result.output?.startsWith("start"));
    assert.isTrue(result.output?.endsWith("end"));
    assert.isBelow(result.output?.length ?? 0, 70_000);

    assert.deepStrictEqual(yield* readToolOutput({ threadId, toolCallId: "missing" }), {
      output: null,
      truncated: false,
    });
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);
