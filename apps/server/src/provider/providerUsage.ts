/**
 * providerUsage — account-scoped subscription rate-limit usage for provider
 * instances (Claude 5-hour/weekly windows, Codex primary/secondary windows).
 *
 * A `ProviderUsageStore` holds the latest normalized `ServerProviderUsage`
 * per instance and republishes it as a stream so the driver's
 * `enrichSnapshot` loop can attach it to the instance's `ServerProvider`
 * snapshot. Normalizers translate the provider-native payload shapes
 * (Claude SDK push events, the experimental Claude usage pull API, Codex
 * `account/rateLimits/*` snapshots) into the canonical contract windows.
 *
 * @module provider/providerUsage
 */
import type {
  ServerProvider,
  ServerProviderUsage,
  ServerProviderUsageWindow,
  ServerProviderUsageWindowKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

const SESSION_WINDOW_DURATION_MINS = 300;
const WEEKLY_WINDOW_DURATION_MINS = 10_080;

export interface ProviderUsageApplyOptions {
  readonly planLabel?: string | undefined;
  /**
   * Full-snapshot semantics: windows absent from this update are dropped.
   * Without it updates merge per-window (Claude push events carry a single
   * window; Codex `account/rateLimits/updated` notifications are sparse).
   */
  readonly replace?: boolean | undefined;
}

export interface ProviderUsageStore {
  readonly get: Effect.Effect<ServerProviderUsage | undefined>;
  readonly applyWindows: (
    windows: ReadonlyArray<ServerProviderUsageWindow>,
    options?: ProviderUsageApplyOptions,
  ) => Effect.Effect<void>;
  /** Usage is not applicable (API key / Bedrock / Vertex auth). */
  readonly clear: Effect.Effect<void>;
  readonly changes: Stream.Stream<ServerProviderUsage | undefined>;
}

const WINDOW_KIND_ORDER: Readonly<Record<ServerProviderUsageWindowKind, number>> = {
  session: 0,
  weekly: 1,
};

/** Merge identity: model-specific weekly caps are distinct windows. */
function windowMergeKey(window: ServerProviderUsageWindow): string {
  return window.modelSlug === undefined ? window.kind : `${window.kind}:${window.modelSlug}`;
}

function compareWindows(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): number {
  const byKind = WINDOW_KIND_ORDER[a.kind] - WINDOW_KIND_ORDER[b.kind];
  if (byKind !== 0) {
    return byKind;
  }
  // Account-wide window before model-specific caps, those alphabetically.
  return (a.modelSlug ?? "").localeCompare(b.modelSlug ?? "");
}

function sameWindowValues(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.kind === b.kind &&
    a.modelSlug === b.modelSlug &&
    a.usedPercent === b.usedPercent &&
    a.resetsAt === b.resetsAt &&
    a.windowDurationMins === b.windowDurationMins &&
    (a.limitReached ?? false) === (b.limitReached ?? false)
  );
}

/**
 * Merge an update into the current usage value. Returns the exact `current`
 * reference when the update is a no-op (same window values, same plan) so
 * callers can skip publishing.
 */
export function mergeProviderUsage(
  current: ServerProviderUsage | undefined,
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  options?: ProviderUsageApplyOptions,
): ServerProviderUsage | undefined {
  const replace = options?.replace === true;
  if (replace && windows.length === 0) {
    return undefined;
  }

  const currentByKey = new Map<string, ServerProviderUsageWindow>();
  for (const window of current?.windows ?? []) {
    currentByKey.set(windowMergeKey(window), window);
  }
  const byKey = new Map<string, ServerProviderUsageWindow>(replace ? [] : currentByKey);
  for (const window of windows) {
    const key = windowMergeKey(window);
    // Compare against the current value even under replace semantics: keep
    // the previous object (and its updatedAt) when nothing changed so
    // repeated identical updates don't churn snapshot publishes.
    const existing = byKey.get(key) ?? currentByKey.get(key);
    byKey.set(key, existing && sameWindowValues(existing, window) ? existing : window);
  }
  if (byKey.size === 0) {
    return current;
  }

  const nextWindows = [...byKey.values()].sort(compareWindows);
  const planLabel = options?.planLabel ?? current?.planLabel;
  const unchanged =
    current !== undefined &&
    current.planLabel === planLabel &&
    current.windows.length === nextWindows.length &&
    current.windows.every((window, index) => window === nextWindows[index]);
  if (unchanged) {
    return current;
  }

  const updatedAt = nextWindows.reduce(
    (latest, window) => (window.updatedAt > latest ? window.updatedAt : latest),
    current?.updatedAt ?? nextWindows[0]!.updatedAt,
  );
  return {
    windows: nextWindows,
    ...(planLabel !== undefined ? { planLabel } : {}),
    updatedAt,
  };
}

export const makeProviderUsageStore: Effect.Effect<ProviderUsageStore> = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<ServerProviderUsage | undefined>(undefined);
  return {
    get: SubscriptionRef.get(ref),
    applyWindows: (windows, options) =>
      SubscriptionRef.updateSome(ref, (current) => {
        const next = mergeProviderUsage(current, windows, options);
        return next === current ? Option.none() : Option.some(next);
      }),
    clear: SubscriptionRef.updateSome(ref, (current) =>
      current === undefined ? Option.none() : Option.some(undefined),
    ),
    changes: SubscriptionRef.changes(ref),
  } satisfies ProviderUsageStore;
});

/**
 * Attach the usage store to a managed snapshot's enrichment loop: every
 * store emission is merged onto the *latest* snapshot and republished via
 * `updateSnapshot`, which the caller must make atomic against any other
 * concurrent snapshot writer. `SubscriptionRef.changes` replays the
 * current value on subscribe, so usage survives the periodic
 * `checkProvider` snapshot rebuild.
 */
export const attachUsageOnChange = (input: {
  readonly usageStore: ProviderUsageStore;
  readonly updateSnapshot: (
    update: (snapshot: ServerProvider) => ServerProvider,
  ) => Effect.Effect<void>;
}): Effect.Effect<void> =>
  Stream.runForEach(input.usageStore.changes, (usage) =>
    input.updateSnapshot((snapshot) => applyUsageToSnapshot(snapshot, usage)),
  );

export function applyUsageToSnapshot(
  snapshot: ServerProvider,
  usage: ServerProviderUsage | undefined,
): ServerProvider {
  if (usage === undefined) {
    if (snapshot.usage === undefined) {
      return snapshot;
    }
    const { usage: _dropped, ...rest } = snapshot;
    return rest;
  }
  return { ...snapshot, usage };
}

// ── Normalizers ─────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Providers report reset timestamps as epoch seconds (Claude SDK, Codex
 * app-server); tolerate milliseconds defensively and normalize to ISO.
 */
function epochToIso(value: unknown): string | null {
  const epoch = finiteNumber(value);
  if (epoch === undefined || epoch <= 0) {
    return null;
  }
  const millis = epoch > 1e12 ? epoch : epoch * 1000;
  return Option.match(DateTime.make(millis), {
    onNone: () => null,
    onSome: DateTime.formatIso,
  });
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return Option.match(DateTime.make(value), {
    onNone: () => null,
    onSome: DateTime.formatIso,
  });
}

/**
 * Non-model `seven_day_*` variants: OAuth-app attribution and overage
 * bookkeeping are not usage windows the meter should surface.
 */
const CLAUDE_NON_MODEL_WEEKLY_SUFFIXES = new Set(["oauth_apps", "overage_included"]);

interface ClaudeWindowIdentity {
  readonly kind: ServerProviderUsageWindowKind;
  readonly modelSlug?: string;
}

/**
 * Map a Claude window type (`five_hour`, `seven_day`, `seven_day_opus`,
 * `seven_day_fable`, ...) to its canonical identity. Model-specific weekly
 * caps are parsed by convention so new models surface without code changes.
 */
function claudeWindowIdentity(rateLimitType: string): ClaudeWindowIdentity | undefined {
  if (rateLimitType === "five_hour") {
    return { kind: "session" };
  }
  if (rateLimitType === "seven_day") {
    return { kind: "weekly" };
  }
  if (rateLimitType.startsWith("seven_day_")) {
    const suffix = rateLimitType.slice("seven_day_".length);
    if (suffix.length === 0 || CLAUDE_NON_MODEL_WEEKLY_SUFFIXES.has(suffix)) {
      return undefined;
    }
    return { kind: "weekly", modelSlug: suffix };
  }
  return undefined;
}

/**
 * Normalize a Claude Agent SDK `rate_limit_event`'s `rate_limit_info`
 * payload. Each push event carries a single window — the one currently
 * binding — so results are meant for a per-window merge.
 */
export function normalizeClaudeRateLimitEvent(
  rateLimitInfo: unknown,
  now: string,
): ReadonlyArray<ServerProviderUsageWindow> | undefined {
  const info = asRecord(rateLimitInfo);
  if (!info) {
    return undefined;
  }
  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  const identity = rateLimitType !== undefined ? claudeWindowIdentity(rateLimitType) : undefined;
  const utilization = finiteNumber(info.utilization);
  if (identity === undefined || utilization === undefined) {
    return undefined;
  }
  return [
    {
      kind: identity.kind,
      ...(identity.modelSlug !== undefined ? { modelSlug: identity.modelSlug } : {}),
      usedPercent: utilization,
      resetsAt: epochToIso(info.resetsAt),
      windowDurationMins:
        identity.kind === "session" ? SESSION_WINDOW_DURATION_MINS : WEEKLY_WINDOW_DURATION_MINS,
      ...(info.status === "rejected" ? { limitReached: true } : {}),
      updatedAt: now,
    },
  ];
}

export interface ClaudeUsageReadResult {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly planLabel: string | undefined;
}

/**
 * Parse the `rate_limits.limits[]` array — the richest source in the usage
 * response. Each entry is `{ kind: "session" | "weekly_all" |
 * "weekly_scoped", group: "session" | "weekly", percent, resets_at,
 * severity, scope }`, where model-specific caps (e.g. Fable's weekly
 * limit) carry `scope.model` instead of a dedicated `seven_day_<model>`
 * key. Returns undefined when the array is absent or empty so callers can
 * fall back to the legacy fixed keys.
 */
function normalizeClaudeLimitsArray(
  raw: unknown,
  now: string,
): ReadonlyArray<ServerProviderUsageWindow> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const windows: Array<ServerProviderUsageWindow> = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const percent = record ? finiteNumber(record.percent) : undefined;
    if (!record || percent === undefined) {
      continue;
    }
    const group = record.group;
    if (group !== "session" && group !== "weekly") {
      continue;
    }
    let modelSlug: string | undefined;
    const scope = asRecord(record.scope);
    if (scope) {
      const model = asRecord(scope.model);
      // Prefer display_name ("Fable" → "fable"): it matches the
      // `seven_day_<suffix>` slug the push events use, so both sources
      // merge under one window key instead of showing the cap twice.
      const modelName =
        typeof model?.display_name === "string" && model.display_name.length > 0
          ? model.display_name
          : typeof model?.id === "string" && model.id.length > 0
            ? model.id
            : undefined;
      if (modelName === undefined) {
        // Scoped to something we don't understand (e.g. a surface); skip
        // rather than mislabel it as an account-wide window.
        continue;
      }
      modelSlug = modelName.toLowerCase();
    }
    windows.push({
      kind: group,
      ...(modelSlug !== undefined ? { modelSlug } : {}),
      usedPercent: percent,
      resetsAt: isoOrNull(record.resets_at),
      windowDurationMins:
        group === "session" ? SESSION_WINDOW_DURATION_MINS : WEEKLY_WINDOW_DURATION_MINS,
      ...(record.severity === "exceeded" || record.severity === "rejected"
        ? { limitReached: true }
        : {}),
      updatedAt: now,
    });
  }
  return windows.length > 0 ? windows : undefined;
}

/**
 * Normalize the response of the experimental Claude Agent SDK usage pull
 * API (the data behind Claude Code's `/usage`). Returns `"unavailable"`
 * when the account has no subscription rate limits (API key / Bedrock /
 * Vertex) so callers can clear any previously observed usage.
 */
export function normalizeClaudeUsageReadResponse(
  raw: unknown,
  now: string,
): ClaudeUsageReadResult | "unavailable" | undefined {
  const response = asRecord(raw);
  if (!response) {
    return undefined;
  }
  if (response.rate_limits_available === false) {
    return "unavailable";
  }
  const rateLimits = asRecord(response.rate_limits);
  if (!rateLimits) {
    return response.rate_limits === null ? "unavailable" : undefined;
  }

  // Prefer the limits[] array (carries model-scoped caps); fall back to
  // the legacy fixed keys, where model caps surface by naming convention
  // (seven_day_opus, ...) and non-window keys (extra_usage,
  // seven_day_oauth_apps, ...) fall out of claudeWindowIdentity.
  const windows = [...(normalizeClaudeLimitsArray(rateLimits.limits, now) ?? [])];
  if (windows.length === 0) {
    for (const [key, value] of Object.entries(rateLimits)) {
      const identity = claudeWindowIdentity(key);
      if (!identity) {
        continue;
      }
      const window = asRecord(value);
      const utilization = window ? finiteNumber(window.utilization) : undefined;
      if (!window || utilization === undefined) {
        continue;
      }
      windows.push({
        kind: identity.kind,
        ...(identity.modelSlug !== undefined ? { modelSlug: identity.modelSlug } : {}),
        usedPercent: utilization,
        resetsAt: isoOrNull(window.resets_at),
        windowDurationMins:
          identity.kind === "session" ? SESSION_WINDOW_DURATION_MINS : WEEKLY_WINDOW_DURATION_MINS,
        updatedAt: now,
      });
    }
  }
  if (windows.length === 0) {
    return undefined;
  }

  return {
    windows,
    planLabel:
      typeof response.subscription_type === "string" && response.subscription_type.length > 0
        ? response.subscription_type
        : undefined,
  };
}

/**
 * Structural subset shared by `V2GetAccountRateLimitsResponse["rateLimits"]`
 * and `V2AccountRateLimitsUpdatedNotification["rateLimits"]`.
 */
export interface CodexRateLimitSnapshotLike {
  readonly planType?: string | null | undefined;
  readonly primary?: CodexRateLimitWindowLike | null | undefined;
  readonly secondary?: CodexRateLimitWindowLike | null | undefined;
  readonly rateLimitReachedType?: string | null | undefined;
}

export interface CodexRateLimitWindowLike {
  readonly resetsAt?: number | null | undefined;
  readonly usedPercent: number;
  readonly windowDurationMins?: number | null | undefined;
}

export interface CodexRateLimitsResult {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly planLabel: string | undefined;
}

/** Normalize a Codex `account/rateLimits/read` or `.../updated` snapshot. */
export function normalizeCodexRateLimits(
  rateLimits: CodexRateLimitSnapshotLike,
  now: string,
): CodexRateLimitsResult | undefined {
  const windows: Array<ServerProviderUsageWindow> = [];
  const readWindow = (
    window: CodexRateLimitWindowLike | null | undefined,
    fallbackKind: ServerProviderUsageWindowKind,
  ) => {
    const usedPercent = window ? finiteNumber(window.usedPercent) : undefined;
    if (!window || usedPercent === undefined) {
      return;
    }
    const durationMins = finiteNumber(window.windowDurationMins ?? undefined);
    const kind: ServerProviderUsageWindowKind =
      durationMins !== undefined ? (durationMins <= 1440 ? "session" : "weekly") : fallbackKind;
    windows.push({
      kind,
      usedPercent,
      resetsAt: epochToIso(window.resetsAt),
      windowDurationMins: durationMins ?? null,
      updatedAt: now,
    });
  };
  readWindow(rateLimits.primary, "session");
  readWindow(rateLimits.secondary, "weekly");
  if (windows.length === 0) {
    return undefined;
  }
  if (rateLimits.rateLimitReachedType != null) {
    // The reached marker is account-level and doesn't say which window
    // tripped; attribute it to the exhausted window(s), falling back to
    // the most-used one, so a hit 5-hour limit isn't blamed on weekly.
    const exhausted = windows.filter((window) => window.usedPercent >= 100);
    const targets =
      exhausted.length > 0
        ? exhausted
        : [windows.reduce((max, window) => (window.usedPercent > max.usedPercent ? window : max))];
    for (const target of targets) {
      windows[windows.indexOf(target)] = { ...target, limitReached: true };
    }
  }

  return {
    windows,
    planLabel:
      typeof rateLimits.planType === "string" && rateLimits.planType.length > 0
        ? rateLimits.planType
        : undefined,
  };
}
