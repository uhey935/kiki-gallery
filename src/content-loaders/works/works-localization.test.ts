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
  restoreLegacyWorkBytes,
  serializeWorkMigrationManifest,
  type WorkMigrationManifest,
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

const manifestPath = path.resolve(
  "docs/migrations/works-localization-manifest-2026-08-12.json",
);
async function frozenManifest() {
  return JSON.parse(
    await fs.readFile(manifestPath, "utf8"),
  ) as WorkMigrationManifest;
}
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
  for (const entry of (await frozenManifest()).entries) {
    const name = `${entry.contentId}.md`;
    const bytes = Buffer.from(entry.source.originalBase64, "base64");
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
  const a = await frozenManifest();
  assert.equal(a.count, 7);
  assert.equal(restoreLegacyWorkBytes(a).size, 7);
  assert.ok(
    a.assetInvariance.before.every(
      (asset) =>
        asset.byteLength > 0 &&
        asset.sha256.length === 64 &&
        asset.references.length > 0,
    ),
  );
  assert.equal(
    worksSha256(serializeWorkMigrationManifest(a)),
    "5eddbe7015aa14c5bc6741cf84a5c14ea4d93cc75cebf9a6812c691daca10498",
  );
});
test("executor dry-run accepts only frozen evidence and performs no migration", async () => {
  const manifest = await frozenManifest();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "works-dry-run-"));
  try {
    for (const entry of manifest.entries)
      await fs.writeFile(
        path.join(tmp, `${entry.contentId}.md`),
        Buffer.from(entry.source.originalBase64, "base64"),
      );
    const before = (await fs.readdir(tmp)).sort();
    const result = await executeWorkMigration(manifest, {
      dryRun: true,
      rootOverride: tmp,
      projectRoot: process.cwd(),
    });
    assert.equal(result.mode, "dry-run");
    assert.deepEqual((await fs.readdir(tmp)).sort(), before);
    const changed = structuredClone(manifest);
    changed.entries[0].source.sha256 = "0".repeat(64);
    await assert.rejects(
      executeWorkMigration(changed, {
        dryRun: true,
        rootOverride: tmp,
        projectRoot: process.cwd(),
      }),
      /frozen manifest/,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
test("repository exact unit, IDs, independent capability, artist boundary and routes", async () => {
  const manifest = await frozenManifest();
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

test("canonical production inventory exposes exactly the capable EN Works", async () => {
  const units = await loadWorkRepository(path.resolve("src/content/works"));
  const facade = createWorksPrototypeFacade(units, (contentId, locale) => ({
    contentId,
    name: contentId,
    route: locale === "ja" ? `/artists/${contentId}/` : `/en/artists/${contentId}/`,
  }));
  assert.deepEqual(
    facade.forLocale("en").map((entry) => entry.contentId),
    ["yuka-mori-01"],
  );
  assert.deepEqual(
    localizedWorkRoutes(facade).filter((route) => route.startsWith("/en/")),
    ["/en/works/yuka-mori-01/"],
  );
});
