import type { ServerProviderUsage, ServerProviderUsageWindowKind } from "@t3tools/contracts";

export type UsagePaceLevel = "ok" | "warning" | "error";

export interface ProviderUsageWindowDisplay {
  readonly kind: ServerProviderUsageWindowKind;
  /** Set for model-specific weekly caps (e.g. "opus", "fable"). */
  readonly modelSlug: string | null;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt: string | null;
  readonly windowDurationMins: number | null;
  readonly limitReached: boolean;
  readonly updatedAt: string;
}

export interface ProviderUsageDisplay {
  /** Drives the meter ring: the weekly window when present, else the session one. */
  readonly primary: ProviderUsageWindowDisplay;
  /** Every reported window (primary first) for the popover breakdown. */
  readonly windows: ReadonlyArray<ProviderUsageWindowDisplay>;
  readonly planLabel: string | null;
}

/** Project usage into display shape; null when there is nothing to show. */
export function deriveProviderUsageDisplay(
  usage: ServerProviderUsage | undefined,
): ProviderUsageDisplay | null {
  if (!usage || usage.windows.length === 0) {
    return null;
  }
  const windows = usage.windows
    .filter((window) => Number.isFinite(window.usedPercent))
    .map(
      (window): ProviderUsageWindowDisplay => ({
        kind: window.kind,
        modelSlug: window.modelSlug ?? null,
        usedPercent: window.usedPercent,
        remainingPercent: Math.max(0, 100 - window.usedPercent),
        resetsAt: window.resetsAt,
        windowDurationMins: window.windowDurationMins,
        limitReached: window.limitReached ?? false,
        updatedAt: window.updatedAt,
      }),
    );
  const primary =
    windows.find((window) => window.kind === "weekly" && window.modelSlug === null) ??
    windows.find((window) => window.kind === "weekly") ??
    windows.find((window) => window.kind === "session");
  if (!primary) {
    return null;
  }
  return {
    primary,
    windows: [primary, ...windows.filter((window) => window !== primary)],
    planLabel: usage.planLabel ?? null,
  };
}

const MINUTES_PER_DAY = 1_440;

/**
 * Pace-aware severity for the weekly window: "how many days of usage does
 * the full budget support at the average daily burn observed so far in
 * this window?"
 *
 * `capacityDays = elapsedDays * 100 / usedPercent`, with `elapsedDays`
 * clamped to >= 1 so a heavy first hour doesn't instantly trip error.
 * Under 6 days is a warning, under 5 an error. Deliberately a single pure
 * function so the formula is trivially swappable.
 */
export function resolveUsagePaceLevel(input: {
  readonly usedPercent: number;
  readonly windowDurationMins: number | null;
  readonly resetsAt: string | null;
  readonly nowMs: number;
  readonly limitReached?: boolean;
}): UsagePaceLevel {
  if (input.limitReached === true || input.usedPercent >= 100) {
    return "error";
  }
  if (input.usedPercent <= 0 || !Number.isFinite(input.usedPercent)) {
    return "ok";
  }
  const elapsedDays = computeElapsedDays(input);
  const capacityDays = (elapsedDays * 100) / input.usedPercent;
  if (capacityDays < 5) {
    return "error";
  }
  if (capacityDays < 6) {
    return "warning";
  }
  return "ok";
}

/**
 * Severity for one window. Weekly windows use the pace projection above;
 * session windows reset within hours, so only near-exhaustion is notable.
 */
export function resolveUsageWindowLevel(
  window: {
    readonly kind: ServerProviderUsageWindowKind;
    readonly usedPercent: number;
    readonly windowDurationMins: number | null;
    readonly resetsAt: string | null;
    readonly limitReached?: boolean;
  },
  nowMs: number,
): UsagePaceLevel {
  if (window.kind === "weekly") {
    return resolveUsagePaceLevel({
      usedPercent: window.usedPercent,
      windowDurationMins: window.windowDurationMins,
      resetsAt: window.resetsAt,
      nowMs,
      ...(window.limitReached !== undefined ? { limitReached: window.limitReached } : {}),
    });
  }
  if (window.limitReached === true || window.usedPercent >= 95) {
    return "error";
  }
  if (window.usedPercent >= 80) {
    return "warning";
  }
  return "ok";
}

function computeElapsedDays(input: {
  readonly windowDurationMins: number | null;
  readonly resetsAt: string | null;
  readonly nowMs: number;
}): number {
  if (input.windowDurationMins === null || input.resetsAt === null) {
    return 1;
  }
  const resetMs = Date.parse(input.resetsAt);
  if (!Number.isFinite(resetMs)) {
    return 1;
  }
  const minutesUntilReset = Math.max(0, (resetMs - input.nowMs) / 60_000);
  const elapsedMins =
    input.windowDurationMins - Math.min(minutesUntilReset, input.windowDurationMins);
  return Math.max(1, elapsedMins / MINUTES_PER_DAY);
}

/** Format the time until reset, e.g. "3d 4h", "4h 30m", "45m"; null when unknown or past. */
export function formatUsageResetsIn(resetsAt: string | null, nowMs: number): string | null {
  if (resetsAt === null) {
    return null;
  }
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs) || resetMs <= nowMs) {
    return null;
  }
  const totalMinutes = Math.round((resetMs - nowMs) / 60_000);
  if (totalMinutes < 1) {
    return "less than a minute";
  }
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function usageWindowLabel(
  kind: ServerProviderUsageWindowKind,
  modelSlug?: string | null,
  windowDurationMins?: number | null,
): string {
  if (kind !== "weekly") {
    // Codex may report a different (or no) session window length, so only
    // state a duration the provider actually gave us.
    if (windowDurationMins == null || windowDurationMins <= 0) {
      return "Session limit";
    }
    const duration =
      windowDurationMins % 60 === 0 ? `${windowDurationMins / 60}h` : `${windowDurationMins}m`;
    return `Session limit (${duration})`;
  }
  if (modelSlug == null || modelSlug.length === 0) {
    return "Weekly limit";
  }
  const model = modelSlug.charAt(0).toUpperCase() + modelSlug.slice(1);
  return `${model} weekly limit`;
}
