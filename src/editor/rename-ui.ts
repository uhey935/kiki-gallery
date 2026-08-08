export type RenameCollection = "journal" | "news" | "exhibitions";

export type BrowserRenamePlan = {
  operation: "journal-rename" | "news-rename" | "exhibitions-rename";
  sourceContentId: string;
  destinationContentId: string;
  repositoryHead: string;
  repositoryBranch: string;
  oldRoutes: string[];
  newRoutes: string[];
  sourceFiles?: Record<string, string>;
  sourceFile?: string | { file: string; hash: string; size: number };
  referenceEdits?: Array<{ file: string; oldValue: string; newValue: string }>;
  planHash: string;
};

const renameGuidance: Record<string, string> = {
  "invalid-content-id":
    "Use a lowercase Content ID containing only letters, numbers, and single hyphens.",
  "content-id-collision":
    "Choose another Content ID; the destination path or its case-folded form already exists.",
  "unresolved-references":
    "Rename is blocked because an incoming Journal route reference must be resolved first.",
  "canonical-mismatch":
    "Canonical files or Git identity changed after review. Reload and request a new plan.",
  "unsafe-journal-root":
    "The Journal root or a path component failed the symlink/root safety check. Stop and inspect the repository.",
  "unsafe-news-root":
    "The News root or a path component failed the symlink/root safety check. Stop and inspect the repository.",
  "unsafe-repository":
    "The repository or lifecycle evidence root is unsafe. Stop and inspect it before retrying.",
  "source-unavailable":
    "The canonical source is missing, invalid, or unsafe. Reload after repairing the source.",
  "lock-conflict":
    "Another lifecycle operation holds the exclusive lock. Wait for it to finish, then request a new plan.",
  "journal-rename-rollback-failed":
    "Rollback failed. Stop all Editor mutations and follow manual recovery evidence.",
  "news-rename-rollback-failed":
    "Rollback failed. Stop all Editor mutations and follow manual recovery evidence.",
  "destination-conflict":
    "Choose another Content ID; the destination path or its case-folded form already exists.",
  "reference-graph-incomplete":
    "Rename stopped because the complete canonical reference graph could not be proven safe.",
  "reference-rewrite-unsupported":
    "A known incoming reference cannot be rewritten without changing unrelated bytes. Repair it and request a new plan.",
  "prospective-validation-failed":
    "The complete proposed content graph did not validate. No partial Rename is allowed.",
  "plan-stale":
    "Git, canonical bytes, destination, or references changed after review. Request and confirm a fresh plan.",
  "lifecycle-lock-conflict":
    "Another lifecycle operation owns or may own the repository lock. Reconcile it before retrying.",
  "rename-failed-rolled-back":
    "Rename failed, but every touched file was restored byte-for-byte. Inspect evidence before replanning.",
  "manual-recovery-required":
    "Rollback could not be proven. Stop all mutations and preserve the lock, evidence, staging, and recovery bytes.",
};

export function renameFailureGuidance(code?: string): string {
  return (
    (code && renameGuidance[code]) ??
    "Rename did not complete. Keep the current workspace open and request a new plan before retrying."
  );
}

export function renameEndpoint(collection: RenameCollection) {
  return `/editor/api/${collection}-rename`;
}

export function renameWorkspaceUrl(
  collection: RenameCollection,
  contentId: string,
) {
  return `/editor/${collection}/workspace/${encodeURIComponent(contentId)}/`;
}
