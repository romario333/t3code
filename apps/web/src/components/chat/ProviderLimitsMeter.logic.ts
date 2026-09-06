import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { elapsedShare, remainingPercent } from "@t3tools/shared/usageLimits";

export type LimitSeverity = "ok" | "warning" | "error";

export interface ProviderLimitsMeterState {
  /** The snapshot's own timestamp. Pace and countdowns are measured from it,
      as the /usage-limits panel does, so the meter never guesses the clock. */
  readonly now: number;
  /** Every window the provider reports, for the hover breakdown. */
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  /** The watched window with the least quota left; the ring draws this one. */
  readonly binding: ServerProviderUsageWindow;
  readonly remaining: number;
  /** Share of the window still ahead, 0..100. Even spending would leave
      exactly this much quota, so it is where the pace tick sits. */
  readonly timeLeft: number | null;
  readonly severity: LimitSeverity;
}

/** Points of quota above the even-spending line before the ring stops warning. */
const WARNING_HEADROOM = 10;
// Without a clock to pace against, warn and alarm on fixed shares left.
const FALLBACK_WARNING_REMAINING = 25;
const FALLBACK_ERROR_REMAINING = 10;

/** Weekly windows are what a subscription runs dry on, so those are watched.
    A plan without one (Codex Free/Go) is watched on its monthly allowance. */
export function watchedLimitWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  const weekly = windows.filter((window) => window.kind === "weekly");
  return weekly.length > 0 ? weekly : windows.filter((window) => window.kind === "monthly");
}

/** The window with the least quota left; on a tie the first reported wins. */
export function bindingLimitWindow(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ServerProviderUsageWindow | null {
  let binding: ServerProviderUsageWindow | null = null;
  for (const window of windows) {
    if (binding === null || remainingPercent(window) < remainingPercent(binding)) {
      binding = window;
    }
  }
  return binding;
}

export function timeLeftPercent(window: ServerProviderUsageWindow, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  const elapsed = elapsedShare(window, now);
  return elapsed === null ? null : Math.round((1 - elapsed) * 100);
}

/**
 * Quota left against time left. Below the even-spending line the window can
 * run dry before it resets; within a few points of it the ring warns first.
 */
export function limitSeverity(window: ServerProviderUsageWindow, now: number): LimitSeverity {
  const remaining = remainingPercent(window);
  if (remaining <= 0) return "error";
  const timeLeft = timeLeftPercent(window, now);
  if (timeLeft === null) {
    if (remaining <= FALLBACK_ERROR_REMAINING) return "error";
    return remaining <= FALLBACK_WARNING_REMAINING ? "warning" : "ok";
  }
  const headroom = remaining - timeLeft;
  if (headroom < 0) return "error";
  return headroom < WARNING_HEADROOM ? "warning" : "ok";
}

/** Null when there is nothing to draw: no snapshot, no limits on this account, or no watched window. */
export function deriveProviderLimitsMeter(
  limits: ServerProviderUsageLimits | undefined,
): ProviderLimitsMeterState | null {
  if (!limits || limits.unavailable?.reason === "unsupported") return null;
  const binding = bindingLimitWindow(watchedLimitWindows(limits.windows));
  if (binding === null) return null;
  const now = Date.parse(limits.checkedAt);
  return {
    now,
    windows: limits.windows,
    binding,
    remaining: remainingPercent(binding),
    timeLeft: timeLeftPercent(binding, now),
    severity: limitSeverity(binding, now),
  };
}
