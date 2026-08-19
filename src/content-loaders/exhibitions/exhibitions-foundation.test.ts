import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { createExhibitionsFacade, evaluateExhibitionLocale } from "./facade.ts";
import {
  convertLegacyExhibitionMarkdown,
  EXHIBITIONS_EN_PLACEHOLDERS,
} from "./migration-converter.ts";
import { executeExhibitionMigration } from "./migration-executor.ts";
import {
  createExhibitionMigrationManifest,
  EXHIBITION_MIGRATION_INVENTORY,
  exhibitionMigrationSha256,
  serializeExhibitionMigrationManifest,
  type ExhibitionMigrationManifest,
} from "./migration-manifest.ts";
import { loadExhibitionRepository, loadExhibitionUnit } from "./repository.ts";
import { projectExhibitionRoute } from "./route-registry.ts";
import { exhibitionLocalizedSchema, exhibitionSharedSchema } from "./schema.ts";
import { loadArtistRepository } from "../artists/repository.ts";
import { createArtistsPrototypeFacade } from "../artists/facade.ts";

const frozenPath = path.resolve(
  "docs/architecture/exhibitions-migration-manifest-2026-08-12.json",
);
const frozen = async () =>
  JSON.parse(await readFile(frozenPath, "utf8")) as ExhibitionMigrationManifest;
async function tempSources(manifest: ExhibitionMigrationManifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), "exhibitions-migration-"));
  for (const entry of manifest.entries)
    await writeFile(
      path.join(root, `${entry.contentId}.md`),
      Buffer.from(entry.source.originalBase64, "base64"),
    );
  return root;
}
async function tempUnit() {
  const root = await mkdtemp(path.join(os.tmpdir(), "exhibition-unit-"));
  const unit = path.join(root, "sample-exhibition");
  await mkdir(unit);
  await writeFile(
    path.join(unit, "index.yaml"),
    "artists:\n  - yuka-mori\nstart_date: 2026-01-01\nend_date: 2026-01-02\nhero:\n  image: /x.jpg\n  orientation: portrait\n",
  );
  await writeFile(
    path.join(unit, "ja.md"),
    "---\ntitle: 展覧会\nhero_alt: 画像\n---\n本文\n",
  );
  await writeFile(
    path.join(unit, "en.md"),
    `---\ntitle: ${EXHIBITIONS_EN_PLACEHOLDERS.title}\nhero_alt: ${EXHIBITIONS_EN_PLACEHOLDERS.hero_alt}\n---\n`,
  );
  return { root, unit };
}

test("strict target schemas enforce uniqueness, dates, and required localized fields", () => {
  assert.equal(
    exhibitionSharedSchema.safeParse({
      artists: ["a", "a"],
      start_date: "2026-02-02",
      end_date: "2026-02-01",
      hero: { image: "/x", orientation: "portrait" },
    }).success,
    false,
  );
  assert.equal(
    exhibitionSharedSchema.safeParse({
      artists: ["a"],
      works: ["w", "w"],
      start_date: "2026-01-01",
      end_date: "2026-01-02",
      hero: { image: "/x", orientation: "portrait" },
    }).success,
    false,
  );
  assert.equal(
    exhibitionLocalizedSchema.safeParse({ title: "x" }).success,
    false,
  );
  assert.equal(
    exhibitionLocalizedSchema.safeParse({ title: "x", hero_alt: "y" }).success,
    true,
  );
});

test("repository requires exact files and isolates placeholder EN from JA", async () => {
  const { root, unit } = await tempUnit();
  try {
    const loaded = await loadExhibitionUnit(unit);
    assert.equal(
      evaluateExhibitionLocale(loaded, "ja", () => true).allowed,
      true,
    );
    assert.equal(
      evaluateExhibitionLocale(loaded, "en", () => true).allowed,
      false,
    );
    const facade = createExhibitionsFacade([loaded], () => true);
    assert.equal(facade.forLocale("ja")[0].id, "ja::sample-exhibition");
    assert.equal(facade.forLocale("en").length, 0);
    assert.equal(
      facade.worksProjection("sample-exhibition", "en").mode,
      "omit",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("repository fails closed for missing, extra, symlink, and mixed flat inventory", async () => {
  const { root, unit } = await tempUnit();
  try {
    await writeFile(path.join(unit, "extra.txt"), "x");
    assert.ok(
      (await loadExhibitionUnit(unit)).issues.some(
        (x) => x.category === "unit-integrity",
      ),
    );
    await writeFile(path.join(root, "legacy.md"), "---\n---\n");
    await assert.rejects(loadExhibitionRepository(root), /Legacy flat/);
    await rm(path.join(root, "legacy.md"));
    await symlink(path.join(unit, "ja.md"), path.join(root, "linked"));
    await assert.rejects(loadExhibitionRepository(root), /symlinked/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("route projection never falls back", () => {
  assert.equal(
    projectExhibitionRoute("sample", "ja", true),
    "/exhibitions/sample/",
  );
  assert.equal(
    projectExhibitionRoute("sample", "en", true),
    "/en/exhibitions/sample/",
  );
  assert.equal(projectExhibitionRoute("sample", "en", false), undefined);
});

test("canonical production inventory exposes exactly the capable EN Exhibitions", async () => {
  const [units, artistUnits] = await Promise.all([
    loadExhibitionRepository(path.resolve("src/content/exhibitions")),
    loadArtistRepository(path.resolve("src/content/artists")),
  ]);
  const artists = createArtistsPrototypeFacade(artistUnits);
  const facade = createExhibitionsFacade(units, (contentId, locale) =>
    Boolean(artists.find(contentId, locale)),
  );
  const contentIds = facade
    .forLocale("en")
    .map((entry) => entry.contentId);
  assert.deepEqual(contentIds, [
    "alana-wilson-2027-04",
    "group-exhibition-2026-03",
  ]);
  assert.deepEqual(
    contentIds.map((contentId) =>
      projectExhibitionRoute(contentId, "en", true),
    ),
    [
      "/en/exhibitions/alana-wilson-2027-04/",
      "/en/exhibitions/group-exhibition-2026-03/",
    ],
  );
});

test("converter deterministically preserves all five IDs, references, hero paths, and JA bodies", async () => {
  const manifest = await frozen();
  for (const id of EXHIBITION_MIGRATION_INVENTORY) {
    const evidence = manifest.entries.find((entry) => entry.contentId === id)!;
    const source = evidence.source.path;
    const bytes = Buffer.from(evidence.source.originalBase64, "base64");
    const first = convertLegacyExhibitionMarkdown(bytes, source);
    const second = convertLegacyExhibitionMarkdown(bytes, source);
    assert.deepEqual(first, second);
    const legacyMatch = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(
      bytes.toString("utf8"),
    )!;
    const legacy = parse(legacyMatch[1]);
    const shared = parse(first.shared);
    assert.deepEqual(shared.artists, legacy.artists);
    assert.deepEqual(shared.works, legacy.works);
    assert.equal(shared.hero.image, legacy.hero.image);
    assert.ok(first.ja.endsWith(legacyMatch[2]));
    assert.match(first.en, /__TODO_EN_TITLE__/);
    assert.doesNotMatch(first.en, /seo_title|description/);
  }
});

test("frozen manifest binds exact five sources, targets, hashes, and rollback bytes", async () => {
  const manifest = await frozen();
  const sources = await tempSources(manifest);
  try {
    const regenerated = await createExhibitionMigrationManifest(sources);
    assert.deepEqual(
      regenerated.entries.map(({ contentId, source, generated, rollback }) => ({
        contentId,
        source: {
          ...source,
          path: manifest.entries.find((entry) => entry.contentId === contentId)!
            .source.path,
        },
        generated: Object.fromEntries(
          Object.entries(generated).map(([key, value]) => [
            key,
            {
              ...value,
              path: manifest.entries.find(
                (entry) => entry.contentId === contentId,
              )!.generated[key as keyof typeof generated].path,
            },
          ]),
        ),
        rollback: {
          ...rollback,
          sourcePath: manifest.entries.find(
            (entry) => entry.contentId === contentId,
          )!.rollback.sourcePath,
        },
      })),
      manifest.entries.map(({ contentId, source, generated, rollback }) => ({
        contentId,
        source,
        generated,
        rollback,
      })),
    );
  } finally {
    await rm(sources, { recursive: true });
  }
  assert.equal(manifest.entries.length, 5);
  for (const entry of manifest.entries) {
    const restored = Buffer.from(entry.rollback.originalBase64, "base64");
    assert.equal(exhibitionMigrationSha256(restored), entry.source.sha256);
    assert.equal(restored.length, entry.source.byteLength);
    for (const generated of Object.values(entry.generated))
      assert.equal(
        exhibitionMigrationSha256(generated.content),
        generated.sha256,
      );
  }
  assert.equal(
    exhibitionMigrationSha256(serializeExhibitionMigrationManifest(manifest)),
    "246edf641a799c4dc46624700653d0e50250168a729e33f0ca5933b458989725",
  );
});

test("executor dry-run does not mutate and fixture execution installs all five units", async () => {
  const manifest = await frozen();
  const root = await tempSources(manifest);
  try {
    const dry = await executeExhibitionMigration(manifest, {
      rootOverride: root,
      dryRun: true,
    });
    assert.equal(dry.mode, "dry-run");
    const result = await executeExhibitionMigration(manifest, {
      rootOverride: root,
      dryRun: false,
    });
    assert.equal(result.createdDirectories.length, 5);
    for (const id of EXHIBITION_MIGRATION_INVENTORY) {
      await assert.rejects(readFile(path.join(root, `${id}.md`)));
      assert.equal(
        (await loadExhibitionUnit(path.join(root, id))).shared.state,
        "valid",
      );
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test("executor rejects drift and collision without mutation", async () => {
  const manifest = await frozen();
  const root = await tempSources(manifest);
  try {
    await writeFile(
      path.join(root, `${manifest.entries[0].contentId}.md`),
      "drift",
    );
    await assert.rejects(
      executeExhibitionMigration(manifest, { rootOverride: root }),
      /source drift/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
  const root2 = await tempSources(manifest);
  try {
    await mkdir(path.join(root2, manifest.entries[0].contentId));
    await assert.rejects(
      executeExhibitionMigration(manifest, { rootOverride: root2 }),
      /mixed|collision/,
    );
  } finally {
    await rm(root2, { recursive: true });
  }
});

test("executor rolls every installed directory back after post-install failure", async () => {
  const manifest = await frozen();
  const root = await tempSources(manifest);
  try {
    await assert.rejects(
      executeExhibitionMigration(manifest, {
        rootOverride: root,
        dryRun: false,
        hooks: {
          afterDirectoryInstalled: (id) => {
            if (id === manifest.entries[1].contentId)
              throw new Error("injected");
          },
        },
      }),
      /injected/,
    );
    for (const entry of manifest.entries) {
      assert.equal(
        await readFile(path.join(root, `${entry.contentId}.md`), "utf8"),
        Buffer.from(entry.source.originalBase64, "base64").toString("utf8"),
      );
      await assert.rejects(
        readFile(path.join(root, entry.contentId, "index.yaml")),
      );
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test("staged-write and source-removal failures leave or restore every source", async () => {
  const manifest = await frozen();
  for (const failure of ["staging", "removal"] as const) {
    const root = await tempSources(manifest);
    try {
      await assert.rejects(
        executeExhibitionMigration(manifest, {
          rootOverride: root,
          dryRun: false,
          hooks:
            failure === "staging"
              ? {
                  beforeStagedWrite: (id, file) => {
                    if (
                      id === manifest.entries[1].contentId &&
                      file === "ja.md"
                    )
                      throw new Error("staging injected");
                  },
                }
              : {
                  beforeSourceRemoval: (id) => {
                    if (id === manifest.entries[1].contentId)
                      throw new Error("removal injected");
                  },
                },
        }),
        /injected/,
      );
      for (const entry of manifest.entries)
        assert.deepEqual(
          await readFile(path.join(root, `${entry.contentId}.md`)),
          Buffer.from(entry.source.originalBase64, "base64"),
        );
    } finally {
      await rm(root, { recursive: true });
    }
  }
});

test("rollback failure persists manual recovery evidence", async () => {
  const manifest = await frozen();
  const root = await tempSources(manifest);
  try {
    await assert.rejects(
      executeExhibitionMigration(manifest, {
        rootOverride: root,
        dryRun: false,
        hooks: {
          afterDirectoryInstalled: () => {
            throw new Error("install injected");
          },
          beforeRollbackDirectoryRemoval: () => {
            throw new Error("rollback injected");
          },
        },
      }),
      /rollback failed/,
    );
    const evidence = JSON.parse(
      await readFile(
        path.join(root, ".exhibitions-migration-recovery.json"),
        "utf8",
      ),
    );
    assert.equal(evidence.status, "manual-recovery-required");
    assert.ok(evidence.rollbackErrors.length > 0);
  } finally {
    await rm(root, { recursive: true });
  }
});
