import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { approvalKindLabel } from "./composerPendingApprovalLabels";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  className?: string;
}

/**
 * Names what is waiting on the user, next to the decision buttons. The request
 * itself is too long to read on one row, so it lives in
 * ComposerPendingApprovalDetail instead.
 */
export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  className,
}: ComposerPendingApprovalPanelProps) {
  const label = approvalKindLabel[approval.requestKind];

  return (
    <span
      aria-label={label}
      className={cn("flex min-w-0 flex-1 items-center gap-2", className)}
      role="group"
    >
      {approval.appName ? (
        <span className="max-w-32 shrink truncate text-[11px] font-medium text-foreground">
          {approval.appName}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
        {label}
      </span>
      {pendingCount > 1 ? (
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
          1/{pendingCount}
        </span>
      ) : null}
    </span>
  );
});
