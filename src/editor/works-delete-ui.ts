export const worksDeleteEndpoint = "/editor/api/works-delete";
export const worksDeleteFailureGuidance = (code?: string) =>
  ({
    "backup-proof-required":
      "Choose a complete backup generation, then review again.",
    "backup-proof-stale":
      "Create and verify a fresh generation containing the exact current Works Markdown.",
    "incoming-reference":
      "Remove the incoming reference in a separate reviewed Save or keep this Work.",
    "parser-uncertainty":
      "Resolve the unsupported or unreadable canonical reference before retrying.",
    "pending-asset-state":
      "Save, publish, or explicitly abandon all pending image changes before Delete.",
    "unpublished-asset-manifest":
      "Publish or reconcile the saved asset manifest before Delete.",
    "asset-lifecycle-state":
      "Reconcile pending asset operations, unsafe paths, or lifecycle evidence before retrying.",
    "plan-stale":
      "Content, Git, asset, or lifecycle state drifted; request and review a fresh plan.",
    "lock-conflict":
      "Finish or manually reconcile the active content/asset operation; locks are never stolen.",
    "rollback-failed":
      "Stop all Editor mutation and recover using the durable operation evidence.",
  })[code ?? ""] ?? "Review the reported safety failure before retrying.";
