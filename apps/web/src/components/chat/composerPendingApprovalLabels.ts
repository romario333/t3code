import { type ProviderRequestKind } from "@t3tools/contracts";

/** Names the pending request in the approval row, and stands in when a provider sends no detail. */
export const approvalKindLabel: Record<ProviderRequestKind, string> = {
  "mcp-elicitation": "App access approval",
  command: "Command approval",
  "file-read": "File read approval",
  "file-change": "File change approval",
};

/** Labels the detail region, which holds the command, path, or request text. */
export const approvalDetailLabel: Record<ProviderRequestKind, string> = {
  "mcp-elicitation": "App access request",
  command: "Command",
  "file-read": "File to read",
  "file-change": "File change",
};
