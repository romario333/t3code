import { memo } from "react";
import { type PendingApproval } from "../../session-logic";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
}: ComposerPendingApprovalPanelProps) {
  const approvalSummary =
    approval.requestKind === "command"
      ? "Command approval requested"
      : approval.requestKind === "file-read"
        ? "File-read approval requested"
        : "File-change approval requested";

  // Full command for command approvals; fall back to the short `detail` summary
  // for other kinds (or older/other providers that don't attach the command).
  const requestBody = approval.command ?? approval.detail ?? null;

  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="uppercase text-sm tracking-[0.2em]">PENDING APPROVAL</span>
        <span className="text-sm font-medium">{approvalSummary}</span>
        {pendingCount > 1 ? (
          <span className="text-xs text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
      {requestBody ? (
        <pre className="mt-2.5 max-h-40 overflow-auto wrap-break-word whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground/90 select-text">
          {requestBody}
        </pre>
      ) : null}
    </div>
  );
});
