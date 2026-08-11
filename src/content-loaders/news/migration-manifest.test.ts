import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  createLegacyNewsMigrationManifest,
  restoreLegacyNewsBytes,
} from "./migration-manifest.ts";
import { convertLegacyNewsMarkdown } from "./migration-converter.ts";

const frozenManifestPath = path.resolve(
  "docs/architecture/news-migration-manifest-2026-08-10.json",
);

test("dry-run records all legacy News sources and generated files without mutation", async () => {
  const frozen = JSON.parse(await fs.readFile(frozenManifestPath, "utf8"));
  const sourceNames: string[] = frozen.entries.map(
    (entry: { contentId: string }) => `${entry.contentId}.md`,
  );
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "news-migration-manifest-"),
  );
  await Promise.all(
    frozen.entries.map(
      (entry: { contentId: string; rollback: { originalBase64: string } }) =>
        fs.writeFile(
          path.join(temporaryRoot, `${entry.contentId}.md`),
          Buffer.from(entry.rollback.originalBase64, "base64"),
        ),
    ),
  );
  const before = new Map(
    await Promise.all(
      sourceNames.map(
        async (name) =>
          [name, await fs.readFile(path.join(temporaryRoot, name))] as const,
      ),
    ),
  );

  const manifest = await createLegacyNewsMigrationManifest(temporaryRoot);

  assert.equal(manifest.migrationVersion, 1);
  assert.equal(manifest.mode, "dry-run");
  assert.equal(manifest.count, 7);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.contentId),
    sourceNames.map((name) => name.slice(0, -3)),
  );
  for (const entry of manifest.entries) {
    const expected = frozen.entries.find(
      (candidate: { contentId: string }) =>
        candidate.contentId === entry.contentId,
    );
    assert.ok(expected);
    assert.equal(entry.source.sha256, expected.source.sha256);
    assert.equal(entry.source.byteLength, expected.source.byteLength);
    assert.equal(
      entry.generated.shared.sha256,
      expected.generated.shared.sha256,
    );
    assert.equal(entry.generated.ja.sha256, expected.generated.ja.sha256);
    assert.equal(entry.generated.en.sha256, expected.generated.en.sha256);
    assert.equal(
      entry.rollback.originalBase64,
      expected.rollback.originalBase64,
    );
    assert.match(entry.generated.en.content, /__TODO_EN_TITLE__/);
    assert.match(entry.generated.en.content, /__TODO_EN_SUMMARY__/);
    assert.equal(entry.generated.shared.sha256.length, 64);
    assert.equal(entry.generated.ja.sha256.length, 64);
    assert.equal(entry.generated.en.sha256.length, 64);
    assert.deepEqual(
      await fs.readFile(entry.source.path),
      before.get(path.basename(entry.source.path)),
    );
    await assert.rejects(fs.access(entry.targetDirectory));
  }

  const rollback = restoreLegacyNewsBytes(manifest);
  for (const entry of manifest.entries) {
    assert.deepEqual(
      rollback.get(entry.source.path),
      await fs.readFile(entry.source.path),
    );
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test("converter maps shared and JA fields and preserves the legacy body", () => {
  const legacy = Buffer.from(
    '---\ntitle: 日本語タイトル\nsummary: 日本語要約\ndate: "2026-08-10"\nnews_type: general\nlink: /news/example\nshow_on_home: true\n---\n本文\n',
  );
  const converted = convertLegacyNewsMarkdown(legacy, "example.md");
  assert.deepEqual(parse(converted.shared), {
    date: "2026-08-10",
    news_type: "general",
    link: "/news/example",
    show_on_home: true,
  });
  assert.match(converted.ja, /title: 日本語タイトル/);
  assert.match(converted.ja, /summary: 日本語要約/);
  assert.match(converted.ja, /本文\n$/);
  assert.doesNotMatch(converted.ja, /date:/);
  assert.doesNotMatch(converted.en, /日本語タイトル/);
});

test("converter fails closed for unknown legacy fields", () => {
  const legacy = Buffer.from(
    '---\ntitle: News\ndate: "2026-08-10"\nnews_type: general\nshow_on_home: false\nunknown: value\n---\n',
  );
  assert.throws(
    () => convertLegacyNewsMarkdown(legacy, "unknown.md"),
    /unknown legacy News fields: unknown/,
  );
});
