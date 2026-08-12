import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { stringify } from "yaml";
import { evaluateHomeCapability } from "./capabilities.ts";
import { convertLegacyHomeMarkdown } from "./migration-converter.ts";
import { executeHomeMigrationFixture } from "./migration-executor.ts";
import {
  createHomeMigrationManifest,
  homeMigrationSha256,
  verifyHomeRollbackEvidence,
} from "./migration-manifest.ts";
import { assertHomeTopology, loadHomeUnit } from "./repository.ts";
import {
  HOME_EN_ABOUT_INTRO_PLACEHOLDER,
  homeLocalizedSchema,
  homeSharedSchema,
} from "./schema.ts";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const frozenManifestFile = path.join(
  projectRoot,
  "docs/migrations/home-localization-manifest-2026-08-12.json",
);
const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const shared = {
  sections: {
    artists: {
      destination: "artists",
      image: { src: "/images/home/artists-square.jpg" },
    },
    about: {
      destination: "about",
      image: { src: "/images/home/about-landscape.jpg" },
    },
  },
} as const;
const localized = (intro: string) => `---\nabout_intro: ${intro}\n---\n`;
async function legacyBytes() {
  const manifest = JSON.parse(await readFile(frozenManifestFile, "utf8")) as {
    source: { originalBase64: string };
  };
  return Buffer.from(manifest.source.originalBase64, "base64");
}

async function fixtureUnit() {
  const root = await mkdtemp(path.join(os.tmpdir(), "home-foundation-"));
  const unit = path.join(root, "home");
  await mkdir(unit);
  await writeFile(path.join(unit, "index.yaml"), stringify(shared));
  await writeFile(path.join(unit, "ja.md"), localized("JA fixture"));
  await writeFile(path.join(unit, "en.md"), localized("EN fixture"));
  return { root, unit };
}

test("strict schemas enforce fixed shared composition and localized fields", () => {
  assert.equal(homeSharedSchema.safeParse(shared).success, true);
  assert.equal(
    homeLocalizedSchema.safeParse({ about_intro: "intro" }).success,
    true,
  );
  assert.equal(
    homeSharedSchema.safeParse({ ...shared, extra: true }).success,
    false,
  );
  assert.equal(
    homeSharedSchema.safeParse({
      sections: {
        ...shared.sections,
        artists: { ...shared.sections.artists, destination: "about" },
      },
    }).success,
    false,
  );
  assert.equal(
    homeLocalizedSchema.safeParse({ about_intro: "", hero_alt: "invented" })
      .success,
    false,
  );
});

test("repository requires exact regular three-file inventory", async (t) => {
  const { root, unit } = await fixtureUnit();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await loadHomeUnit(unit)).issues.length, 0);
  await writeFile(path.join(unit, "extra.txt"), "extra");
  assert.ok(
    (await loadHomeUnit(unit)).issues.some(
      (item) => item.category === "unit-integrity",
    ),
  );
  await rm(path.join(unit, "extra.txt"));
  await rm(path.join(unit, "en.md"));
  assert.equal((await loadHomeUnit(unit)).locales.en.state, "missing");
  await symlink(path.join(unit, "ja.md"), path.join(unit, "en.md"));
  assert.ok(
    (await loadHomeUnit(unit)).issues.some((item) =>
      item.message.includes("regular"),
    ),
  );
});

test("topology rejects flat, mixed, and unexpected nested inventory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "home-topology-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "home.md"), "legacy");
  await assert.rejects(assertHomeTopology(root), /Legacy flat/);
  await mkdir(path.join(root, "home"));
  await assert.rejects(assertHomeTopology(root), /Mixed flat/);
  await rm(path.join(root, "home.md"));
  await mkdir(path.join(root, "home", "nested"));
  const loaded = await loadHomeUnit(path.join(root, "home"));
  assert.ok(loaded.issues.some((item) => item.category === "unit-integrity"));
});

test("placeholder blocks only its locale and capability never falls back", async (t) => {
  const { root, unit } = await fixtureUnit();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(unit, "en.md"),
    localized(HOME_EN_ABOUT_INTRO_PLACEHOLDER),
  );
  const loaded = await loadHomeUnit(unit);
  const routes = {
    ja: { artists: true, about: true },
    en: { artists: true, about: true },
  };
  assert.equal(
    evaluateHomeCapability(loaded, "ja", routes, true).allowed,
    true,
  );
  assert.equal(
    evaluateHomeCapability(loaded, "en", routes, true).allowed,
    false,
  );
  routes.en.about = false;
  assert.ok(
    evaluateHomeCapability(loaded, "en", routes, true).blockers.some((item) =>
      item.message.includes("about route"),
    ),
  );
  assert.equal(
    evaluateHomeCapability(loaded, "ja", routes, false).allowed,
    false,
  );
});

test("converter is deterministic, maps exact images, and requires JA human input", async () => {
  const source = await legacyBytes();
  assert.throws(
    () => convertLegacyHomeMarkdown(source, "home.md", { jaAboutIntro: "" }),
    /Human-approved JA/,
  );
  const first = convertLegacyHomeMarkdown(source, "home.md", {
    jaAboutIntro: "Human JA fixture",
  });
  const second = convertLegacyHomeMarkdown(source, "home.md", {
    jaAboutIntro: "Human JA fixture",
  });
  assert.deepEqual(first, second);
  assert.match(first.shared, /artists-square\.jpg/);
  assert.match(first.shared, /about-landscape\.jpg/);
  assert.equal(first.enPlaceholder, true);
  assert.match(first.en, new RegExp(HOME_EN_ABOUT_INTRO_PLACEHOLDER));
  const withLayout = Buffer.from(
    source
      .toString()
      .replace(
        "sections:",
        "home_hero:\n  layout: default\n  media:\n    type: image\n    image: /hero.jpg\nsections:",
      ),
  );
  assert.throws(
    () =>
      convertLegacyHomeMarkdown(withLayout, "home.md", { jaAboutIntro: "JA" }),
    /layout is not migratable/,
  );
});

test("frozen plan binds temporary copy, rollback, and immutable assets", async () => {
  const manifest = JSON.parse(
    await readFile(frozenManifestFile, "utf8"),
  ) as Awaited<ReturnType<typeof createHomeMigrationManifest>>;
  assert.equal(manifest.mode, "approved-migration");
  assert.equal(manifest.prerequisites.realMigrationAllowed, true);
  assert.equal(manifest.prerequisites.productionCutoverAllowed, false);
  assert.equal(
    manifest.targetPlan.finalTargetEvidence,
    "frozen-temporary-copy",
  );
  assert.equal(manifest.localizedCopy.jaAboutIntro.status, "temporary");
  assert.equal(manifest.localizedCopy.jaAboutIntro.approved, false);
  assert.equal(manifest.localizedCopy.enAboutIntro.status, "placeholder");
  assert.equal(verifyHomeRollbackEvidence(manifest), true);
  const decoded = Buffer.from(manifest.source.originalBase64, "base64");
  assert.equal(decoded.byteLength, manifest.source.byteLength);
  assert.equal(homeMigrationSha256(decoded), manifest.source.sha256);
  assert.deepEqual(
    manifest.assets.map(({ decodedFormat }) => decodedFormat),
    ["webp", "webp", "webp"],
  );
  assert.ok(manifest.assets.every(({ mutated }) => mutated === false));
});

test("fixture executor installs exact unit, rejects drift, and rolls back", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "home-executor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "home.md");
  const bytes = await legacyBytes();
  await writeFile(source, bytes);
  const converted = convertLegacyHomeMarkdown(bytes, source, {
    jaAboutIntro: "Human JA fixture",
    enAboutIntro: "Human EN fixture",
  });
  const contents = {
    "index.yaml": converted.shared,
    "ja.md": converted.ja,
    "en.md": converted.en,
  };
  const plan = {
    migrationVersion: 1 as const,
    source: { path: source, byteLength: bytes.length, sha256: sha256(bytes) },
    targetDirectory: path.join(root, "home"),
    files: {
      "index.yaml": {
        content: contents["index.yaml"],
        sha256: sha256(contents["index.yaml"]),
      },
      "ja.md": {
        content: contents["ja.md"],
        sha256: sha256(contents["ja.md"]),
      },
      "en.md": {
        content: contents["en.md"],
        sha256: sha256(contents["en.md"]),
      },
    },
  };
  await executeHomeMigrationFixture(plan);
  assert.deepEqual(await readdirNames(path.join(root, "home")), [
    "en.md",
    "index.yaml",
    "ja.md",
  ]);
  await assert.rejects(readFile(source), /ENOENT/);
  await rm(path.join(root, "home"), { recursive: true });
  await writeFile(source, `${bytes.toString()}drift`);
  await assert.rejects(executeHomeMigrationFixture(plan), /source drift/);
  await writeFile(source, bytes);
  await assert.rejects(
    executeHomeMigrationFixture(plan, () => {
      throw new Error("injected");
    }),
    /injected/,
  );
  await assert.rejects(
    readFile(path.join(root, "home", "index.yaml")),
    /ENOENT/,
  );
  assert.deepEqual(await readFile(source), bytes);
});

async function readdirNames(directory: string) {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(directory)).sort();
}
