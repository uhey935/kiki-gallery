import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireContentLifecycleLock,
  acquireWorksDeleteLocks,
  assertContentLifecycleLock,
  releaseContentLifecycleLock,
} from "./content-lifecycle-lock.ts";

test("all content writers share a non-stealable repository lock", async () => {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), "kiki-content-lock-"),
  );
  const owner = await acquireContentLifecycleLock({
    repositoryRoot: repository,
    writer: "save",
    now: "2026-08-09T00:00:00.000Z",
  });
  await assert.rejects(
    () =>
      acquireContentLifecycleLock({
        repositoryRoot: repository,
        writer: "publish",
        now: "2026-08-09T00:00:01.000Z",
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "lock-conflict",
  );
  assert.equal(
    (await assertContentLifecycleLock(repository, owner.identity)).writer,
    "save",
  );
  await releaseContentLifecycleLock(repository, owner.identity);
});

test("Works Delete acceptance acquires content then asset and releases in reverse", async () => {
  const repository = await fs.mkdtemp(
    path.join(os.tmpdir(), "kiki-dual-lock-"),
  );
  const locks = await acquireWorksDeleteLocks({
    repositoryRoot: repository,
    operationId: "00000000-0000-4000-8000-000000000000",
    now: "2026-08-09T00:00:00.000Z",
  });
  assert.ok(
    await fs.lstat(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
    ),
  );
  assert.ok(
    await fs.lstat(
      path.join(repository, ".kiki-editor/asset-lifecycle/repository.lock"),
    ),
  );
  await locks.release();
  await assert.rejects(() =>
    fs.lstat(
      path.join(repository, ".kiki-editor/content-lifecycle/repository.lock"),
    ),
  );
});
