import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  bindingLimitWindow,
  deriveProviderLimitsMeter,
  limitSeverity,
  watchedLimitWindows,
} from "./ProviderLimitsMeter.logic";

const WEEK_MINS = 7 * 24 * 60;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function window(input: {
  id: string;
  kind?: ServerProviderUsageWindow["kind"];
  usedPercent: number;
  /** Time left in the window, as a share of its length. */
  timeLeft?: number;
  durationMins?: number | null;
}): ServerProviderUsageWindow {
  const durationMins = input.durationMins === undefined ? WEEK_MINS : input.durationMins;
  return {
    id: input.id,
    kind: input.kind ?? "weekly",
    label: input.id,
    usedPercent: input.usedPercent,
    ...(durationMins === null ? {} : { windowDurationMins: durationMins }),
    ...(input.timeLeft === undefined || durationMins === null
      ? {}
      : {
          resetsAt: new Date(NOW + input.timeLeft * durationMins * 60 * 1000).toISOString(),
        }),
  };
}

function limits(windows: ReadonlyArray<ServerProviderUsageWindow>): ServerProviderUsageLimits {
  return { checkedAt: new Date(NOW).toISOString(), windows };
}

describe("watchedLimitWindows", () => {
  it("watches every weekly window, including model-scoped ones", () => {
    const session = window({ id: "five_hour", kind: "session", usedPercent: 10 });
    const weekly = window({ id: "seven_day", usedPercent: 10 });
    const fable = window({ id: "seven_day_fable", usedPercent: 10 });
    expect(watchedLimitWindows([session, weekly, fable])).toEqual([weekly, fable]);
  });

  it("falls back to a monthly allowance when there is no weekly window", () => {
    const monthly = window({ id: "primary", kind: "monthly", usedPercent: 40 });
    expect(watchedLimitWindows([monthly])).toEqual([monthly]);
  });

  it("ignores session windows on their own", () => {
    expect(
      watchedLimitWindows([window({ id: "five_hour", kind: "session", usedPercent: 99 })]),
    ).toEqual([]);
  });
});

describe("bindingLimitWindow", () => {
  it("picks the window with the least quota left", () => {
    const weekly = window({ id: "seven_day", usedPercent: 13 });
    const fable = window({ id: "seven_day_fable", usedPercent: 40 });
    expect(bindingLimitWindow([weekly, fable])).toBe(fable);
  });

  it("keeps the first window on a tie", () => {
    const weekly = window({ id: "seven_day", usedPercent: 13 });
    const fable = window({ id: "seven_day_fable", usedPercent: 13 });
    expect(bindingLimitWindow([weekly, fable])).toBe(weekly);
  });

  it("is null without windows", () => {
    expect(bindingLimitWindow([])).toBeNull();
  });
});

describe("limitSeverity", () => {
  it("is fine with comfortable headroom above the even-spending line", () => {
    // 78% of the window left, 87% of quota left: 9 points above the line.
    expect(limitSeverity(window({ id: "w", usedPercent: 13, timeLeft: 0.78 }), NOW)).toBe(
      "warning",
    );
    expect(limitSeverity(window({ id: "w", usedPercent: 10, timeLeft: 0.78 }), NOW)).toBe("ok");
  });

  it("alarms once quota falls below the even-spending line", () => {
    expect(limitSeverity(window({ id: "w", usedPercent: 30, timeLeft: 0.78 }), NOW)).toBe("error");
  });

  it("alarms on an exhausted window regardless of the clock", () => {
    expect(limitSeverity(window({ id: "w", usedPercent: 100, timeLeft: 0.05 }), NOW)).toBe("error");
  });

  it("falls back to fixed thresholds without a reset time", () => {
    expect(limitSeverity(window({ id: "w", usedPercent: 50 }), NOW)).toBe("ok");
    expect(limitSeverity(window({ id: "w", usedPercent: 80 }), NOW)).toBe("warning");
    expect(limitSeverity(window({ id: "w", usedPercent: 95 }), NOW)).toBe("error");
  });

  it("does not trip on a window that is about to reset", () => {
    // 1% of the window left and 4% of quota: just above the line.
    expect(limitSeverity(window({ id: "w", usedPercent: 96, timeLeft: 0.01 }), NOW)).toBe(
      "warning",
    );
  });
});

describe("deriveProviderLimitsMeter", () => {
  it("draws the tightest weekly window and measures from the snapshot time", () => {
    const state = deriveProviderLimitsMeter(
      limits([
        window({ id: "five_hour", kind: "session", usedPercent: 90 }),
        window({ id: "seven_day", usedPercent: 13, timeLeft: 0.78 }),
        window({ id: "seven_day_fable", usedPercent: 22, timeLeft: 0.78 }),
      ]),
    );
    expect(state?.binding.id).toBe("seven_day_fable");
    expect(state?.remaining).toBe(78);
    expect(state?.timeLeft).toBe(78);
    expect(state?.severity).toBe("warning");
    expect(state?.now).toBe(NOW);
    expect(state?.windows).toHaveLength(3);
  });

  it("is null when the account has no subscription limits", () => {
    expect(deriveProviderLimitsMeter(undefined)).toBeNull();
    expect(
      deriveProviderLimitsMeter({
        checkedAt: new Date(NOW).toISOString(),
        windows: [],
        unavailable: { reason: "unsupported" },
      }),
    ).toBeNull();
    expect(
      deriveProviderLimitsMeter(
        limits([window({ id: "five_hour", kind: "session", usedPercent: 50 })]),
      ),
    ).toBeNull();
  });

  it("keeps drawing the last good snapshot after a failed probe", () => {
    const state = deriveProviderLimitsMeter({
      ...limits([window({ id: "seven_day", usedPercent: 40, timeLeft: 0.5 })]),
      unavailable: { reason: "probeFailed" },
    });
    expect(state?.remaining).toBe(60);
  });

  it("paces from a stale snapshot by its own clock, not the reader's", () => {
    const checkedAt = new Date(NOW - 2 * DAY).toISOString();
    const state = deriveProviderLimitsMeter({
      checkedAt,
      windows: [window({ id: "seven_day", usedPercent: 40, timeLeft: 0.5 })],
    });
    // resetsAt is 3.5 days after NOW, so 5.5 of 7 days remain from checkedAt.
    expect(state?.timeLeft).toBe(79);
  });
});
