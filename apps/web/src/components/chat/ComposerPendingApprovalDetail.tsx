import { memo } from "react";
import { type PendingApproval } from "../../session-logic";
import { approvalDetailLabel, approvalKindLabel } from "./composerPendingApprovalLabels";
import { cn } from "~/lib/utils";

interface ComposerPendingApprovalDetailProps {
  approval: PendingApproval;
  className?: string;
}

/**
 * Shows the whole thing being approved at composer size. Long commands wrap and
 * scroll here instead of being clipped, so nothing is hidden behind a truncation.
 * Sized to match the prompt editor it stands in for.
 */
export const ComposerPendingApprovalDetail = memo(function ComposerPendingApprovalDetail({
  approval,
  className,
}: ComposerPendingApprovalDetailProps) {
  // Commands and paths belong in the code font; an app access request is a
  // sentence, and monospaced prose just reads as broken.
  const isProse = approval.requestKind === "mcp-elicitation";

  return (
    <div
      aria-label={approvalDetailLabel[approval.requestKind]}
      className={cn(
        "block max-h-50 min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word",
        isProse ? "[font-family:var(--font-composer,var(--font-sans))]" : "font-mono",
        // Sized off the prompt, not the code size: this stands in for the composer.
        "[font-size:var(--font-size-prompt,0.875rem)]",
        "leading-relaxed text-foreground/85",
        "[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        className,
      )}
      data-approval-detail="complete"
      tabIndex={0}
    >
      {approval.detail || approvalKindLabel[approval.requestKind]}
    </div>
  );
});
