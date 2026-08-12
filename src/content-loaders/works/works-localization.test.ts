import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorksPrototypeFacade } from "./facade.ts";
import { reorderImageSlots, replaceImageSource } from "./image-slots.ts";
import {
  convertLegacyWorkMarkdown,
  WORK_PLACEHOLDERS,
} from "./migration-converter.ts";
import { executeWorkMigration } from "./migration-executor.ts";
import {
  createWorkMigrationManifest,
  restoreLegacyWorkBytes,
  serializeWorkMigrationManifest,
  worksSha256,
} from "./migration-manifest.ts";
import {
  loadWorkRepository,
  loadWorkUnit,
  localizedWorkEntryId,
} from "./repository.ts";
import { localizedWorkRoutes } from "./route-registry.ts";
import {
  validateImageAlignment,
  workLocalizedSchema,
  workSharedSchema,
} from "./schema.ts";

const root = path.resolve("src/content/works");
test("schemas enforce ownership, count, alt, src, year and inquiry", () => {
  const shared = workSharedSchema.parse({
    artist: "artist",
    images: [{ src: "/a.png" }],
    year: 2025,
    inquiry: { type: "none" },
  });
  const localized = workLocalizedSchema.parse({
    title: "Title",
    images: [{ alt: "Alt" }],
    size: "H1 × W1mm",
  });
  validateImageAlignment(shared, localized);
  assert.throws(() =>
    workSharedSchema.parse({
      ...shared,
      images: [{ src: "/a" }, { src: "/a" }],
    }),
  );
  assert.throws(() =>
    workLocalizedSchema.parse({ title: "x", images: [{ alt: " " }] }),
  );
  assert.throws(() =>
    workLocalizedSchema.parse({
      title: "x",
      images: [{ alt: "a", src: "/a" }],
    }),
  );
  assert.throws(() =>
    validateImageAlignment(shared, {
      ...localized,
      images: [{ alt: "a" }, { alt: "b" }],
    }),
  );
});
test("image slots reorder atomically and replacement preserves alts", () => {
  const slots = [
    { src: "/a", jaAlt: "ja-a", enAlt: "en-a" },
    { src: "/b", jaAlt: "ja-b", enAlt: "en-b" },
  ];
  assert.deepEqual(reorderImageSlots(slots, [1, 0]), [slots[1], slots[0]]);
  assert.deepEqual(replaceImageSource(slots, 0, "/new")[0], {
    src: "/new",
    jaAlt: "ja-a",
    enAlt: "en-a",
  });
  assert.throws(() => reorderImageSlots(slots, [0]));
});
test("converter preserves canonical seven and applies exact placeholders", async () => {
  for (const name of await fs.readdir(root)) {
    const bytes = await fs.readFile(path.join(root, name));
    const converted = convertLegacyWorkMarkdown(bytes, name);
    assert.match(converted.en, new RegExp(WORK_PLACEHOLDERS.title));
    assert.doesNotMatch(converted.en, /seo_title|description/);
    if (name === "reiko-kinoshita-01.md") {
      assert.equal(converted.mapping.imageSlots.length, 4);
      assert.equal(converted.mapping.size, "H300 × W200mm");
    }
    if (name === "reiko-kinoshita-02.md")
      assert.equal(converted.body.empty, true);
    if (name === "yuka-mori-01.md")
      assert.equal(
        converted.mapping.imageSlots[0].jaAlt,
        "Yuka Mori, Mesh — yellow, purple, and white pansies",
      );
  }
});
test("manifest freezes bytes, targets, rollback and asset evidence deterministically", async () => {
  const a = await createWorkMigrationManifest(root),
    b = await createWorkMigrationManifest(root);
  assert.equal(a.count, 7);
  assert.equal(
    serializeWorkMigrationManifest(a),
    serializeWorkMigrationManifest(b),
  );
  assert.equal(restoreLegacyWorkBytes(a).size, 7);
  assert.ok(
    a.assetInvariance.before.every(
      (asset) =>
        asset.byteLength > 0 &&
        asset.sha256.length === 64 &&
        asset.references.length > 0,
    ),
  );
  assert.equal(worksSha256(serializeWorkMigrationManifest(a)).length, 64);
});
test("executor dry-run accepts only frozen evidence and performs no migration", async () => {
  const manifest = await createWorkMigrationManifest(root);
  const before = (await fs.readdir(root)).sort();
  const result = await executeWorkMigration(manifest, { dryRun: true });
  assert.equal(result.mode, "dry-run");
  assert.deepEqual((await fs.readdir(root)).sort(), before);
  const changed = structuredClone(manifest);
  changed.entries[0].source.sha256 = "0".repeat(64);
  await assert.rejects(
    executeWorkMigration(changed, { dryRun: true }),
    /frozen manifest/,
  );
});
test("repository exact unit, IDs, independent capability, artist boundary and routes", async () => {
  const manifest = await createWorkMigrationManifest(root);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "works-unit-"));
  try {
    const e = manifest.entries[0];
    const dir = path.join(tmp, e.contentId);
    await fs.mkdir(dir);
    await Promise.all(
      [
        ["index.yaml", e.generated.shared.content],
        ["ja.md", e.generated.ja.content],
        ["en.md", e.generated.en.content],
      ].map(([n, c]) => fs.writeFile(path.join(dir, n), c)),
    );
    const unit = await loadWorkUnit(dir);
    assert.equal(localizedWorkEntryId(e.contentId, "ja"), `ja::${e.contentId}`);
    const facade = createWorksPrototypeFacade([unit], (id, locale) =>
      locale === "ja"
        ? { contentId: id, name: "Artist", route: `/artists/${id}/` }
        : undefined,
    );
    assert.equal(facade.forLocale("ja").length, 1);
    assert.equal(facade.forLocale("en").length, 0);
    assert.deepEqual(localizedWorkRoutes(facade), [`/works/${e.contentId}/`]);
    await fs.writeFile(path.join(dir, "extra"), "");
    assert.ok(
      (await loadWorkUnit(dir)).issues.some(
        (i) => i.ruleId === "works.unit.inventory",
      ),
    );
    await fs.writeFile(path.join(tmp, "legacy.md"), "");
    await assert.rejects(loadWorkRepository(tmp), /Mixed flat/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
