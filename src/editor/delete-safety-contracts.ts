import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { verifyBackup } from "./backup-recovery.ts";

export const CONTENT_RECOVERY_ROOT = ".kiki-editor/content-lifecycle/recovery";
export const CONTENT_OPERATION_ROOT =
  ".kiki-editor/content-lifecycle/operations";
export const CONTENT_RECOVERY_SCHEMA_VERSION = 1 as const;
export const DELETE_REFERENCE_ADAPTER_VERSION =
  "delete-reference-graph-v1" as const;

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const safeRelative = (value: string) =>
  !path.isAbsolute(value) &&
  !value.split(/[\\/]/).includes("..") &&
  value.split(path.sep).join("/") === value;

export type DeletePreimage = { path: string; sha256: string; byteSize: number };
export type PreDeleteBackupProof = {
  schemaVersion: 1;
  backupId: string;
  backupManifestSha256: string;
  verifiedAt: string;
  policyCommit: string;
  sourcePreimages: DeletePreimage[];
};

export async function provePreDeleteBackup(input: {
  backupRoot: string;
  sourcePreimages: DeletePreimage[];
  policyCommit: string;
  verifiedAt?: string;
}): Promise<PreDeleteBackupProof> {
  if (
    !/^[a-f0-9]{40,64}$/.test(input.policyCommit) ||
    !input.sourcePreimages.length
  )
    throw new Error(
      "Delete backup proof requires a policy commit and source preimages",
    );
  const manifest = await verifyBackup(input.backupRoot);
  for (const expected of input.sourcePreimages) {
    if (!safeRelative(expected.path))
      throw new Error(`Unsafe Delete preimage: ${expected.path}`);
    const file = manifest.files.find(
      (candidate) => candidate.path === expected.path,
    );
    if (
      !file ||
      file.sha256 !== expected.sha256 ||
      file.byteSize !== expected.byteSize
    )
      throw new Error(
        `Backup does not contain the exact Delete preimage: ${expected.path}`,
      );
  }
  const manifestBytes = await fs.readFile(
    path.join(input.backupRoot, "manifest.json"),
  );
  return {
    schemaVersion: 1,
    backupId: manifest.backupId,
    backupManifestSha256: sha256(manifestBytes),
    verifiedAt: new Date(input.verifiedAt ?? Date.now()).toISOString(),
    policyCommit: input.policyCommit,
    sourcePreimages: [...input.sourcePreimages].sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
  };
}

export type ContentRecoveryState =
  "prepared" | "completed" | "rolled-back" | "manual-recovery-required";
export type ContentRecoveryRecord = {
  schemaVersion: 1;
  operation: "content-delete";
  operationId: string;
  collection: "journal" | "news" | "exhibitions" | "artists" | "works";
  contentId: string;
  state: ContentRecoveryState;
  planHash: string;
  repositoryHead: string;
  backupProof: PreDeleteBackupProof;
  preimages: DeletePreimage[];
  recoveryPaths: string[];
  publishPaths: string[];
  preparedAt: string;
  completedAt?: string;
  resolution?: { at: string; reason: string };
};

export function validateContentRecoveryRecord(record: ContentRecoveryRecord) {
  const ids =
    /^[0-9a-f-]{36}$/i.test(record.operationId) &&
    /^[a-f0-9]{64}$/.test(record.planHash);
  const paths = [
    ...record.preimages.map((item) => item.path),
    ...record.recoveryPaths,
    ...record.publishPaths,
  ];
  if (
    record.schemaVersion !== CONTENT_RECOVERY_SCHEMA_VERSION ||
    record.operation !== "content-delete" ||
    !ids ||
    !paths.every(safeRelative) ||
    new Set(record.publishPaths).size !== record.publishPaths.length ||
    record.publishPaths.some(
      (file) => file.startsWith(".kiki-editor/") || file.startsWith("public/"),
    ) ||
    (record.state === "completed" && !record.completedAt)
  )
    throw new Error("Invalid content recovery evidence");
  return record;
}

export async function persistContentRecoveryRecord(
  repositoryRoot: string,
  record: ContentRecoveryRecord,
) {
  validateContentRecoveryRecord(record);
  const operationRoot = path.join(
    repositoryRoot,
    CONTENT_OPERATION_ROOT,
    record.operationId,
  );
  await fs.mkdir(operationRoot, { recursive: true, mode: 0o700 });
  const target = path.join(operationRoot, "operation.json");
  const existing = (await fs
    .readFile(target, "utf8")
    .then(JSON.parse)
    .catch(() => null)) as ContentRecoveryRecord | null;
  const allowed: Record<ContentRecoveryState, ContentRecoveryState[]> = {
    prepared: [
      "prepared",
      "completed",
      "rolled-back",
      "manual-recovery-required",
    ],
    completed: ["completed"],
    "rolled-back": ["rolled-back"],
    "manual-recovery-required": ["manual-recovery-required"],
  };
  if (
    existing &&
    (existing.operationId !== record.operationId ||
      !allowed[existing.state]?.includes(record.state))
  )
    throw new Error("Content recovery evidence transition is not allowed");
  const staged = `${target}.tmp`;
  await fs.writeFile(staged, `${JSON.stringify(record, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await fs.rename(staged, target);
  const handle = await fs.open(operationRoot, "r");
  await handle.sync();
  await handle.close();
  return target;
}

export function plannedDeletePublishPaths(record: ContentRecoveryRecord) {
  validateContentRecoveryRecord(record);
  if (record.state !== "completed")
    throw new Error("Delete Publish requires completed evidence");
  if (
    record.publishPaths.length !== record.preimages.length ||
    record.publishPaths.some(
      (file) => !record.preimages.some((item) => item.path === file),
    )
  )
    throw new Error(
      "Delete Publish paths must exactly equal the proven canonical preimages",
    );
  return [...record.publishPaths].sort();
}
