import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  createWorksAssetCandidateLedger,
  observeWorksAssetCleanupReport,
} from "./works-asset-candidate-ledger.ts";
import { saveWorksAssetCandidateLedger } from "./works-asset-candidate-ledger-store.ts";
import type { WorksAssetCleanupReport } from "./works-asset-cleanup.ts";
import {
  explicitlyConfirmWorksAssetDeletion,
  type WorksAssetQuarantineObservation,
} from "./works-asset-physical-delete.ts";
import {
  physicallyDeleteWorksAsset,
  prepareWorksAssetDeletionReview,
  WorksAssetPhysicalDeleteError,
} from "./works-asset-physical-delete-store.ts";
import {
  createWorksAssetQuarantineRecord,
  hashWorksAssetQuarantineRecord,
  serializeWorksAssetQuarantineRecord,
} from "./works-asset-reversible-cleanup.ts";
import {
  acquireWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
} from "./works-asset-reversible-cleanup-store.ts";

// Valid 1x1 RGBA PNG.
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAAA1V5QAAAABJRU5ErkJggg==",
  "base64",
);
const assetHash = createHash("sha256").update(bytes).digest("hex");
const policy = { minimumAgeMs: 86_400_000, minimumObservations: 2 };

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "works-delete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "public/images/works"), { recursive: true });
  await mkdir(path.join(root, "src/content/works"), { recursive: true });
  const record = createWorksAssetQuarantineRecord({
    publicUrl: "/images/works/orphan.png",
    filename: "orphan.png",
    assetSha256: assetHash,
    byteSize: bytes.length,
    format: "png",
    quarantinedAt: "2026-08-01T00:00:00Z",
    sourceSnapshotSha256: "b".repeat(64),
    sourceLedgerSha256: "c".repeat(64),
    lockIdentity: "quarantine-lock",
  });
  const recordHash = hashWorksAssetQuarantineRecord(record);
  await mkdir(path.join(root, path.dirname(record.quarantineRelativePath)), {
    recursive: true,
  });
  await mkdir(
    path.join(root, ".kiki-editor/asset-lifecycle/quarantine/records"),
    { recursive: true },
  );
  await writeFile(path.join(root, record.quarantineRelativePath), bytes);
  await writeFile(
    path.join(
      root,
      `.kiki-editor/asset-lifecycle/quarantine/records/${record.recordId}.json`,
    ),
    serializeWorksAssetQuarantineRecord(record),
  );
  const candidate = {
    publicUrl: record.publicUrl,
    filename: "orphan.png",
    sha256: record.assetSha256,
    byteSize: record.byteSize,
    format: record.format,
    referenceCount: 0 as const,
    warnings: [],
    disposition: "deferred-no-delete" as const,
  };
  const report = (snapshot: string): WorksAssetCleanupReport => ({
    schemaVersion: 1,
    mode: "read-only",
    referenceGraphComplete: true,
    eligibleForDeletion: false,
    snapshotSha256: snapshot,
    candidates: [candidate],
    audit: [],
  });
  let ledger = createWorksAssetCandidateLedger({
    minimumCompleteObservations: 2,
    minimumAgeMs: 1,
  });
  ledger = observeWorksAssetCleanupReport(
    ledger,
    report("1".repeat(64)),
    "2026-07-01T00:00:00Z",
  );
  ledger = observeWorksAssetCleanupReport(
    ledger,
    report("2".repeat(64)),
    "2026-07-02T00:00:00Z",
  );
  const ledgerHash = await saveWorksAssetCandidateLedger(ledger, null, root);
  const observations: WorksAssetQuarantineObservation[] = [
    {
      observedAt: "2026-08-02T00:00:00Z",
      quarantineRecordSha256: recordHash,
      assetSha256: record.assetSha256,
    },
    {
      observedAt: "2026-08-03T00:00:00Z",
      quarantineRecordSha256: recordHash,
      assetSha256: record.assetSha256,
    },
  ];
  return { root, record, recordHash, ledgerHash, observations };
}

async function reviewed(t: TestContext) {
  const value = await fixture(t);
  const review = await prepareWorksAssetDeletionReview({
    repositoryRoot: value.root,
    recordId: value.record.recordId,
    expectedLedgerSha256: value.ledgerHash,
    expectedRecordSha256: value.recordHash,
    observations: value.observations,
    retentionPolicy: policy,
    now: "2026-08-03T00:00:00Z",
  });
  const confirmation = explicitlyConfirmWorksAssetDeletion(
    review,
    "2026-08-03T00:01:00Z",
  );
  return { ...value, review, confirmation };
}

test("physical delete requires explicit confirmation", async (t) => {
  const value = await reviewed(t);
  await assert.rejects(
    physicallyDeleteWorksAsset({
      repositoryRoot: value.root,
      recordId: value.record.recordId,
      review: value.review,
      confirmation: null,
      observations: value.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:02:00Z",
    }),
    (error: unknown) =>
      error instanceof WorksAssetPhysicalDeleteError &&
      error.code === "confirmation-required",
  );
  assert.equal(
    (
      await stat(path.join(value.root, value.record.quarantineRelativePath))
    ).isFile(),
    true,
  );
});

test("verified quarantine-only delete is durable and double delete is idempotent", async (t) => {
  const value = await reviewed(t);
  const input = {
    repositoryRoot: value.root,
    recordId: value.record.recordId,
    review: value.review,
    confirmation: value.confirmation,
    observations: value.observations,
    retentionPolicy: policy,
    now: "2026-08-03T00:02:00Z",
  };
  const manifest = await physicallyDeleteWorksAsset(input);
  assert.equal(manifest.state, "physically-deleted");
  await assert.rejects(
    stat(path.join(value.root, value.record.quarantineRelativePath)),
  );
  assert.equal(
    (await physicallyDeleteWorksAsset(input)).manifestIdentity,
    manifest.manifestIdentity,
  );
  assert.equal(
    (
      await readFile(
        path.join(
          value.root,
          `.kiki-editor/asset-lifecycle/quarantine/records/${value.record.recordId}.json`,
        ),
        "utf8",
      )
    ).includes('"state": "quarantined"'),
    true,
  );
});

test("stale confirmation, lock conflict, and hash mismatch fail before delete", async (t) => {
  const stale = await reviewed(t);
  await writeFile(
    path.join(stale.root, "public/images/works/drift.png"),
    bytes,
  );
  await assert.rejects(
    physicallyDeleteWorksAsset({
      repositoryRoot: stale.root,
      recordId: stale.record.recordId,
      review: stale.review,
      confirmation: stale.confirmation,
      observations: stale.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:02:00Z",
    }),
    (error: unknown) => error instanceof WorksAssetPhysicalDeleteError,
  );

  const locked = await fixture(t);
  const lock = await acquireWorksAssetRepositoryLock(
    locked.root,
    "2026-08-03T00:00:00Z",
  );
  await assert.rejects(
    prepareWorksAssetDeletionReview({
      repositoryRoot: locked.root,
      recordId: locked.record.recordId,
      expectedLedgerSha256: locked.ledgerHash,
      expectedRecordSha256: locked.recordHash,
      observations: locked.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:01:00Z",
    }),
  );
  await releaseWorksAssetRepositoryLock(locked.root, lock.identity);

  const tampered = await reviewed(t);
  await writeFile(
    path.join(tampered.root, tampered.record.quarantineRelativePath),
    Buffer.from("not-the-reviewed-image"),
  );
  await assert.rejects(
    physicallyDeleteWorksAsset({
      repositoryRoot: tampered.root,
      recordId: tampered.record.recordId,
      review: tampered.review,
      confirmation: tampered.confirmation,
      observations: tampered.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:02:00Z",
    }),
    (error: unknown) =>
      error instanceof WorksAssetPhysicalDeleteError &&
      error.code === "hash-mismatch",
  );
});

test("symlink target fails closed and post-delete failure preserves recovery evidence", async (t) => {
  const unsafe = await reviewed(t);
  const outside = path.join(unsafe.root, "outside.png");
  await writeFile(outside, bytes);
  await rm(path.join(unsafe.root, unsafe.record.quarantineRelativePath));
  await symlink(
    outside,
    path.join(unsafe.root, unsafe.record.quarantineRelativePath),
  );
  await assert.rejects(
    physicallyDeleteWorksAsset({
      repositoryRoot: unsafe.root,
      recordId: unsafe.record.recordId,
      review: unsafe.review,
      confirmation: unsafe.confirmation,
      observations: unsafe.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:02:00Z",
    }),
    (error: unknown) =>
      error instanceof WorksAssetPhysicalDeleteError &&
      error.code === "unsafe-path",
  );

  const partial = await reviewed(t);
  await assert.rejects(
    physicallyDeleteWorksAsset({
      repositoryRoot: partial.root,
      recordId: partial.record.recordId,
      review: partial.review,
      confirmation: partial.confirmation,
      observations: partial.observations,
      retentionPolicy: policy,
      now: "2026-08-03T00:02:00Z",
      failAfterDelete: true,
    }),
    (error: unknown) =>
      error instanceof WorksAssetPhysicalDeleteError &&
      error.code === "manual-recovery-required",
  );
  assert.equal(
    (
      await readdir(
        path.join(
          partial.root,
          ".kiki-editor/asset-lifecycle/deletion-manifests",
        ),
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await stat(
        path.join(partial.root, ".kiki-editor/asset-lifecycle/repository.lock"),
      )
    ).isDirectory(),
    true,
  );
});
