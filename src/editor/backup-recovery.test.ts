import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BackupRecoveryError,
  createBackup,
  restoreBackup,
  verifyBackup,
} from "./backup-recovery.ts";

const fixture = async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "kiki-backup-test-"));
  const repositoryRoot = path.join(base, "repository");
  const backupRoot = path.join(base, "backup");
  await fs.mkdir(path.join(repositoryRoot, "src/content/works"), {
    recursive: true,
  });
  await fs.mkdir(path.join(repositoryRoot, "public/images/works"), {
    recursive: true,
  });
  await fs.mkdir(
    path.join(repositoryRoot, ".kiki-editor/asset-lifecycle/repository.lock"),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(repositoryRoot, "src/content/works/a.md"),
    "canonical\n",
  );
  await fs.writeFile(
    path.join(repositoryRoot, "public/images/works/a.jpg"),
    "image",
  );
  await fs.writeFile(
    path.join(repositoryRoot, ".kiki-editor/ledger.json"),
    "ledger\n",
  );
  await fs.writeFile(
    path.join(
      repositoryRoot,
      ".kiki-editor/asset-lifecycle/repository.lock/owner.json",
    ),
    "lock\n",
  );
  return { base, repositoryRoot, backupRoot };
};

test("creates and verifies one integrity-bound backup generation", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  const manifest = await createBackup({
    ...value,
    destination: value.backupRoot,
    createdAt: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(manifest.capturedRepositoryLock, true);
  assert.equal(manifest.files.length, 4);
  assert.deepEqual(
    (await verifyBackup(value.backupRoot)).files,
    manifest.files,
  );
});

test("verification rejects changed payload bytes", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  await createBackup({ ...value, destination: value.backupRoot });
  await fs.writeFile(
    path.join(value.backupRoot, "payload/src/content/works/a.md"),
    "changed\n",
  );
  await assert.rejects(
    () => verifyBackup(value.backupRoot),
    (error: unknown) =>
      error instanceof BackupRecoveryError && error.code === "backup-corrupt",
  );
});

test("default restore replaces Editor state but never restores a captured lock", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  await createBackup({ ...value, destination: value.backupRoot });
  await fs.rm(
    path.join(
      value.repositoryRoot,
      ".kiki-editor/asset-lifecycle/repository.lock",
    ),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(value.repositoryRoot, ".kiki-editor/ledger.json"),
    "new\n",
  );
  await fs.writeFile(
    path.join(value.repositoryRoot, "src/content/works/a.md"),
    "new canonical\n",
  );
  const result = await restoreBackup(value);
  assert.equal(
    await fs.readFile(
      path.join(value.repositoryRoot, ".kiki-editor/ledger.json"),
      "utf8",
    ),
    "ledger\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(value.repositoryRoot, "src/content/works/a.md"),
      "utf8",
    ),
    "new canonical\n",
  );
  assert.equal(
    await fs
      .lstat(
        path.join(
          value.repositoryRoot,
          ".kiki-editor/asset-lifecycle/repository.lock",
        ),
      )
      .catch(() => null),
    null,
  );
  assert.equal(result.skippedCapturedLock, true);
});

test("full disaster restore exactly replaces canonical roots and Editor state", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  await createBackup({ ...value, destination: value.backupRoot });
  await fs.rm(
    path.join(
      value.repositoryRoot,
      ".kiki-editor/asset-lifecycle/repository.lock",
    ),
    { recursive: true },
  );
  await fs.writeFile(
    path.join(value.repositoryRoot, "src/content/extra.md"),
    "extra\n",
  );
  await fs.writeFile(
    path.join(value.repositoryRoot, "src/content/works/a.md"),
    "changed\n",
  );
  await restoreBackup({ ...value, includeCanonical: true });
  assert.equal(
    await fs.readFile(
      path.join(value.repositoryRoot, "src/content/works/a.md"),
      "utf8",
    ),
    "canonical\n",
  );
  assert.equal(
    await fs
      .lstat(path.join(value.repositoryRoot, "src/content/extra.md"))
      .catch(() => null),
    null,
  );
});

test("restore stops when the current repository has a lifecycle lock", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  await createBackup({ ...value, destination: value.backupRoot });
  await assert.rejects(
    () => restoreBackup(value),
    (error: unknown) =>
      error instanceof BackupRecoveryError && error.code === "active-lock",
  );
});

test("backup refuses a destination inside the repository", async (t) => {
  const value = await fixture();
  t.after(() => fs.rm(value.base, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      createBackup({
        repositoryRoot: value.repositoryRoot,
        destination: path.join(value.repositoryRoot, "backup"),
      }),
    (error: unknown) =>
      error instanceof BackupRecoveryError && error.code === "unsafe-path",
  );
});
