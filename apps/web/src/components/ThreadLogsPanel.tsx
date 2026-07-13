import type { ScopedThreadRef, ServerProviderEventLogEntry } from "@t3tools/contracts";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const AUTO_SCROLL_THRESHOLD_PX = 48;

function formatEntryTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleTimeString(undefined, { hour12: false });
}

function LogEntryRow(props: { entry: ServerProviderEventLogEntry }) {
  const { entry } = props;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left font-mono text-xs hover:bg-accent/60"
      >
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatEntryTime(entry.timestamp)}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1 text-[10px] font-medium uppercase",
            entry.stream === "canonical"
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {entry.stream === "canonical" ? "canon" : "native"}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{entry.summary}</span>
      </button>
      {expanded ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {entry.raw}
          {entry.truncated ? "\n… (raw payload truncated)" : null}
        </pre>
      ) : null}
    </div>
  );
}

export default function ThreadLogsPanel(props: { threadRef: ScopedThreadRef }) {
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    serverEnvironment.providerEventLog({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId },
    }),
  );
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "provider-event-log-path" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const entries = data?.entries ?? [];
  const lastEntryCount = entries.length;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [lastEntryCount]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    stickToBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      AUTO_SCROLL_THRESHOLD_PX;
  };

  const entryKeyCounts = new Map<string, number>();
  const keyedEntries = entries.map((entry) => {
    const base = `${entry.timestamp}:${entry.stream}:${entry.summary}`;
    const count = entryKeyCounts.get(base) ?? 0;
    entryKeyCounts.set(base, count + 1);
    return { key: count === 0 ? base : `${base}:${count}`, entry };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {data?.exists ? `${entries.length} provider events` : "Provider event log"}
              </span>
            }
          />
          {data ? <TooltipPopup side="bottom">{data.logFilePath}</TooltipPopup> : null}
        </Tooltip>
        {data ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => copyToClipboard(data.logFilePath)}
                  aria-label="Copy log file path"
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              }
            />
            <TooltipPopup side="bottom">{isCopied ? "Copied!" : "Copy log file path"}</TooltipPopup>
          </Tooltip>
        ) : null}
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh logs"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", isPending && "animate-spin")} />
        </button>
      </div>
      {data?.truncatedHead ? (
        <div className="shrink-0 border-b border-border/40 px-3 py-1 text-[11px] text-muted-foreground">
          Showing the latest {entries.length} entries.
        </div>
      ) : null}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        {error !== null ? (
          <div className="px-3 py-4 text-xs text-destructive">{error}</div>
        ) : data !== null && !data.exists ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No provider events recorded for this thread yet.
          </div>
        ) : (
          keyedEntries.map(({ key, entry }) => <LogEntryRow key={key} entry={entry} />)
        )}
      </div>
    </div>
  );
}
