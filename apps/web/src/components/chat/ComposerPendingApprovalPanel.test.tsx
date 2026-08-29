import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

describe("ComposerPendingApprovalPanel", () => {
  it("names the request instead of clipping it into the row", () => {
    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Command approval"');
    expect(markup).toContain("Command approval");
    expect(markup).not.toContain(detail);
    expect(markup).not.toContain("data-approval-detail");
    expect(markup).toContain("min-w-0");
  });

  it("labels each approval kind", () => {
    const kinds = [
      ["file-read", "File read approval"],
      ["file-change", "File change approval"],
      ["mcp-elicitation", "App access approval"],
    ] as const;

    for (const [requestKind, label] of kinds) {
      const markup = renderToStaticMarkup(
        <ComposerPendingApprovalPanel
          approval={{
            requestId: ApprovalRequestId.make(`approval-${requestKind}`),
            requestKind,
            createdAt: "2026-07-18T00:00:00.000Z",
            detail: "",
          }}
          pendingCount={1}
        />,
      );

      expect(markup).toContain(label);
    }
  });

  it("shows the app name for an MCP access request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-safari"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName: "Safari",
          detail: "Allow ChatGPT to use Safari?",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('aria-label="App access approval"');
    expect(markup).toContain(">Safari<");
  });

  it("limits long app names so the label stays visible", () => {
    const appName = "A".repeat(200);
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-long-app-name"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName,
          detail: "Allow ChatGPT to access the selected application?",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("max-w-32 shrink truncate");
    expect(markup).toContain(appName);
  });

  it("counts the queue when more than one approval is waiting", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-queued"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail: "ls",
        }}
        pendingCount={3}
      />,
    );

    expect(markup).toContain("1/3");
  });
});
