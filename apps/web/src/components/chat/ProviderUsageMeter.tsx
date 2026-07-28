import { cn } from "~/lib/utils";
import {
  formatUsageResetsIn,
  type ProviderUsageDisplay,
  type ProviderUsageWindowDisplay,
  resolveUsageWindowLevel,
  type UsagePaceLevel,
  usageWindowLabel,
} from "~/lib/providerUsage";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function levelColor(level: UsagePaceLevel): string {
  if (level === "error") {
    return "var(--destructive)";
  }
  if (level === "warning") {
    return "var(--warning)";
  }
  return "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

function UsageWindowRow(props: { window: ProviderUsageWindowDisplay; nowMs: number }) {
  const { window, nowMs } = props;
  const level = resolveUsageWindowLevel(window, nowMs);
  const color = levelColor(level);
  const normalizedPercentage = Math.max(0, Math.min(100, window.usedPercent));
  const label = usageWindowLabel(window.kind, window.modelSlug, window.windowDurationMins);
  const resetsIn = formatUsageResetsIn(window.resetsAt, nowMs);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted-foreground/60">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {formatPercentage(window.usedPercent)} used
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalizedPercentage)}
        aria-label={`${label} usage`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${normalizedPercentage}%`, backgroundColor: color }}
        />
      </div>
      {resetsIn ? (
        <div className="-mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground/50">
          resets in {resetsIn}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Subscription rate-limit meter for the active thread's provider (Claude /
 * Codex). Mirrors `ContextWindowMeter`'s ring, distinguished by the solid
 * center hub: context = hollow ring, usage = ring with a dot. The ring
 * tracks the weekly limit; the popover breaks down every reported window.
 */
export function ProviderUsageMeter(props: {
  usage: ProviderUsageDisplay;
  providerDisplayName?: string | null;
}) {
  const { usage, providerDisplayName } = props;
  const nowMs = Date.now();
  const primary = usage.primary;
  const usedPercentage = formatPercentage(primary.usedPercent);
  const normalizedPercentage = Math.max(0, Math.min(100, primary.usedPercent));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;
  const level = resolveUsageWindowLevel(primary, nowMs);
  const usageColor = levelColor(level);
  const primaryLabel = usageWindowLabel(
    primary.kind,
    primary.modelSlug,
    primary.windowDurationMins,
  );
  const providerLabel = providerDisplayName ?? "The provider";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={`${providerLabel} ${primaryLabel.toLowerCase()} ${usedPercentage} used`}
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3.5"
                  fill={usageColor}
                  className="opacity-60 transition-[fill] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="dropdown-glass w-64 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">
              {providerDisplayName ? `${providerDisplayName} usage` : "Usage limits"}
            </div>
            {usage.planLabel ? (
              <div className="text-[11px] text-muted-foreground/70">{usage.planLabel}</div>
            ) : null}
          </div>
          {usage.windows.map((window) => (
            <UsageWindowRow
              key={`${window.kind}:${window.modelSlug ?? ""}`}
              window={window}
              nowMs={nowMs}
            />
          ))}
          {primary.limitReached ? (
            <div className="text-pretty text-[11px] font-medium" style={{ color: usageColor }}>
              {providerLabel} has hit its {primaryLabel.toLowerCase()}.
            </div>
          ) : level !== "ok" ? (
            <div className="text-pretty text-[11px] font-medium" style={{ color: usageColor }}>
              On pace to hit the {providerLabel} {primaryLabel.toLowerCase()} before it resets.
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
