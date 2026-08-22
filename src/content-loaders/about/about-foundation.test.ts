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
import { parse } from "yaml";
import {
  ABOUT_PROVISIONAL_JA_REVIEW,
  planAboutMigration,
  type AboutMigrationInput,
} from "./converter.ts";
import {
  executeAboutMigrationFixture,
  type AboutFixtureExecutionPlan,
} from "./executor.ts";
import { extractAboutSource } from "./extraction.ts";
import { createAboutFacade, evaluateAboutLocale } from "./facade.ts";
import { deriveAboutClosedDays, presentAboutHours } from "./hours-presenter.ts";
import { verifyAboutRollbackEvidence } from "./manifest.ts";
import { assertAboutTopology, loadAboutUnit } from "./repository.ts";
import { projectAboutRoute } from "./route-registry.ts";
import {
  ABOUT_ASSET_URLS,
  ABOUT_WEEKDAYS,
  aboutLocalizedFrontmatterSchema,
  aboutSharedSchema,
  type AboutHours,
} from "./schema.ts";

const assets = {
  hero: true,
  "gallery-1": true,
  "gallery-2": true,
  "gallery-3": true,
  "gallery-4": true,
} as const;
const approvedHours: Exclude<AboutHours, { status: "pending" }> = {
  status: "approved" as const,
  open_days: ["wed", "thu", "fri", "sat"],
  opens: "12:00",
  closes: "18:00",
};
const locale = (label: string) => ({
  statement: `${label} institutional statement`,
  address: `${label} approved address`,
  alts: [1, 2, 3, 4].map((slot) => `${label} alt ${slot}`) as [
    string,
    string,
    string,
    string,
  ],
});
const approvedInput: AboutMigrationInput = {
  hours: approvedHours,
  ja: locale("JA"),
  en: locale("EN"),
};
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

async function temporary() {
  return mkdtemp(path.join(os.tmpdir(), "about-foundation-"));
}

async function writeUnit(
  root: string,
  input: AboutMigrationInput = approvedInput,
) {
  const directory = path.join(root, "about");
  await mkdir(directory, { recursive: true });
  const plan = planAboutMigration(input);
  for (const name of ["index.yaml", "ja.md", "en.md"] as const)
    await writeFile(path.join(directory, name), plan.files[name]);
  return directory;
}

test("Shared schema accepts pending and a complete approved weekly schedule", () => {
  const base = {
    images: {
      hero: { src: ABOUT_ASSET_URLS[0] },
      gallery: ABOUT_ASSET_URLS.slice(1).map((src) => ({ src })),
    },
  };
  assert(
    aboutSharedSchema.safeParse({ ...base, hours: { status: "pending" } })
      .success,
  );
  assert(
    aboutSharedSchema.safeParse({ ...base, hours: approvedHours }).success,
  );
  assert.equal(
    aboutSharedSchema.safeParse({
      ...base,
      hours: { status: "pending" },
      contact: { instagram_url: "https://instagram.com/xxxxx" },
    }).success,
    false,
  );
  assert.deepEqual(ABOUT_WEEKDAYS, [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ]);
});

test("Approved hours reject incomplete, order, time, range, and unknown fields", () => {
  const shared = planAboutMigration(approvedInput).files["index.yaml"];
  assert.match(shared, /status: approved/);
  const valid = aboutSharedSchema.parse({
    images: {
      hero: { src: ABOUT_ASSET_URLS[0] },
      gallery: ABOUT_ASSET_URLS.slice(1).map((src) => ({ src })),
    },
    hours: approvedHours,
  });
  for (const hours of [
    { ...approvedHours, open_days: [] },
    { ...approvedHours, open_days: ["thu", "wed", "fri", "sat"] },
    { ...approvedHours, open_days: ["wed", "wed"] },
    { ...approvedHours, opens: "9:00" },
    { ...approvedHours, opens: "18:00", closes: "18:00" },
    { ...approvedHours, invented: true },
  ])
    assert.equal(
      aboutSharedSchema.safeParse({ ...valid, hours }).success,
      false,
    );
  assert.equal(
    aboutSharedSchema.safeParse({
      ...valid,
      hours: { status: "pending", opens: "12:00" },
    }).success,
    false,
  );
  assert(
    aboutSharedSchema.safeParse({
      ...valid,
      hours: { ...approvedHours, open_days: [...ABOUT_WEEKDAYS] },
    }).success,
  );
  assert.equal(
    aboutSharedSchema.safeParse({
      ...valid,
      hours: { ...approvedHours, timezone: "Asia/Tokyo" },
    }).success,
    false,
  );
  assert.equal(
    aboutSharedSchema.safeParse({
      ...valid,
      hours: { ...approvedHours, closed_days: ["sun"] },
    }).success,
    false,
  );
});

test("Hours presenter derives canonical closed days for JA and EN", () => {
  assert.deepEqual(deriveAboutClosedDays(["sat", "sun"]), [
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
  ]);
  assert.deepEqual(
    presentAboutHours({ ...approvedHours, open_days: ["sat", "sun"] }, "ja"),
    {
      label: "営業日",
      value: "土・日 12:00–18:00",
      closedLabel: "休廊日",
      closedValue: "月・火・水・木・金",
    },
  );
  assert.deepEqual(
    presentAboutHours({ ...approvedHours, open_days: ["sat", "sun"] }, "en"),
    {
      label: "Open",
      value: "Sat, Sun 12:00–18:00",
      closedLabel: "Closed",
      closedValue: "Mon, Tue, Wed, Thu, Fri",
    },
  );
  assert.deepEqual(deriveAboutClosedDays(ABOUT_WEEKDAYS), []);
});

test("Image schemas enforce four unique Shared src and four localized alt-only slots", () => {
  const plan = planAboutMigration(approvedInput);
  assert.equal(plan.status, "ready");
  const shared = aboutSharedSchema.parse(parse(plan.files["index.yaml"]));
  assert.equal(shared.images.gallery.length, 4);
  const duplicate = structuredClone(shared);
  duplicate.images.gallery[3].src = duplicate.images.gallery[0].src;
  assert.equal(aboutSharedSchema.safeParse(duplicate).success, false);
  assert.equal(
    aboutLocalizedFrontmatterSchema.safeParse({
      content_status: "approved",
      address: "Address",
      images: { gallery: [{ alt: "1" }, { alt: "2" }, { alt: "3" }] },
    }).success,
    false,
  );
  assert.equal(
    aboutLocalizedFrontmatterSchema.safeParse({
      content_status: "approved",
      address: "Address",
      images: {
        gallery: [
          { alt: "1", src: "/bad.jpg" },
          { alt: "2" },
          { alt: "3" },
          { alt: "4" },
        ],
      },
    }).success,
    false,
  );
});

test("Localized status admits placeholders but review and approved reject markers and empty fields", () => {
  const placeholder = {
    content_status: "placeholder",
    address: "__TODO_ABOUT_JA_ADDRESS__",
    images: {
      gallery: [1, 2, 3, 4].map((slot) => ({
        alt: `__TODO_ABOUT_JA_ALT_${slot}__`,
      })),
    },
  };
  assert(aboutLocalizedFrontmatterSchema.safeParse(placeholder).success);
  assert.equal(
    aboutLocalizedFrontmatterSchema.safeParse({
      ...placeholder,
      content_status: "review",
    }).success,
    false,
  );
  assert.equal(
    aboutLocalizedFrontmatterSchema.safeParse({ ...placeholder, address: "" })
      .success,
    false,
  );
});

test("Repository loads exact unit and reports pending/placeholder quality without structural failure", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await writeUnit(root, {});
  assert.equal(await assertAboutTopology(root), directory);
  const unit = await loadAboutUnit(directory);
  assert.equal(unit.shared.state, "valid");
  assert.equal(unit.locales.ja.state, "valid");
  assert(unit.issues.some(({ category }) => category === "factual-approval"));
  assert.equal(
    evaluateAboutLocale(unit, "ja", assets, true).previewable,
    false,
  );
});

test("Repository rejects missing, extra, symlink, nested, and mixed topology", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await writeUnit(root);
  await rm(path.join(directory, "en.md"));
  assert(
    (await loadAboutUnit(directory)).issues.some(
      ({ category }) => category === "unit-integrity",
    ),
  );
  await writeFile(
    path.join(directory, "en.md"),
    planAboutMigration(approvedInput).files["en.md"],
  );
  await writeFile(path.join(directory, "extra.md"), "extra");
  assert(
    (await loadAboutUnit(directory)).issues.some(
      ({ category }) => category === "unit-integrity",
    ),
  );
  await rm(path.join(directory, "extra.md"));
  await symlink(
    path.join(directory, "ja.md"),
    path.join(directory, "extra-link"),
  );
  assert(
    (await loadAboutUnit(directory)).issues.some(
      ({ category }) => category === "unit-integrity",
    ),
  );
  await rm(path.join(directory, "extra-link"));
  await mkdir(path.join(directory, "nested"));
  assert(
    (await loadAboutUnit(directory)).issues.some(
      ({ category }) => category === "unit-integrity",
    ),
  );
  await writeFile(path.join(root, "about.md"), "legacy");
  await assert.rejects(() => assertAboutTopology(root), /Mixed legacy/);
});

test("Capability separates placeholder, review, approved, hours, assets, route, and locales", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pendingDirectory = await writeUnit(path.join(root, "pending"), {
    ja: locale("JA"),
    en: locale("EN"),
  });
  const pending = await loadAboutUnit(pendingDirectory);
  assert.equal(
    evaluateAboutLocale(pending, "ja", assets, true).previewable,
    true,
  );
  assert.equal(evaluateAboutLocale(pending, "ja", assets, true).formal, false);

  const approvedDirectory = await writeUnit(path.join(root, "approved"));
  const approved = await loadAboutUnit(approvedDirectory);
  const facade = createAboutFacade(approved, assets);
  assert.equal(facade.capability("ja").formal, true);
  assert.equal(facade.capability("en").formal, true);
  assert.equal(facade.capability("en", false).formal, false);
  assert.equal(
    evaluateAboutLocale(approved, "ja", { ...assets, hero: false }, true)
      .formal,
    false,
  );
  assert.deepEqual(projectAboutRoute("ja", true), {
    kind: "available",
    href: "/about/",
  });
  assert.deepEqual(projectAboutRoute("en", true), {
    kind: "available",
    href: "/en/about/",
  });
  assert.deepEqual(projectAboutRoute("en", false), { kind: "unavailable" });
});

test("Review content previews without becoming formal", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await writeUnit(root);
  const enFile = path.join(directory, "en.md");
  const raw = await readFile(enFile, "utf8");
  await writeFile(
    enFile,
    raw.replace("content_status: approved", "content_status: review"),
  );
  const unit = await loadAboutUnit(directory);
  assert.equal(evaluateAboutLocale(unit, "en", assets, true).previewable, true);
  assert.equal(evaluateAboutLocale(unit, "en", assets, true).formal, false);
  assert.equal(evaluateAboutLocale(unit, "ja", assets, true).formal, true);
});

test("Invalid EN body blocks EN without fallback or suppressing capable JA", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await writeUnit(root);
  const enFile = path.join(directory, "en.md");
  const raw = await readFile(enFile, "utf8");
  await writeFile(enFile, raw.replace(/\nEN institutional statement\n$/, "\n"));
  const unit = await loadAboutUnit(directory);
  assert.equal(evaluateAboutLocale(unit, "en", assets, true).formal, false);
  assert.equal(evaluateAboutLocale(unit, "ja", assets, true).formal, true);
});

test("Extraction binds source spans and never promotes stale facts or placeholders", async () => {
  const frozen = JSON.parse(
    await readFile(
      "docs/migrations/about-localization-manifest-2026-08-18.json",
      "utf8",
    ),
  );
  const astro = Buffer.from(frozen.rollback.originalBase64, "base64");
  const css = Buffer.from(
    '.about-hero-image { background-image: url("/images/about/about-hero.jpg"); }\n',
  );
  const extracted = extractAboutSource(astro, css);
  for (const item of extracted.mappings)
    assert.equal(
      (item.source === "about.astro" ? astro : css)
        .subarray(item.span.start, item.span.end)
        .toString(),
      item.span.raw,
    );
  assert.equal(
    extracted.mappings.find(({ field }) => field === "statement")
      ?.classification,
    "human-required",
  );
  assert.equal(
    extracted.mappings.find(({ field }) => field === "contact.map_url")
      ?.classification,
    "obsolete-drop",
  );
  assert.equal(
    extracted.mappings.find(({ field }) => field === "images.hero.src")
      ?.classification,
    "verbatim",
  );
});

test("Converter blocks without approvals and is deterministic with explicit synthetic inputs", () => {
  const blocked = planAboutMigration();
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.provisional, true);
  assert.match(blocked.files["ja.md"], /__TODO_ABOUT_JA_STATEMENT__/);
  const provisional = planAboutMigration({
    jaReview: ABOUT_PROVISIONAL_JA_REVIEW,
  });
  assert.equal(provisional.status, "blocked");
  assert.match(provisional.files["ja.md"], /content_status: review/);
  assert.match(provisional.files["en.md"], /content_status: placeholder/);
  const first = planAboutMigration(approvedInput);
  const second = planAboutMigration(structuredClone(approvedInput));
  assert.equal(first.status, "ready");
  assert.deepEqual(first, second);
  assert.doesNotMatch(JSON.stringify(first.files), /__TODO_ABOUT_/);
  assert.throws(
    () =>
      planAboutMigration({
        ...approvedInput,
        en: { ...locale("EN"), statement: "__TODO_ABOUT_EN_STATEMENT__" },
      }),
    /provided statement is invalid/,
  );
});

test("Frozen migration evidence retains assets, mappings, and human gates", async () => {
  const frozen = JSON.parse(
    await readFile(
      "docs/migrations/about-localization-manifest-2026-08-18.json",
      "utf8",
    ),
  );
  assert.equal(frozen.assets.length, 5);
  assert.equal(
    new Set(frozen.assets.map(({ sha256 }: { sha256: string }) => sha256)).size,
    5,
  );
  assert(
    frozen.assets.every(
      ({ decodedFormat }: { decodedFormat: string }) =>
        decodedFormat === "jpeg",
    ),
  );
  assert.equal(frozen.authorization.provisionalMigrationExecuted, true);
  assert.equal(frozen.authorization.formalProductionCutoverAllowed, false);
  assert.deepEqual(frozen.formalCapability, { ja: false, en: false });
  assert(Object.values(frozen.humanGates).every((value) => value === false));
  assert.equal(frozen.targetPlan.finalHumanApprovedHashes, null);
  assert(verifyAboutRollbackEvidence(frozen));
});

test("Current canonical unit is approved and formally capable in both locales", async () => {
  const unit = await loadAboutUnit("src/content/about/about");
  assert.equal(unit.shared.state, "valid");
  assert.equal(unit.locales.ja.state, "valid");
  assert.equal(unit.locales.en.state, "valid");
  if (
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid"
  )
    assert.fail("canonical provisional unit must be structurally valid");
  assert.equal(unit.shared.value.hours.status, "approved");
  assert.deepEqual(unit.shared.value.hours.open_days, ["sat", "sun"]);
  assert.equal(unit.shared.value.hours.opens, "13:00");
  assert.equal(unit.shared.value.hours.closes, "18:00");
  assert.equal(unit.locales.ja.value.content_status, "approved");
  assert.equal(unit.locales.en.value.content_status, "approved");
  assert(presentAboutHours(unit.shared.value.hours, "ja"));
  const facade = createAboutFacade(unit, assets);
  assert.equal(facade.capability("ja").previewable, true);
  assert.equal(facade.capability("ja").formal, true);
  assert.equal(facade.capability("en").previewable, true);
  assert.equal(facade.capability("en").formal, true);
  const ja = facade.source("ja");
  assert(ja);
  assert.deepEqual(
    ja.data.images.gallery.map(({ src }) => src),
    ABOUT_ASSET_URLS.slice(1),
  );
  assert.deepEqual(
    ja.data.images.gallery.map(({ alt }) => alt),
    unit.locales.ja.value.images.gallery.map(({ alt }) => alt),
  );
});

function executionPlan(
  source: string,
  target: string,
  input: AboutMigrationInput = approvedInput,
): AboutFixtureExecutionPlan {
  const plan = planAboutMigration(input);
  const bytes = Buffer.from("fixture Astro source\n");
  return {
    migrationVersion: 1,
    fixtureOnly: true,
    source: { path: source, byteLength: bytes.length, sha256: sha(bytes) },
    targetDirectory: target,
    files: Object.fromEntries(
      (["index.yaml", "ja.md", "en.md"] as const).map((name) => [
        name,
        {
          content: plan.files[name],
          byteLength: Buffer.byteLength(plan.files[name]),
          sha256: sha(plan.files[name]),
        },
      ]),
    ) as AboutFixtureExecutionPlan["files"],
  };
}

test("Fixture executor dry-run verifies without mutation and execution preserves source", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "about.astro");
  const target = path.join(root, "content", "about");
  await writeFile(source, "fixture Astro source\n");
  const plan = executionPlan(source, target);
  assert.equal((await executeAboutMigrationFixture(plan)).mode, "dry-run");
  assert.equal(await readFile(source, "utf8"), "fixture Astro source\n");
  assert.equal(await readFile(target).catch(() => undefined), undefined);
  const result = await executeAboutMigrationFixture(plan, { dryRun: false });
  assert.equal(result.mode, "executed");
  assert.equal(await readFile(source, "utf8"), "fixture Astro source\n");
  assert.equal((await loadAboutUnit(target)).shared.state, "valid");
});

test("Fixture executor rejects drift, collision, and staged write failure", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "about.astro");
  const target = path.join(root, "content", "about");
  await writeFile(source, "fixture Astro source\n");
  const plan = executionPlan(source, target);
  await writeFile(source, "drift\n");
  await assert.rejects(
    () => executeAboutMigrationFixture(plan),
    /source drift/,
  );
  await writeFile(source, "fixture Astro source\n");
  await mkdir(target, { recursive: true });
  await assert.rejects(
    () => executeAboutMigrationFixture(plan),
    /target collision/,
  );
  await rm(target, { recursive: true });
  await assert.rejects(
    () =>
      executeAboutMigrationFixture(plan, {
        dryRun: false,
        hooks: {
          beforeStagedWrite: () => {
            throw new Error("injected write failure");
          },
        },
      }),
    /injected write failure/,
  );
  assert.equal(await readFile(source, "utf8"), "fixture Astro source\n");
});

test("Fixture executor rolls install back and records durable recovery on rollback failure", async (t) => {
  const root = await temporary();
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "about.astro");
  await writeFile(source, "fixture Astro source\n");
  const target = path.join(root, "first", "about");
  await assert.rejects(
    () =>
      executeAboutMigrationFixture(executionPlan(source, target), {
        dryRun: false,
        hooks: {
          afterInstall: () => {
            throw new Error("post-install failure");
          },
        },
      }),
    /post-install failure/,
  );
  assert.equal(await readFile(target).catch(() => undefined), undefined);
  assert.equal(await readFile(source, "utf8"), "fixture Astro source\n");

  const failedTarget = path.join(root, "second", "about");
  await assert.rejects(
    () =>
      executeAboutMigrationFixture(executionPlan(source, failedTarget), {
        dryRun: false,
        hooks: {
          afterInstall: () => {
            throw new Error("post-install failure");
          },
          beforeRollbackRemoval: () => {
            throw new Error("rollback blocked");
          },
        },
      }),
    /rollback failed/,
  );
  const recovery = JSON.parse(
    await readFile(
      path.join(root, "second", ".about-migration-recovery.json"),
      "utf8",
    ),
  );
  assert.equal(recovery.status, "manual-recovery-required");
  assert.equal(recovery.sourcePreserved, true);
});
