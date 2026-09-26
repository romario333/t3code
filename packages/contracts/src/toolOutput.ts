import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Full output of one completed tool call. Thread snapshots only carry a
 * one-line summary, so clients fetch this when the user expands a row.
 */
export const OrchestrationGetToolOutputInput = Schema.Struct({
  threadId: ThreadId,
  toolCallId: TrimmedNonEmptyString,
});
export type OrchestrationGetToolOutputInput = typeof OrchestrationGetToolOutputInput.Type;

export const OrchestrationGetToolOutputResult = Schema.Struct({
  output: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
});
export type OrchestrationGetToolOutputResult = typeof OrchestrationGetToolOutputResult.Type;
