import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  acquireWorksAssetRepositoryLock,
  quarantineWorksAsset,
  inspectWorksAssetCleanupRecovery,
  releaseWorksAssetRepositoryLock,
  restoreWorksAsset,
  WorksAssetReversibleCleanupError,
} from "./works-asset-reversible-cleanup-store.ts";

const bytes = Buffer.from("asset-bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "works-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "public/images/works"), { recursive: true });
  await writeFile(path.join(root, "public/images/works/orphan.png"), bytes);
  return root;
}
const quarantineInput = (
  root: string,
  lock: Awaited<ReturnType<typeof acquireWorksAssetRepositoryLock>>,
) => ({
  repositoryRoot: root,
  lock,
  publicUrl: "/images/works/orphan.png",
  filename: "orphan.png",
  assetSha256: hash,
  byteSize: bytes.length,
  format: "png" as const,
  quarantinedAt: "2026-08-07T00:00:00Z",
  sourceSnapshotSha256: "b".repeat(64),
  sourceLedgerSha256: "c".repeat(64),
});

test("lock conflicts and stale locks fail closed", async (t) => {
  const root = await fixture(t);
  const lock = await acquireWorksAssetRepositoryLock(
    root,
    "2026-08-07T00:00:00Z",
    1,
  );
  await assert.rejects(
    acquireWorksAssetRepositoryLock(root, "2026-08-07T00:00:00Z"),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "lock-conflict",
  );
  await assert.rejects(
    acquireWorksAssetRepositoryLock(root, "2026-08-07T00:00:01Z"),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError && e.code === "stale-lock",
  );
  await releaseWorksAssetRepositoryLock(root, lock.identity);
});

test("quarantine and restore are reversible and no-overwrite", async (t) => {
  const root = await fixture(t);
  const lock = await acquireWorksAssetRepositoryLock(
    root,
    "2026-08-07T00:00:00Z",
  );
  const record = await quarantineWorksAsset(quarantineInput(root, lock));
  assert.deepEqual(
    await readFile(path.join(root, record.quarantineRelativePath)),
    bytes,
  );
  await writeFile(path.join(root, record.originalRelativePath), "new identity");
  await assert.rejects(
    restoreWorksAsset({
      repositoryRoot: root,
      lock,
      recordId: record.recordId,
      restoredAt: "2026-08-08T00:00:00Z",
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "asset-conflict",
  );
  await rm(path.join(root, record.originalRelativePath));
  const restored = await restoreWorksAsset({
    repositoryRoot: root,
    lock,
    recordId: record.recordId,
    restoredAt: "2026-08-08T00:00:00Z",
  });
  assert.equal(restored.state, "restored");
  assert.deepEqual(
    await readFile(path.join(root, record.originalRelativePath)),
    bytes,
  );
  await releaseWorksAssetRepositoryLock(root, lock.identity);
});

test("quarantine failure rolls the canonical asset back", async (t) => {
  const root = await fixture(t);
  const lock = await acquireWorksAssetRepositoryLock(
    root,
    "2026-08-07T00:00:00Z",
  );
  await assert.rejects(
    quarantineWorksAsset({
      ...quarantineInput(root, lock),
      failAfterMove: true,
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "transaction-failed",
  );
  assert.deepEqual(
    await readFile(path.join(root, "public/images/works/orphan.png")),
    bytes,
  );
  await mkdir(
    path.join(root, ".kiki-editor/asset-lifecycle/quarantine/recovery"),
    { recursive: true },
  );
  await writeFile(
    path.join(
      root,
      ".kiki-editor/asset-lifecycle/quarantine/recovery/interrupted.tmp",
    ),
    "preserved crash evidence",
  );
  await mkdir(
    path.join(
      root,
      ".kiki-editor/asset-lifecycle/quarantine/assets/interrupted-move",
    ),
    { recursive: true },
  );
  assert.deepEqual(await inspectWorksAssetCleanupRecovery(root), [
    "recovery/interrupted.tmp",
    "unrecorded-asset:interrupted-move",
  ]);
  await releaseWorksAssetRepositoryLock(root, lock.identity);
});

test("hash mismatch, corrupt record, and symlink paths fail closed", async (t) => {
  const root = await fixture(t);
  const lock = await acquireWorksAssetRepositoryLock(
    root,
    "2026-08-07T00:00:00Z",
  );
  await assert.rejects(
    quarantineWorksAsset({
      ...quarantineInput(root, lock),
      assetSha256: "0".repeat(64),
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "hash-mismatch",
  );
  const record = await quarantineWorksAsset(quarantineInput(root, lock));
  await writeFile(path.join(root, record.quarantineRelativePath), "tampered");
  await assert.rejects(
    restoreWorksAsset({
      repositoryRoot: root,
      lock,
      recordId: record.recordId,
      restoredAt: "2026-08-08T00:00:00Z",
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "hash-mismatch",
  );
  await writeFile(path.join(root, record.quarantineRelativePath), bytes);
  await writeFile(
    path.join(
      root,
      `.kiki-editor/asset-lifecycle/quarantine/records/${record.recordId}.json`,
    ),
    "corrupt",
  );
  await assert.rejects(
    restoreWorksAsset({
      repositoryRoot: root,
      lock,
      recordId: record.recordId,
      restoredAt: "2026-08-08T00:00:00Z",
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "record-corrupt",
  );
  await assert.rejects(
    restoreWorksAsset({
      repositoryRoot: root,
      lock,
      recordId: "0".repeat(64),
      restoredAt: "2026-08-08T00:00:00Z",
    }),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError &&
      e.code === "record-corrupt",
  );
  await releaseWorksAssetRepositoryLock(root, lock.identity);
  const unsafe = await mkdtemp(
    path.join(os.tmpdir(), "works-cleanup-outside-"),
  );
  t.after(() => rm(unsafe, { recursive: true, force: true }));
  await rm(path.join(root, ".kiki-editor"), { recursive: true, force: true });
  await symlink(unsafe, path.join(root, ".kiki-editor"));
  await assert.rejects(
    acquireWorksAssetRepositoryLock(root, "2026-08-07T00:00:00Z"),
    (e: unknown) =>
      e instanceof WorksAssetReversibleCleanupError && e.code === "unsafe-path",
  );
});
