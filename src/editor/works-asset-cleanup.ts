import { createHash } from "node:crypto";

import type {
  WorksAssetAuditEntry,
  WorksAssetInventory,
  WorksAssetInventoryItem,
} from "./works-assets.ts";

export type WorksAssetCleanupCandidate = {
  publicUrl: string;
  filename: string;
  sha256: string;
  byteSize: number;
  format: WorksAssetInventoryItem["format"];
  referenceCount: 0;
  warnings: WorksAssetInventoryItem["warnings"];
  disposition: "deferred-no-delete";
};

export type WorksAssetCleanupReport = {
  schemaVersion: 1;
  mode: "read-only";
  referenceGraphComplete: boolean;
  eligibleForDeletion: false;
  snapshotSha256: string;
  candidates: WorksAssetCleanupCandidate[];
  audit: WorksAssetAuditEntry[];
};

const stableSnapshot = (
  assets: readonly WorksAssetInventoryItem[],
  audit: readonly WorksAssetAuditEntry[],
) =>
  JSON.stringify({
    assets: assets.map((asset) => ({
      publicUrl: asset.publicUrl,
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      format: asset.format,
      references: asset.references,
      warnings: asset.warnings,
      orphan: asset.orphan,
    })),
    audit,
  });

/**
 * Converts a read-only canonical inventory into deferred cleanup evidence.
 * This helper has deliberately no filesystem capability and never authorizes
 * deletion, even when the reference graph is complete.
 */
export function createWorksAssetCleanupReport(
  inventory: WorksAssetInventory,
): WorksAssetCleanupReport {
  const assets = [...inventory.assets].sort((a, b) =>
    a.publicUrl.localeCompare(b.publicUrl, "en"),
  );
  const audit = [...inventory.audit].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") || a.code.localeCompare(b.code),
  );
  const candidates = inventory.referenceGraphComplete
    ? assets.flatMap((asset): WorksAssetCleanupCandidate[] =>
        asset.orphan === true && asset.referenceCount === 0
          ? [
              {
                publicUrl: asset.publicUrl,
                filename: asset.filename,
                sha256: asset.sha256,
                byteSize: asset.byteSize,
                format: asset.format,
                referenceCount: 0,
                warnings: [...asset.warnings],
                disposition: "deferred-no-delete",
              },
            ]
          : [],
      )
    : [];

  return {
    schemaVersion: 1,
    mode: "read-only",
    referenceGraphComplete: inventory.referenceGraphComplete,
    eligibleForDeletion: false,
    snapshotSha256: createHash("sha256")
      .update(stableSnapshot(assets, audit))
      .digest("hex"),
    candidates,
    audit,
  };
}
