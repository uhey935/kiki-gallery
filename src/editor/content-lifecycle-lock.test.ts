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

test("every ordinary Editor writer route participates in the shared server-side gate", async () => {
  const routeRoot = path.resolve("src/editor/routes");
  const names = [
    "artists-save",
    "exhibitions-save",
    "home-save",
    "journal-save",
    "news-save",
    "works-save",
    "artists-publish",
    "exhibitions-publish",
    "home-publish",
    "journal-publish",
    "news-publish",
    "works-publish",
    "artists-preview-create",
    "exhibitions-preview-create",
    "home-preview-create",
    "journal-preview-create",
    "news-preview-create",
    "works-preview-create",
    "works-asset-upload",
    "journal-create",
  ];
  for (const name of names)
    assert.match(
      await fs.readFile(path.join(routeRoot, `${name}.ts`), "utf8"),
      /contentWriterRoute\("(?:save|publish|create)", unlockedPOST\)/,
      `${name} must use the non-stealing lifecycle gate`,
    );
  assert.match(
    await fs.readFile(path.join(routeRoot, "flat-create-route.ts"), "utf8"),
    /contentWriterRoute\("create"/,
  );
});
