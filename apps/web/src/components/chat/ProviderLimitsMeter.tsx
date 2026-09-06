import { formatResetsIn } from "@t3tools/shared/usageLimits";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { LimitSeverity, ProviderLimitsMeterState } from "./ProviderLimitsMeter.logic";

const SEVERITY_COLOR: Record<LimitSeverity, string> = {
  ok: "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
};

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Endpoints of the pace tick, crossing the ring at the given share of the circle. */
function tickEnds(share: number) {
  const angle = (share / 100) * 2 * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x1: 12 + 7.25 * cos, y1: 12 + 7.25 * sin, x2: 12 + 12.25 * cos, y2: 12 + 12.25 * sin };
}

function statusLine(state: ProviderLimitsMeterState): string | null {
  const { binding, severity, remaining } = state;
  if (remaining <= 0) return `${binding.label} is used up.`;
  if (severity === "error") {
    return `${binding.label} is below the even-spending line and may run out before it resets.`;
  }
  if (severity === "warning") return `${binding.label} is close to the even-spending line.`;
  return null;
}

/**
 * Subscription limits for the provider that will run the next turn. Mirrors
 * `ContextWindowMeter`'s ring, told apart by the solid center hub. Unlike the
 * context ring, this one drains: the arc is the quota left in the tightest
 * weekly window, and the tick is where even spending would leave it, the same
 * line Usage → Limits draws. Hover for the one-line summary; click opens the
 * built-in /usage-limits panel with every window.
 */
export function ProviderLimitsMeter(props: {
  state: ProviderLimitsMeterState;
  providerLabel: string;
  onOpenDetails: (() => void) | undefined;
}) {
  const { state, providerLabel, onOpenDetails } = props;
  const { binding, remaining, timeLeft, severity } = state;
  const color = SEVERITY_COLOR[severity];
  const dashOffset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, remaining)) / 100);
  const tick = timeLeft === null ? null : tickEnds(timeLeft);
  const resetsIn = formatResetsIn(binding, state.now);
  const status = statusLine(state);
  const summary = `${binding.label} · ${remaining}% left${resetsIn ? ` · ${resetsIn}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-full hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={`${providerLabel} ${binding.label.toLowerCase()} limit: ${remaining}% left`}
            disabled={onOpenDetails === undefined}
            onClick={onOpenDetails}
          />
        }
      >
        <span className="relative flex size-5 items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
              strokeWidth="3"
            />
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
            />
            {tick ? (
              <line
                {...tick}
                stroke="var(--color-foreground)"
                strokeOpacity={0.6}
                strokeWidth="1.25"
                strokeLinecap="round"
              />
            ) : null}
            <circle
              cx="12"
              cy="12"
              r="3.5"
              fill={color}
              className="opacity-60 transition-[fill] duration-500 ease-out motion-reduce:transition-none"
            />
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top" align="end" className="max-w-72">
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">{summary}</span>
          {status ? <span style={{ color }}>{status}</span> : null}
          {onOpenDetails ? (
            <span className="text-muted-foreground">Click to open usage limits.</span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
