import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  makeProviderUsageStore,
  mergeProviderUsage,
  normalizeClaudeRateLimitEvent,
  normalizeClaudeUsageReadResponse,
  normalizeCodexRateLimits,
} from "./providerUsage.ts";

const NOW = "2026-07-20T12:00:00.000Z";
const LATER = "2026-07-20T13:00:00.000Z";

const weeklyWindow = (
  overrides?: Partial<ServerProviderUsageWindow>,
): ServerProviderUsageWindow => ({
  kind: "weekly",
  usedPercent: 40,
  resetsAt: "2026-07-24T00:00:00.000Z",
  windowDurationMins: 10_080,
  updatedAt: NOW,
  ...overrides,
});

const sessionWindow = (
  overrides?: Partial<ServerProviderUsageWindow>,
): ServerProviderUsageWindow => ({
  kind: "session",
  usedPercent: 12,
  resetsAt: "2026-07-20T15:00:00.000Z",
  windowDurationMins: 300,
  updatedAt: NOW,
  ...overrides,
});

it("normalizeClaudeRateLimitEvent maps the five-hour and weekly windows", () => {
  assert.deepEqual(
    normalizeClaudeRateLimitEvent(
      {
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 34,
        resetsAt: 1_784_560_800, // 2026-07-20T15:20:00.000Z
      },
      NOW,
    ),
    [
      {
        kind: "session",
        usedPercent: 34,
        resetsAt: "2026-07-20T15:20:00.000Z",
        windowDurationMins: 300,
        updatedAt: NOW,
      },
    ],
  );

  assert.deepEqual(
    normalizeClaudeRateLimitEvent(
      { status: "rejected", rateLimitType: "seven_day", utilization: 100 },
      NOW,
    ),
    [
      {
        kind: "weekly",
        usedPercent: 100,
        resetsAt: null,
        windowDurationMins: 10_080,
        limitReached: true,
        updatedAt: NOW,
      },
    ],
  );
});

it("normalizeClaudeRateLimitEvent maps model-specific weekly caps by convention", () => {
  assert.deepEqual(
    normalizeClaudeRateLimitEvent(
      { status: "allowed", rateLimitType: "seven_day_fable", utilization: 55 },
      NOW,
    ),
    [
      {
        kind: "weekly",
        modelSlug: "fable",
        usedPercent: 55,
        resetsAt: null,
        windowDurationMins: 10_080,
        updatedAt: NOW,
      },
    ],
  );
  assert.equal(
    normalizeClaudeRateLimitEvent(
      { status: "allowed", rateLimitType: "seven_day_opus", utilization: 55 },
      NOW,
    )?.[0]?.modelSlug,
    "opus",
  );
});

it("normalizeClaudeRateLimitEvent drops non-window rate limit types", () => {
  assert.equal(
    normalizeClaudeRateLimitEvent(
      { status: "allowed", rateLimitType: "overage", utilization: 5 },
      NOW,
    ),
    undefined,
  );
  assert.equal(
    normalizeClaudeRateLimitEvent(
      { status: "allowed", rateLimitType: "seven_day_oauth_apps", utilization: 5 },
      NOW,
    ),
    undefined,
  );
  assert.equal(normalizeClaudeRateLimitEvent({ status: "allowed" }, NOW), undefined);
  assert.equal(normalizeClaudeRateLimitEvent("nonsense", NOW), undefined);
});

it("normalizeClaudeUsageReadResponse maps all windows including model caps and the plan", () => {
  const result = normalizeClaudeUsageReadResponse(
    {
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 12.5, resets_at: "2026-07-20T15:00:00Z" },
        seven_day: { utilization: 47, resets_at: "2026-07-24T00:00:00Z" },
        seven_day_fable: { utilization: 80, resets_at: null },
        seven_day_oauth_apps: { utilization: 5, resets_at: null },
        extra_usage: { is_enabled: false },
      },
    },
    NOW,
  );
  assert.notEqual(result, "unavailable");
  assert.ok(result && result !== "unavailable");
  assert.equal(result.planLabel, "max");
  assert.deepEqual(result.windows, [
    {
      kind: "session",
      usedPercent: 12.5,
      resetsAt: "2026-07-20T15:00:00.000Z",
      windowDurationMins: 300,
      updatedAt: NOW,
    },
    {
      kind: "weekly",
      usedPercent: 47,
      resetsAt: "2026-07-24T00:00:00.000Z",
      windowDurationMins: 10_080,
      updatedAt: NOW,
    },
    {
      kind: "weekly",
      modelSlug: "fable",
      usedPercent: 80,
      resetsAt: null,
      windowDurationMins: 10_080,
      updatedAt: NOW,
    },
  ]);
});

it("normalizeClaudeUsageReadResponse prefers the limits[] array and maps model-scoped caps", () => {
  // Mirrors the live response shape of the claude.ai usage endpoint: the
  // fixed seven_day_* keys are null and model caps (Fable here) arrive as
  // weekly_scoped entries in limits[].
  const result = normalizeClaudeUsageReadResponse(
    {
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 37, resets_at: "2026-07-28T09:50:00.500070+00:00" },
        seven_day: { utilization: 21, resets_at: "2026-07-31T16:00:00.500090+00:00" },
        seven_day_opus: null,
        seven_day_fable: null,
        extra_usage: { is_enabled: true, utilization: 66 },
        limits: [
          {
            kind: "session",
            group: "session",
            percent: 37,
            severity: "normal",
            resets_at: "2026-07-28T09:50:00.500070+00:00",
            scope: null,
            is_active: true,
          },
          {
            kind: "weekly_all",
            group: "weekly",
            percent: 21,
            severity: "normal",
            resets_at: "2026-07-31T16:00:00.500090+00:00",
            scope: null,
            is_active: false,
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 11,
            severity: "normal",
            resets_at: "2026-07-31T15:59:59.648513+00:00",
            scope: { model: { id: null, display_name: "Fable" }, surface: null },
            is_active: false,
          },
        ],
      },
    },
    NOW,
  );
  assert.ok(result && result !== "unavailable");
  assert.deepEqual(result.windows, [
    {
      kind: "session",
      usedPercent: 37,
      resetsAt: "2026-07-28T09:50:00.500Z",
      windowDurationMins: 300,
      updatedAt: NOW,
    },
    {
      kind: "weekly",
      usedPercent: 21,
      resetsAt: "2026-07-31T16:00:00.500Z",
      windowDurationMins: 10_080,
      updatedAt: NOW,
    },
    {
      kind: "weekly",
      modelSlug: "fable",
      usedPercent: 11,
      resetsAt: "2026-07-31T15:59:59.648Z",
      windowDurationMins: 10_080,
      updatedAt: NOW,
    },
  ]);
});

it("normalizeClaudeUsageReadResponse skips limits scoped to something other than a model", () => {
  const result = normalizeClaudeUsageReadResponse(
    {
      rate_limits_available: true,
      rate_limits: {
        limits: [
          {
            group: "weekly",
            percent: 21,
            severity: "exceeded",
            resets_at: "2026-07-31T16:00:00Z",
            scope: null,
          },
          {
            group: "weekly",
            percent: 50,
            severity: "normal",
            resets_at: "2026-07-31T16:00:00Z",
            scope: { model: null, surface: "code" },
          },
        ],
      },
    },
    NOW,
  );
  assert.ok(result && result !== "unavailable");
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0]?.limitReached, true);
  assert.equal(result.windows[0]?.modelSlug, undefined);
});

it("normalizeClaudeUsageReadResponse reports unavailable accounts", () => {
  assert.equal(
    normalizeClaudeUsageReadResponse({ rate_limits_available: false, rate_limits: null }, NOW),
    "unavailable",
  );
  assert.equal(
    normalizeClaudeUsageReadResponse(
      { subscription_type: null, rate_limits_available: true, rate_limits: null },
      NOW,
    ),
    "unavailable",
  );
  assert.equal(normalizeClaudeUsageReadResponse(undefined, NOW), undefined);
});

it("normalizeCodexRateLimits classifies windows by duration and converts epochs", () => {
  const result = normalizeCodexRateLimits(
    {
      planType: "plus",
      primary: { usedPercent: 20, resetsAt: 1_784_560_800, windowDurationMins: 300 },
      secondary: { usedPercent: 61, resetsAt: 1_784_851_200, windowDurationMins: 10_080 },
    },
    NOW,
  );
  assert.ok(result);
  assert.equal(result.planLabel, "plus");
  assert.deepEqual(result.windows, [
    {
      kind: "session",
      usedPercent: 20,
      resetsAt: "2026-07-20T15:20:00.000Z",
      windowDurationMins: 300,
      updatedAt: NOW,
    },
    {
      kind: "weekly",
      usedPercent: 61,
      resetsAt: "2026-07-24T00:00:00.000Z",
      windowDurationMins: 10_080,
      updatedAt: NOW,
    },
  ]);
});

it("normalizeCodexRateLimits falls back to position when duration is missing and flags reached limits", () => {
  const result = normalizeCodexRateLimits(
    {
      rateLimitReachedType: "rate_limit_reached",
      primary: { usedPercent: 100 },
      secondary: { usedPercent: 88 },
    },
    NOW,
  );
  assert.ok(result);
  assert.equal(result.planLabel, undefined);
  // The reached marker is account-level; only the exhausted window gets it.
  assert.deepEqual(
    result.windows.map((window) => ({
      kind: window.kind,
      limitReached: window.limitReached,
      windowDurationMins: window.windowDurationMins,
    })),
    [
      { kind: "session", limitReached: true, windowDurationMins: null },
      { kind: "weekly", limitReached: undefined, windowDurationMins: null },
    ],
  );
  assert.equal(normalizeCodexRateLimits({}, NOW), undefined);
});

it("normalizeCodexRateLimits attributes a reached limit to the most-used window when none is at 100", () => {
  const result = normalizeCodexRateLimits(
    {
      rateLimitReachedType: "rate_limit_reached",
      primary: { usedPercent: 99.6, windowDurationMins: 300 },
      secondary: { usedPercent: 20, windowDurationMins: 10_080 },
    },
    NOW,
  );
  assert.ok(result);
  assert.equal(result.windows.find((window) => window.kind === "session")?.limitReached, true);
  assert.equal(result.windows.find((window) => window.kind === "weekly")?.limitReached, undefined);
});

it("mergeProviderUsage merges per window and keeps untouched windows", () => {
  const base = mergeProviderUsage(undefined, [sessionWindow(), weeklyWindow()], {
    planLabel: "max",
    replace: true,
  });
  assert.ok(base);
  assert.deepEqual(
    base.windows.map((window) => window.kind),
    ["session", "weekly"],
  );

  // Sparse update: only the weekly window changes; session survives.
  const merged = mergeProviderUsage(base, [weeklyWindow({ usedPercent: 55, updatedAt: LATER })]);
  assert.ok(merged);
  assert.equal(merged.windows.length, 2);
  assert.equal(merged.windows.find((window) => window.kind === "session")?.usedPercent, 12);
  assert.equal(merged.windows.find((window) => window.kind === "weekly")?.usedPercent, 55);
  assert.equal(merged.planLabel, "max");
  assert.equal(merged.updatedAt, LATER);
});

it("mergeProviderUsage keeps model-specific weekly caps distinct from the account window", () => {
  const base = mergeProviderUsage(undefined, [
    weeklyWindow(),
    weeklyWindow({ modelSlug: "fable", usedPercent: 70 }),
  ]);
  assert.ok(base);
  assert.deepEqual(
    base.windows.map((window) => window.modelSlug),
    [undefined, "fable"],
  );

  // A push for the fable cap must not clobber the account-wide window.
  const merged = mergeProviderUsage(base, [
    weeklyWindow({ modelSlug: "fable", usedPercent: 85, updatedAt: LATER }),
  ]);
  assert.ok(merged);
  assert.equal(merged.windows.find((window) => window.modelSlug === undefined)?.usedPercent, 40);
  assert.equal(merged.windows.find((window) => window.modelSlug === "fable")?.usedPercent, 85);
});

it("mergeProviderUsage replaces the full window set with replace semantics", () => {
  const base = mergeProviderUsage(undefined, [sessionWindow(), weeklyWindow()]);
  const replaced = mergeProviderUsage(base, [weeklyWindow({ usedPercent: 70 })], {
    replace: true,
  });
  assert.ok(replaced);
  assert.deepEqual(
    replaced.windows.map((window) => window.kind),
    ["weekly"],
  );
  assert.equal(mergeProviderUsage(base, [], { replace: true }), undefined);
});

it("mergeProviderUsage returns the same reference for no-op updates", () => {
  const base = mergeProviderUsage(undefined, [weeklyWindow()]);
  assert.ok(base);
  // Same values with a newer per-window timestamp is still a no-op.
  assert.equal(mergeProviderUsage(base, [weeklyWindow({ updatedAt: LATER })]), base);
  assert.equal(mergeProviderUsage(base, [], {}), base);
});

it.effect("makeProviderUsageStore applies, merges, and clears", () =>
  Effect.gen(function* () {
    const store = yield* makeProviderUsageStore;
    assert.equal(yield* store.get, undefined);

    yield* store.applyWindows([sessionWindow(), weeklyWindow()], {
      planLabel: "pro",
      replace: true,
    });
    const initial = yield* store.get;
    assert.equal(initial?.windows.length, 2);
    assert.equal(initial?.planLabel, "pro");

    yield* store.applyWindows([weeklyWindow({ usedPercent: 90, updatedAt: LATER })]);
    const merged = yield* store.get;
    assert.equal(merged?.windows.find((window) => window.kind === "weekly")?.usedPercent, 90);
    assert.equal(merged?.windows.find((window) => window.kind === "session")?.usedPercent, 12);

    yield* store.clear;
    assert.equal(yield* store.get, undefined);
  }),
);
