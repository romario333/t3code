import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingApprovalDetail } from "./ComposerPendingApprovalDetail";

describe("ComposerPendingApprovalDetail", () => {
  it("keeps a long command whole, wrapped and scrollable", () => {
    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalDetail
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail,
        }}
      />,
    );

    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain('aria-label="Command"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain(detail);
    expect(markup).toContain("max-h-50");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("whitespace-pre-wrap");
    expect(markup).toContain("wrap-break-word");
    expect(markup).toContain("font-mono");
    expect(markup).toContain("[scrollbar-width:thin]");
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });

  it("falls back to the approval kind when the provider sends an empty detail", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalDetail
        approval={{
          requestId: ApprovalRequestId.make("approval-2"),
          requestKind: "file-read",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail: "",
        }}
      />,
    );

    expect(markup).toContain('aria-label="File to read"');
    expect(markup).toContain("File read approval");
    expect(markup).toContain("font-mono");
  });

  it("shows the request message for an MCP access request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalDetail
        approval={{
          requestId: ApprovalRequestId.make("approval-safari"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName: "Safari",
          detail: "Allow ChatGPT to use Safari?",
        }}
      />,
    );

    expect(markup).toContain('aria-label="App access request"');
    expect(markup).toContain("Allow ChatGPT to use Safari?");
    // Prose, not a command: it keeps the composer font.
    expect(markup).not.toContain("font-mono");
    expect(markup).toContain("var(--font-composer,var(--font-sans))");
  });
});
