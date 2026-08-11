import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { convertLegacyArtistMarkdown } from "./migration-converter.ts";
import {
  ARTIST_MIGRATION_INVENTORY,
  artistMigrationSha256,
  createLegacyArtistMigrationManifest,
  restoreLegacyArtistBytes,
  serializeArtistMigrationManifest,
  type LegacyArtistMigrationManifest,
} from "./migration-manifest.ts";

const frozenManifestPath = path.resolve(
  "docs/architecture/artists-migration-manifest-2026-08-11.json",
);

async function readFrozen(): Promise<LegacyArtistMigrationManifest> {
  return JSON.parse(await fs.readFile(frozenManifestPath, "utf8"));
}

async function materializeSources(
  root: string,
  manifest: LegacyArtistMigrationManifest,
) {
  await Promise.all(
    manifest.entries.map((entry) =>
      fs.writeFile(
        path.join(root, `${entry.contentId}.md`),
        Buffer.from(entry.source.originalBase64, "base64"),
      ),
    ),
  );
}

test("frozen manifest exactly inventories and regenerates all five Artists", async (t) => {
  const frozenRaw = await fs.readFile(frozenManifestPath, "utf8");
  const frozen = JSON.parse(frozenRaw) as LegacyArtistMigrationManifest;
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "artists-frozen-sources-"),
  );
  t.after(() => fs.rm(sourceRoot, { recursive: true, force: true }));
  await materializeSources(sourceRoot, frozen);
  const before = new Map(
    frozen.entries.map((entry) => [
      entry.contentId,
      Buffer.from(entry.source.originalBase64, "base64"),
    ]),
  );
  const regenerated = await createLegacyArtistMigrationManifest(sourceRoot);
  const repeated = await createLegacyArtistMigrationManifest(sourceRoot);

  assert.equal(frozen.count, 5);
  assert.deepEqual(frozen.expectedInventory, ARTIST_MIGRATION_INVENTORY);
  assert.deepEqual(
    frozen.entries.map((entry) => entry.contentId),
    ARTIST_MIGRATION_INVENTORY,
  );
  assert.equal(
    serializeArtistMigrationManifest(regenerated),
    serializeArtistMigrationManifest(repeated),
  );
  assert.equal(frozen.mode, "dry-run");

  for (const entry of regenerated.entries) {
    const sourceBytes = before.get(entry.contentId)!;
    assert.equal(entry.source.bodyByteLength, 0);
    assert.equal(entry.source.byteLength, sourceBytes.byteLength);
    assert.equal(entry.source.sha256, artistMigrationSha256(sourceBytes));
    assert.equal(entry.source.originalBase64, sourceBytes.toString("base64"));
    const converted = convertLegacyArtistMarkdown(
      sourceBytes,
      entry.source.path,
    );
    assert.equal(converted.shared, entry.generated.shared.content);
    assert.equal(converted.ja, entry.generated.ja.content);
    assert.equal(converted.en, entry.generated.en.content);
    for (const generated of Object.values(entry.generated)) {
      assert.equal(generated.byteLength, Buffer.byteLength(generated.content));
      assert.equal(generated.sha256, artistMigrationSha256(generated.content));
    }
    assert.equal(entry.referenceIdentity.externalId, entry.contentId);
    assert.equal(entry.referenceIdentity.referenceRewriteRequired, false);
    assert.equal(entry.referenceIdentity.localizedEntryIdsAreExternal, false);
    assert.match(entry.generated.en.content, /__TODO_EN_SHORT_BIO__/);
    assert.match(entry.generated.en.content, /__TODO_EN_HERO_ALT__/);
    assert.doesNotMatch(entry.generated.en.content, /[ぁ-んァ-ヶ一-龠]/);
    assert.deepEqual(
      await fs.readFile(path.join(sourceRoot, `${entry.contentId}.md`)),
      sourceBytes,
    );
  }
});

test("mapping evidence materializes JA names and never guesses EN translations", async () => {
  const manifest = await readFrozen();
  const expectedNames = new Map([
    ["alana-wilson", ["Alana Wilson", "アラーナ・ウィルソン"]],
    ["keisuke-matsuda", ["Keisuke Matsuda", "松田啓佑"]],
    ["reiko-kinoshita", ["Reiko Kinoshita", "木下令子"]],
    ["takeyoshi-mitsui", ["Takeyoshi Mitsui", "光井威善"]],
    ["yuka-mori", ["Yuka Mori", "森夕香"]],
  ]);
  for (const entry of manifest.entries) {
    const shared = parse(entry.generated.shared.content);
    const ja = parse(entry.generated.ja.content.replace(/^---\n|---\n$/g, ""));
    const en = parse(entry.generated.en.content.replace(/^---\n|---\n$/g, ""));
    assert.deepEqual(
      [shared.sort_name, ja.name],
      expectedNames.get(entry.contentId),
    );
    assert.equal(en.name, shared.sort_name);
    assert.ok(
      entry.fieldMapping.some(
        (mapping) =>
          mapping.destination === "ja.md" &&
          mapping.targetField === "name" &&
          mapping.strategy === "display-name-or-name-materialized",
      ),
    );
    assert.ok(
      entry.fieldMapping.some(
        (mapping) =>
          mapping.destination === "en.md" &&
          mapping.strategy === "explicit-placeholder-no-translation",
      ),
    );
  }
});

test("rollback evidence restores every flat Markdown byte exactly", async () => {
  const manifest = await readFrozen();
  const restored = restoreLegacyArtistBytes(manifest);
  assert.equal(restored.size, 5);
  for (const entry of manifest.entries) {
    const bytes = restored.get(entry.source.path)!;
    assert.equal(bytes.byteLength, entry.source.byteLength);
    assert.equal(artistMigrationSha256(bytes), entry.source.sha256);
    assert.deepEqual(bytes, Buffer.from(entry.source.originalBase64, "base64"));
  }
});

test("converter fails closed for malformed, invalid, unknown, and non-empty sources", () => {
  assert.throws(
    () => convertLegacyArtistMarkdown(Buffer.from("name: Artist\n"), "bad.md"),
    /malformed Markdown frontmatter/,
  );
  assert.throws(
    () =>
      convertLegacyArtistMarkdown(
        Buffer.from("---\nname: [invalid\n---\n"),
        "bad.md",
      ),
    /bad.md:/,
  );
  assert.throws(
    () =>
      convertLegacyArtistMarkdown(
        Buffer.from(
          "---\nname: Artist\nhero: { image: /artist.png }\nhero_alt: alt\nshort_bio: bio\nmedium: [Painting]\nunknown: value\n---\n",
        ),
        "unknown.md",
      ),
    /unknown legacy Artist fields: unknown/,
  );
  assert.throws(
    () =>
      convertLegacyArtistMarkdown(
        Buffer.from(
          "---\nname: Artist\nhero: { image: /artist.png }\nhero_alt: alt\nshort_bio: bio\nmedium: []\n---\n",
        ),
        "invalid.md",
      ),
    /invalid legacy Artist/,
  );
  assert.throws(
    () =>
      convertLegacyArtistMarkdown(
        Buffer.from(
          "---\nname: Artist\nhero: { image: /artist.png }\nhero_alt: alt\nshort_bio: bio\nmedium: [Painting]\n---\nbody\n",
        ),
        "body.md",
      ),
    /body must be empty/,
  );
});

test("manifest generation fails closed for inventory drift and target collision", async (t) => {
  const frozen = await readFrozen();
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "artists-migration-"),
  );
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await materializeSources(temporaryRoot, frozen);

  await fs.rename(
    path.join(temporaryRoot, "alana-wilson.md"),
    path.join(temporaryRoot, "Alana-Wilson.md"),
  );
  await assert.rejects(
    createLegacyArtistMigrationManifest(temporaryRoot),
    /Invalid Artist source filenames/,
  );
  await fs.rename(
    path.join(temporaryRoot, "Alana-Wilson.md"),
    path.join(temporaryRoot, "alana-wilson.md"),
  );
  await fs.writeFile(path.join(temporaryRoot, "extra-artist.md"), "---\n---\n");
  await assert.rejects(
    createLegacyArtistMigrationManifest(temporaryRoot),
    /Artist inventory mismatch/,
  );
  await fs.unlink(path.join(temporaryRoot, "extra-artist.md"));
  await fs.mkdir(path.join(temporaryRoot, "alana-wilson"));
  await assert.rejects(
    createLegacyArtistMigrationManifest(temporaryRoot),
    /Artist target collision: alana-wilson/,
  );
});

test("tampered rollback evidence is rejected", async () => {
  const manifest = await readFrozen();
  manifest.entries[0].rollback.originalBase64 =
    Buffer.from("tampered").toString("base64");
  assert.throws(
    () => restoreLegacyArtistBytes(manifest),
    /invalid Artist rollback evidence/,
  );
});
