import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";

const codeClassName =
  "max-h-80 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-[length:var(--font-size-code,0.6875rem)] leading-relaxed select-text";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Codex MCP rows carry the item (`arguments`), Claude rows the tool input. */
function mcpArguments(toolData: unknown): string | null {
  const data = asRecord(toolData);
  const args = data?.arguments ?? data?.input;
  if (args === undefined || args === null) return null;
  return typeof args === "string" ? args : JSON.stringify(args, null, 2);
}

function Section(props: { label: string; children: ReactNode }) {
  return (
    <div className="not-first:mt-2 not-first:border-t not-first:border-border/50 not-first:pt-2">
      <p className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
        {props.label}
      </p>
      {props.children}
    </div>
  );
}

/**
 * Expanded view of a completed command or MCP call: what ran, then what it
 * returned. The output is fetched only while the row is expanded.
 */
export function ToolCallDetails(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  toolCallId: string;
  entry: {
    itemType?: string | undefined;
    command?: string | undefined;
    rawCommand?: string | undefined;
    toolData?: unknown;
  };
}) {
  const { entry } = props;
  const isMcp = entry.itemType === "mcp_tool_call";
  const input = isMcp
    ? mcpArguments(entry.toolData)
    : (entry.command?.trim() ?? entry.rawCommand?.trim() ?? null);
  const result = useAtomValue(
    orchestrationEnvironment.toolOutput({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, toolCallId: props.toolCallId },
    }),
  );
  const status =
    result._tag === "Failure"
      ? "Could not load output."
      : result._tag !== "Success"
        ? "Loading…"
        : result.value.output === null
          ? "No output."
          : null;
  return (
    <>
      {input ? (
        <Section label={isMcp ? "Arguments" : "Command"}>
          <pre className={cn(codeClassName, "text-foreground")}>{isMcp ? input : `$ ${input}`}</pre>
        </Section>
      ) : null}
      <Section label={isMcp ? "Result" : "Output"}>
        {status ? (
          <p className="text-muted-foreground text-xs">{status}</p>
        ) : (
          <pre className={cn(codeClassName, "text-secondary-label")}>
            {result._tag === "Success" && result.value.output}
          </pre>
        )}
      </Section>
    </>
  );
}
