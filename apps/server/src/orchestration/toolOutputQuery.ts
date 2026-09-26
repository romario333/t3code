/**
 * Serves the full output of one completed tool call. Thread snapshots ship
 * only a one-line summary (see ActivityPayloadProjection), so clients fetch
 * this on demand when the user expands a command or MCP row.
 */
import {
  OrchestrationGetSnapshotError,
  type OrchestrationGetToolOutputInput,
  type OrchestrationGetToolOutputResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const OUTPUT_CHAR_CAP = 64 * 1024;

const decodePayload = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Accepts a string, a `{content}` record, or an array of text blocks. */
function contentText(value: unknown): string | null {
  const direct = nonEmptyString(value);
  if (direct) return direct;
  const record = asRecord(value);
  const nested = nonEmptyString(record?.content);
  if (nested) return nested;
  const blocks = Array.isArray(value)
    ? value
    : Array.isArray(record?.content)
      ? record.content
      : [];
  const texts = blocks.flatMap((entry) => {
    const text =
      nonEmptyString(entry) ??
      nonEmptyString(asRecord(entry)?.text) ??
      nonEmptyString(asRecord(asRecord(entry)?.content)?.text);
    return text ? [text] : [];
  });
  return texts.length > 0 ? texts.join("\n") : null;
}

/** Mirrors the payload shapes each provider adapter stores on `tool.completed`. */
export function extractToolOutputText(payload: unknown): string | null {
  const data = asRecord(asRecord(payload)?.data);
  if (!data) return null;
  const item = asRecord(data.item);
  const rawOutput = asRecord(data.rawOutput);
  const streams = [nonEmptyString(rawOutput?.stdout), nonEmptyString(rawOutput?.stderr)].filter(
    (value): value is string => value !== null,
  );
  const candidates = [
    item?.aggregatedOutput, // Codex command
    item?.result, // Codex MCP
    data.result, // Claude
    data.rawOutput, // ACP providers
    streams.length > 0 ? streams.join("\n") : null,
    rawOutput?.output,
    asRecord(data.state)?.output, // OpenCode
    data.content, // ACP content blocks
    asRecord(item?.error)?.message,
  ];
  for (const candidate of candidates) {
    const text = contentText(candidate);
    // oxlint-disable-next-line no-control-regex
    if (text) return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
  }
  return null;
}

/** Keeps both ends of long output: commands tend to fail at the bottom. */
function capOutput(text: string): OrchestrationGetToolOutputResult {
  if (text.length <= OUTPUT_CHAR_CAP) return { output: text, truncated: false };
  const half = OUTPUT_CHAR_CAP / 2;
  const omitted = text.length - OUTPUT_CHAR_CAP;
  return {
    output: `${text.slice(0, half)}\n\n… ${omitted.toLocaleString()} characters omitted …\n\n${text.slice(-half)}`,
    truncated: true,
  };
}

export const readToolOutput = Effect.fn("orchestration.readToolOutput")(
  function* (input: OrchestrationGetToolOutputInput) {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly payloadJson: string }>`
      SELECT payload_json AS "payloadJson"
      FROM projection_thread_activities
      WHERE thread_id = ${input.threadId}
        AND kind = 'tool.completed'
        AND json_extract(payload_json, '$.toolCallId') = ${input.toolCallId}
      ORDER BY sequence DESC, created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { output: null, truncated: false };
    const text = extractToolOutputText(yield* decodePayload(row.payloadJson));
    return text ? capOutput(text) : { output: null, truncated: false };
  },
  Effect.mapError(
    (cause) => new OrchestrationGetSnapshotError({ message: "Failed to load tool output", cause }),
  ),
);
