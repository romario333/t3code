// @effect-diagnostics nodeBuiltinImport:off
/**
 * Reader for the per-thread provider event log written by EventNdjsonLogger.
 *
 * Each line looks like `[<ISO date>] NTIVE: {json}` (native provider event) or
 * `[<ISO date>] CANON: {json}` (canonical runtime event), both interleaved in
 * `<providerLogsDir>/<threadSegment>.log`. This service tails that file and
 * turns each line into a structured entry with a human-readable summary so the
 * client can render the thread's provider activity at a glance. Reads are
 * best-effort: failures degrade to an empty result, mirroring the logger.
 */
import * as NodePath from "node:path";

import type {
  ServerProviderEventLogEntry,
  ServerProviderEventLogResult,
  ServerProviderEventLogStream,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { toSafeThreadAttachmentSegment } from "../attachmentStore.ts";

const TAIL_MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 500;
const RAW_MAX_CHARS = 2048;
const LOG_LINE_PATTERN = /^\[([^\]]+)\] (NTIVE|CANON): (.*)$/;

export interface ProviderEventLogOptions {
  readonly providerLogsDir: string;
  readonly threadId: string;
}

export class ProviderEventLog extends Context.Service<
  ProviderEventLog,
  {
    readonly read: (
      options: ProviderEventLogOptions,
    ) => Effect.Effect<ServerProviderEventLogResult>;
  }
>()("t3/diagnostics/ProviderEventLog") {}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function describeCanonicalPayload(type: string, payload: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (type.startsWith("item.")) {
    const itemType = toStringValue(payload.itemType);
    if (itemType) parts.push(itemType);
  }
  if (type === "content.delta") {
    const streamKind = toStringValue(payload.streamKind);
    if (streamKind) parts.push(streamKind);
    if (typeof payload.delta === "string") parts.push(`+${payload.delta.length} chars`);
  }
  if (type === "turn.proposed.delta" && typeof payload.delta === "string") {
    parts.push(`+${payload.delta.length} chars`);
  }
  if (type === "turn.diff.updated" && typeof payload.unifiedDiff === "string") {
    parts.push(`diff ${payload.unifiedDiff.length} chars`);
  }
  const requestType = toStringValue(payload.requestType);
  if (requestType) parts.push(requestType);
  const title = toStringValue(payload.title);
  if (title) parts.push(`"${title}"`);
  const description = toStringValue(payload.description);
  if (description) parts.push(`"${description}"`);
  for (const key of ["status", "state", "decision", "reason", "stopReason", "model"] as const) {
    const value = toStringValue(payload[key]);
    if (value) parts.push(`(${value})`);
  }
  const detail = toStringValue(payload.detail);
  if (detail) parts.push(detail);
  const message = toStringValue(payload.message ?? payload.errorMessage);
  if (message) parts.push(message);
  return parts;
}

export function summarizeProviderEvent(
  stream: ServerProviderEventLogStream,
  event: unknown,
): string {
  if (!isRecordObject(event)) return "(unparsed event)";
  if (stream === "canonical") {
    const type = toStringValue(event.type) ?? "(unknown type)";
    const payload = isRecordObject(event.payload) ? event.payload : {};
    return [type, ...describeCanonicalPayload(type, payload)].join(" ");
  }
  const method = toStringValue(event.method) ?? "(unknown method)";
  const parts = [method];
  const kind = toStringValue(event.kind);
  if (kind) parts.push(`[${kind}]`);
  if (typeof event.textDelta === "string") parts.push(`+${event.textDelta.length} chars`);
  const message = toStringValue(event.message);
  if (message) parts.push(message);
  return parts.join(" ");
}

export function parseProviderEventLogLine(line: string): ServerProviderEventLogEntry | null {
  const match = LOG_LINE_PATTERN.exec(line);
  if (!match) return null;
  const stream: ServerProviderEventLogStream = match[2] === "NTIVE" ? "native" : "canonical";
  const json = match[3]!;
  let summary: string;
  try {
    summary = summarizeProviderEvent(stream, JSON.parse(json));
  } catch {
    summary = json.slice(0, 120);
  }
  return {
    timestamp: match[1]!,
    stream,
    summary,
    raw: json.length > RAW_MAX_CHARS ? json.slice(0, RAW_MAX_CHARS) : json,
    truncated: json.length > RAW_MAX_CHARS,
  };
}

function emptyResult(logFilePath: string): ServerProviderEventLogResult {
  return { logFilePath, exists: false, truncatedHead: false, entries: [] };
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;

  const readTailText = Effect.fn("ProviderEventLog.readTailText")(function* (logFilePath: string) {
    const info = yield* fileSystem.stat(logFilePath);
    const size = Number(info.size);
    const offset = Math.max(0, size - TAIL_MAX_BYTES);
    const chunks = yield* fileSystem.stream(logFilePath, { offset }).pipe(Stream.runCollect);
    const decoder = new TextDecoder();
    let text = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("");
    text += decoder.decode();
    let truncatedHead = false;
    if (offset > 0) {
      truncatedHead = true;
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return { text, truncatedHead };
  });

  const read: ProviderEventLog["Service"]["read"] = Effect.fn("ProviderEventLog.read")(
    function* (options) {
      const threadSegment = toSafeThreadAttachmentSegment(options.threadId);
      if (!threadSegment) {
        return emptyResult(NodePath.join(options.providerLogsDir, "unknown-thread.log"));
      }
      const logFilePath = NodePath.join(options.providerLogsDir, `${threadSegment}.log`);
      const tail = yield* readTailText(logFilePath).pipe(
        Effect.catch((cause) =>
          (cause.reason._tag === "NotFound"
            ? Effect.void
            : Effect.logWarning("Failed to read provider event log file.").pipe(
                Effect.annotateLogs({ logFilePath, causeTag: cause.reason._tag }),
              )
          ).pipe(Effect.as(null)),
        ),
      );
      if (tail === null) {
        return emptyResult(logFilePath);
      }

      const entries: ServerProviderEventLogEntry[] = [];
      for (const line of tail.text.split("\n")) {
        const entry = parseProviderEventLogLine(line);
        if (entry) entries.push(entry);
      }
      const truncatedHead = tail.truncatedHead || entries.length > MAX_ENTRIES;
      return {
        logFilePath,
        exists: true,
        truncatedHead,
        entries: entries.slice(-MAX_ENTRIES),
      };
    },
  );

  return ProviderEventLog.of({ read });
});

export const layer = Layer.effect(ProviderEventLog, make);

export function readProviderEventLog(
  options: ProviderEventLogOptions,
): Effect.Effect<ServerProviderEventLogResult, never, ProviderEventLog> {
  return Effect.gen(function* () {
    const providerEventLog = yield* ProviderEventLog;
    return yield* providerEventLog.read(options);
  });
}
