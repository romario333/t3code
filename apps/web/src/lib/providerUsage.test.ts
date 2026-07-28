import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderUsage } from "@t3tools/contracts";

import {
  deriveProviderUsageDisplay,
  formatUsageResetsIn,
  resolveUsagePaceLevel,
  resolveUsageWindowLevel,
  usageWindowLabel,
} from "./providerUsage";

const WEEKLY_MINS = 10_080;
const SESSION_MINS = 300;
const NOW_MS = Date.parse("2026-07-20T12:00:00.000Z");
const UPDATED_AT = "2026-07-20T12:00:00.000Z";

/** resetsAt for a weekly window whose elapsed time is `elapsedDays`. */
function weeklyResetAt(elapsedDays: number): string {
  const minutesUntilReset = WEEKLY_MINS - elapsedDays * 1_440;
  return new Date(NOW_MS + minutesUntilReset * 60_000).toISOString();
}

function paceInput(
  usedPercent: number,
  elapsedDays: number,
  overrides?: Partial<Parameters<typeof resolveUsagePaceLevel>[0]>,
) {
  return {
    usedPercent,
    windowDurationMins: WEEKLY_MINS,
    resetsAt: weeklyResetAt(elapsedDays),
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("resolveUsagePaceLevel", () => {
  it("stays ok on day one while capacity covers six or more days", () => {
    // 15% after one day → capacity ≈ 6.7 days.
    expect(resolveUsagePaceLevel(paceInput(15, 1))).toBe("ok");
  });

  it("warns on day one when capacity drops below six days", () => {
    // 17% after one day → capacity ≈ 5.9 days.
    expect(resolveUsagePaceLevel(paceInput(17, 1))).toBe("warning");
  });

  it("errors on day one when capacity drops below five days", () => {
    // 21% after one day → capacity ≈ 4.8 days.
    expect(resolveUsagePaceLevel(paceInput(21, 1))).toBe("error");
  });

  it("evaluates pace mid-window", () => {
    // Day 3.5 at 50% → capacity 7 days.
    expect(resolveUsagePaceLevel(paceInput(50, 3.5))).toBe("ok");
    // Day 3.5 at 65% → capacity ≈ 5.4 days.
    expect(resolveUsagePaceLevel(paceInput(65, 3.5))).toBe("warning");
    // Day 3.5 at 78% → capacity ≈ 4.5 days.
    expect(resolveUsagePaceLevel(paceInput(78, 3.5))).toBe("error");
  });

  it("clamps early-window elapsed time to one day", () => {
    // Two hours in at 15% used: without the clamp elapsedDays ≈ 0.083 and
    // capacity ≈ 0.6 days (error); with it this matches the day-one rule.
    expect(resolveUsagePaceLevel(paceInput(15, 2 / 24))).toBe("ok");
    expect(resolveUsagePaceLevel(paceInput(21, 2 / 24))).toBe("error");
  });

  it("treats boundaries exactly", () => {
    // Capacity exactly 6 days (3 days elapsed, 50%) → ok, not warning.
    expect(resolveUsagePaceLevel(paceInput(50, 3))).toBe("ok");
    expect(resolveUsagePaceLevel(paceInput(51, 3))).toBe("warning");
    // Capacity exactly 5 days (3 days elapsed, 60%) → warning, not error.
    expect(resolveUsagePaceLevel(paceInput(60, 3))).toBe("warning");
    expect(resolveUsagePaceLevel(paceInput(61, 3))).toBe("error");
  });

  it("errors at or above 100% used regardless of pace", () => {
    expect(resolveUsagePaceLevel(paceInput(100, 6.9))).toBe("error");
    expect(resolveUsagePaceLevel(paceInput(120, 6.9))).toBe("error");
  });

  it("errors when the provider reports the limit reached", () => {
    expect(resolveUsagePaceLevel(paceInput(10, 1, { limitReached: true }))).toBe("error");
  });

  it("falls back to one elapsed day when reset or duration is unknown", () => {
    expect(resolveUsagePaceLevel(paceInput(17, 1, { resetsAt: null }))).toBe("warning");
    expect(resolveUsagePaceLevel(paceInput(17, 1, { windowDurationMins: null }))).toBe("warning");
    expect(resolveUsagePaceLevel(paceInput(17, 1, { resetsAt: "not-a-date" }))).toBe("warning");
  });

  it("is ok at zero usage", () => {
    expect(resolveUsagePaceLevel(paceInput(0, 3))).toBe("ok");
  });
});

describe("resolveUsageWindowLevel", () => {
  it("uses the pace projection for weekly windows", () => {
    const weekly = {
      kind: "weekly" as const,
      usedPercent: 21,
      windowDurationMins: WEEKLY_MINS,
      resetsAt: weeklyResetAt(1),
    };
    expect(resolveUsageWindowLevel(weekly, NOW_MS)).toBe("error");
    expect(resolveUsageWindowLevel({ ...weekly, usedPercent: 15 }, NOW_MS)).toBe("ok");
  });

  it("uses flat near-exhaustion thresholds for session windows", () => {
    const session = {
      kind: "session" as const,
      usedPercent: 50,
      windowDurationMins: SESSION_MINS,
      resetsAt: new Date(NOW_MS + 60 * 60_000).toISOString(),
    };
    expect(resolveUsageWindowLevel(session, NOW_MS)).toBe("ok");
    expect(resolveUsageWindowLevel({ ...session, usedPercent: 80 }, NOW_MS)).toBe("warning");
    expect(resolveUsageWindowLevel({ ...session, usedPercent: 95 }, NOW_MS)).toBe("error");
    expect(
      resolveUsageWindowLevel({ ...session, usedPercent: 10, limitReached: true }, NOW_MS),
    ).toBe("error");
  });
});

describe("deriveProviderUsageDisplay", () => {
  const weeklyWindow = {
    kind: "weekly" as const,
    usedPercent: 42,
    resetsAt: weeklyResetAt(2),
    windowDurationMins: WEEKLY_MINS,
    updatedAt: UPDATED_AT,
  };
  const sessionWindow = {
    kind: "session" as const,
    usedPercent: 80,
    resetsAt: new Date(NOW_MS + 60 * 60_000).toISOString(),
    windowDurationMins: SESSION_MINS,
    updatedAt: UPDATED_AT,
  };

  it("keeps every window but leads with the weekly one", () => {
    const usage: ServerProviderUsage = {
      windows: [sessionWindow, weeklyWindow],
      planLabel: "max",
      updatedAt: UPDATED_AT,
    };
    const display = deriveProviderUsageDisplay(usage);
    expect(display?.primary.kind).toBe("weekly");
    expect(display?.primary.usedPercent).toBe(42);
    expect(display?.primary.remainingPercent).toBe(58);
    expect(display?.planLabel).toBe("max");
    expect(display?.windows.map((window) => window.kind)).toEqual(["weekly", "session"]);
    expect(display?.windows[1]?.usedPercent).toBe(80);
  });

  it("keeps the account-wide weekly window primary over model caps", () => {
    const usage: ServerProviderUsage = {
      windows: [
        sessionWindow,
        { ...weeklyWindow, modelSlug: "fable", usedPercent: 90 },
        weeklyWindow,
      ],
      updatedAt: UPDATED_AT,
    };
    const display = deriveProviderUsageDisplay(usage);
    expect(display?.primary.modelSlug).toBeNull();
    expect(display?.primary.usedPercent).toBe(42);
    expect(display?.windows).toHaveLength(3);
    expect(display?.windows[0]?.modelSlug).toBeNull();
  });

  it("falls back to the session window as primary", () => {
    const usage: ServerProviderUsage = {
      windows: [sessionWindow],
      updatedAt: UPDATED_AT,
    };
    const display = deriveProviderUsageDisplay(usage);
    expect(display?.primary.kind).toBe("session");
    expect(display?.primary.limitReached).toBe(false);
    expect(display?.planLabel).toBeNull();
    expect(display?.windows).toHaveLength(1);
  });

  it("returns null without data", () => {
    expect(deriveProviderUsageDisplay(undefined)).toBeNull();
    expect(deriveProviderUsageDisplay({ windows: [], updatedAt: UPDATED_AT })).toBeNull();
  });
});

describe("formatUsageResetsIn", () => {
  it("formats day, hour, and minute granularity", () => {
    const at = (minutes: number) => new Date(NOW_MS + minutes * 60_000).toISOString();
    expect(formatUsageResetsIn(at(3 * 1_440 + 4 * 60), NOW_MS)).toBe("3d 4h");
    expect(formatUsageResetsIn(at(2 * 1_440), NOW_MS)).toBe("2d");
    expect(formatUsageResetsIn(at(4 * 60 + 30), NOW_MS)).toBe("4h 30m");
    expect(formatUsageResetsIn(at(45), NOW_MS)).toBe("45m");
  });

  it("returns null for unknown or past resets", () => {
    expect(formatUsageResetsIn(null, NOW_MS)).toBeNull();
    expect(formatUsageResetsIn("not-a-date", NOW_MS)).toBeNull();
    expect(formatUsageResetsIn(new Date(NOW_MS - 60_000).toISOString(), NOW_MS)).toBeNull();
  });
});

describe("usageWindowLabel", () => {
  it("labels windows", () => {
    expect(usageWindowLabel("weekly")).toBe("Weekly limit");
    expect(usageWindowLabel("weekly", null)).toBe("Weekly limit");
    expect(usageWindowLabel("weekly", "fable")).toBe("Fable weekly limit");
    expect(usageWindowLabel("weekly", "opus")).toBe("Opus weekly limit");
    expect(usageWindowLabel("session", null, SESSION_MINS)).toBe("Session limit (5h)");
    expect(usageWindowLabel("session", null, 90)).toBe("Session limit (90m)");
    expect(usageWindowLabel("session", null, null)).toBe("Session limit");
    expect(usageWindowLabel("session")).toBe("Session limit");
  });
});
