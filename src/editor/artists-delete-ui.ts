export const artistsDeleteEndpoint = "/editor/api/artists-delete";

export const artistsDeleteFailureGuidance = (code?: string) =>
  ({
    "backup-proof-required":
      "Choose a complete backup generation, then review again.",
    "backup-proof-stale":
      "Create and verify a fresh generation containing the current Artists file.",
    "incoming-reference":
      "Remove the incoming reference with a separately reviewed Save or keep this Artist.",
    "parser-uncertainty":
      "Resolve the unsupported or unreadable canonical reference before retrying.",
    "plan-stale":
      "Canonical or Git state drifted; request and review a fresh plan.",
    "state-mismatch":
      "Stop and reconcile the canonical files and lifecycle evidence.",
    "lock-conflict":
      "Finish or manually reconcile the existing lifecycle operation; the lock will not be stolen.",
    "rollback-failed":
      "Stop all Editor mutation and recover from the recorded operation bytes.",
    "pending-hero-publish-evidence":
      "Publish the saved Artist Hero asset before requesting Delete.",
  })[code ?? ""] ?? "Review the reported safety failure before retrying.";
