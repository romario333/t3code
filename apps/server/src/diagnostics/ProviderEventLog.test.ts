// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderEventLog from "./ProviderEventLog.ts";

function logLine(label: "NTIVE" | "CANON", timestamp: string, event: unknown): string {
  return `[${timestamp}] ${label}: ${JSON.stringify(event)}`;
}

function readProviderEventLogWithNodeFs(options: {
  readonly providerLogsDir: string;
  readonly threadId: string;
}) {
  return ProviderEventLog.readProviderEventLog(options).pipe(
    Effect.provide(ProviderEventLog.layer.pipe(Layer.provide(NodeServices.layer))),
  );
}

describe("ProviderEventLog", () => {
  it("parses canonical item lifecycle lines into readable summaries", () => {
    const entry = ProviderEventLog.parseProviderEventLogLine(
      logLine("CANON", "2026-07-13T05:24:37.468Z", {
        eventId: "event-1",
        provider: "codex",
        threadId: "thread-1",
        type: "item.started",
        payload: { itemType: "reasoning", status: "inProgress", title: "Reasoning" },
      }),
    );
    assert.isNotNull(entry);
    assert.strictEqual(entry.timestamp, "2026-07-13T05:24:37.468Z");
    assert.strictEqual(entry.stream, "canonical");
    assert.strictEqual(entry.summary, 'item.started reasoning "Reasoning" (inProgress)');
    assert.isFalse(entry.truncated);
  });

  it("summarizes content deltas by length instead of echoing the payload", () => {
    const summary = ProviderEventLog.summarizeProviderEvent("canonical", {
      type: "content.delta",
      payload: { streamKind: "assistant", delta: "abcdef" },
    });
    assert.strictEqual(summary, "content.delta assistant +6 chars");
  });

  it("parses native lines with method and kind", () => {
    const entry = ProviderEventLog.parseProviderEventLogLine(
      logLine("NTIVE", "2026-07-13T05:24:37.468Z", {
        id: "event-1",
        provider: "codex",
        threadId: "thread-1",
        kind: "notification",
        method: "item/started",
      }),
    );
    assert.isNotNull(entry);
    assert.strictEqual(entry.stream, "native");
    assert.strictEqual(entry.summary, "item/started [notification]");
  });

  it("truncates large raw payloads but summarizes from the full payload", () => {
    const entry = ProviderEventLog.parseProviderEventLogLine(
      logLine("CANON", "2026-07-13T05:24:37.468Z", {
        type: "content.delta",
        payload: { streamKind: "assistant", delta: "x".repeat(10_000) },
      }),
    );
    assert.isNotNull(entry);
    assert.strictEqual(entry.summary, "content.delta assistant +10000 chars");
    assert.isTrue(entry.truncated);
    assert.isBelow(entry.raw.length, 10_000);
  });

  it("ignores lines that do not match the log format", () => {
    assert.isNull(ProviderEventLog.parseProviderEventLogLine(""));
    assert.isNull(ProviderEventLog.parseProviderEventLogLine("plain text"));
    assert.isNull(
      ProviderEventLog.parseProviderEventLogLine("[2026-07-13T05:24:37.468Z] OTHER: {}"),
    );
  });

  it("falls back to a payload snippet when the JSON does not parse", () => {
    const entry = ProviderEventLog.parseProviderEventLogLine(
      "[2026-07-13T05:24:37.468Z] CANON: {broken",
    );
    assert.isNotNull(entry);
    assert.strictEqual(entry.summary, "{broken");
  });

  it.effect("reads the per-thread log file in order and skips foreign lines", () =>
    Effect.gen(function* () {
      const providerLogsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "provider-log-"));
      const threadId = "thread-abc";
      NodeFS.writeFileSync(
        NodePath.join(providerLogsDir, `${threadId}.log`),
        [
          logLine("NTIVE", "2026-07-13T05:24:37.000Z", {
            kind: "notification",
            method: "item/started",
          }),
          "not a log line",
          logLine("CANON", "2026-07-13T05:24:37.001Z", {
            type: "item.started",
            payload: { itemType: "reasoning", title: "Reasoning" },
          }),
          "",
        ].join("\n"),
      );

      const result = yield* readProviderEventLogWithNodeFs({ providerLogsDir, threadId });

      assert.isTrue(result.exists);
      assert.isFalse(result.truncatedHead);
      assert.deepStrictEqual(
        result.entries.map((entry) => entry.summary),
        ["item/started [notification]", 'item.started reasoning "Reasoning"'],
      );
    }),
  );

  it.effect("reports a missing log file as not existing", () =>
    Effect.gen(function* () {
      const providerLogsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "provider-log-"));

      const result = yield* readProviderEventLogWithNodeFs({
        providerLogsDir,
        threadId: "thread-without-events",
      });

      assert.isFalse(result.exists);
      assert.deepStrictEqual(result.entries, []);
    }),
  );

  it.effect("tails oversized log files and drops the partial first line", () =>
    Effect.gen(function* () {
      const providerLogsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "provider-log-"));
      const threadId = "thread-large";
      const filler = logLine("CANON", "2026-07-13T05:24:37.000Z", {
        type: "content.delta",
        payload: { streamKind: "assistant", delta: "x".repeat(700) },
      });
      const lineCount = 600;
      const lines = Array.from({ length: lineCount - 1 }, () => filler);
      lines.push(
        logLine("CANON", "2026-07-13T05:24:38.000Z", {
          type: "turn.completed",
          payload: { state: "completed" },
        }),
      );
      NodeFS.writeFileSync(NodePath.join(providerLogsDir, `${threadId}.log`), lines.join("\n"));

      const result = yield* readProviderEventLogWithNodeFs({ providerLogsDir, threadId });

      assert.isTrue(result.exists);
      assert.isTrue(result.truncatedHead);
      assert.isAtMost(result.entries.length, 500);
      assert.strictEqual(result.entries.at(-1)?.summary, "turn.completed (completed)");
      assert.isTrue(
        result.entries.every(
          (entry) =>
            entry.summary.startsWith("content.delta") || entry.summary.startsWith("turn.completed"),
        ),
      );
    }),
  );
});
