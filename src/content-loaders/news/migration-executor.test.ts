import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeLegacyNewsMigration } from "./migration-executor.ts";
import { createLegacyNewsMigrationManifest } from "./migration-manifest.ts";

const legacyNews = `---
title: サイト公開のお知らせ
summary: 日本語要約
date: "2026-03-28"
news_type: general
link: /news/site-launch
show_on_home: true
---
`;

async function fixtureRoot(contentIds = ["site-launch"]) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "news-migration-executor-"),
  );
  await Promise.all(
    contentIds.map((contentId) =>
      fs.writeFile(path.join(root, `${contentId}.md`), legacyNews),
    ),
  );
  return root;
}

test("executor installs validated three-file units and retains legacy sources", async (t) => {
  const root = await fixtureRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createLegacyNewsMigrationManifest(root);

  const result = await executeLegacyNewsMigration(manifest);

  assert.deepEqual(result.migratedContentIds, ["site-launch"]);
  assert.equal(
    (await fs.stat(path.join(root, "site-launch.md"))).isFile(),
    true,
  );
  for (const filename of ["index.yaml", "ja.md", "en.md"]) {
    assert.equal(
      (await fs.stat(path.join(root, "site-launch", filename))).isFile(),
      true,
    );
  }
});

test("executor fails closed when a source hash changed", async (t) => {
  const root = await fixtureRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createLegacyNewsMigrationManifest(root);
  await fs.appendFile(path.join(root, "site-launch.md"), "changed\n");

  await assert.rejects(
    executeLegacyNewsMigration(manifest),
    /source hash mismatch/,
  );
  await assert.rejects(fs.access(path.join(root, "site-launch")));
});

test("executor fails closed on a target collision", async (t) => {
  const root = await fixtureRoot();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createLegacyNewsMigrationManifest(root);
  await fs.mkdir(path.join(root, "site-launch"));

  await assert.rejects(
    executeLegacyNewsMigration(manifest),
    /target directory already exists/,
  );
  assert.deepEqual(await fs.readdir(path.join(root, "site-launch")), []);
});

test("executor rolls back every directory installed before a failure", async (t) => {
  const root = await fixtureRoot(["first-news", "second-news"]);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createLegacyNewsMigrationManifest(root);

  await assert.rejects(
    executeLegacyNewsMigration(manifest, {
      afterDirectoryInstalled(contentId) {
        if (contentId === "first-news") throw new Error("injected failure");
      },
    }),
    /injected failure/,
  );
  for (const contentId of ["first-news", "second-news"]) {
    await assert.rejects(fs.access(path.join(root, contentId)));
    assert.equal(
      (await fs.stat(path.join(root, `${contentId}.md`))).isFile(),
      true,
    );
  }
  assert.equal(
    (await fs.readdir(root)).some((name) =>
      name.startsWith(".news-migration-stage-"),
    ),
    false,
  );
});
