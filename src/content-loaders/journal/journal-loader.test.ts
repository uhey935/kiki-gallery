import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { stringify } from "yaml";
import { loadJournalRepository, loadJournalUnit } from "./repository.ts";
import { entriesFromUnits } from "./entry-adapter.ts";
import { evaluateJournalCapabilities } from "./capabilities.ts";
import {
  createJournalProductionFacade,
  findJournalEntry,
  journalRouteRegistry,
  queryJournalEntries,
} from "../../content-boundaries/journal.ts";
import { createJournalReadModel } from "../../content-services/journal-read-model.ts";
import {
  JournalAdapterFailure,
  synchronizeJournalStore,
} from "./astro-loader.ts";
import { journalSchema, journalSharedSchema } from "./schema.ts";

const fixtures = path.resolve("src/content-loaders/journal/fixtures");

test("current category schema accepts only one required canonical enum", () => {
  const base = {
    date: "2026-08-22",
    hero: { image: "/images/journal/category.jpg" },
    visibility: "public",
  };
  for (const category of ["interview", "essay", "report"])
    assert.equal(
      journalSharedSchema.safeParse({ ...base, category }).success,
      true,
    );
  for (const invalid of [
    base,
    { ...base, category: "unknown" },
    { ...base, category: ["interview"] },
    { ...base, categories: ["interview"] },
  ])
    assert.equal(journalSharedSchema.safeParse(invalid).success, false);
});

async function temporaryExactUnit(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-topology-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const unit = path.join(root, "exact-unit");
  await fs.cp(path.join(fixtures, "valid-public"), unit, { recursive: true });
  return { root, unit };
}

function assertRepositoryIntegrity(
  unit: Awaited<ReturnType<typeof loadJournalUnit>>,
) {
  assert.ok(
    unit.issues.some(
      (issue) =>
        issue.ruleId === "content.repository.inventory" &&
        issue.category === "repository-integrity",
    ),
  );
  const capabilities = evaluateJournalCapabilities(unit);
  assert.equal(capabilities.save.allowed, false);
  assert.equal(capabilities.preview.ja.allowed, false);
  assert.equal(capabilities.preview.en.allowed, false);
  assert.equal(capabilities.publish.allowed, false);
}

test("loads three-file units as locale entries and retains raw Markdown", async () => {
  const units = await loadJournalRepository(fixtures);
  const entries = entriesFromUnits(units);
  assert.equal(units.length, 5);
  assert.equal(entries.length, 7);
  assert.equal(findJournalEntry(entries, "en", "missing-en"), undefined);
  assert.match(
    findJournalEntry(entries, "ja", "valid-public")?.body ?? "",
    /## 日本語本文/,
  );
  assert.equal(
    findJournalEntry(entries, "ja", "valid-public")?.data.contentId,
    "valid-public",
  );
  const raw = await fs.readFile(path.join(fixtures, "valid-public", "ja.md"));
  const bodyStart = raw.indexOf(Buffer.from("\n---\n")) + 5;
  assert.deepEqual(
    Buffer.from(findJournalEntry(entries, "ja", "valid-public")?.body ?? ""),
    raw.subarray(bodyStart),
  );
});

test("repository accepts only exact, safe three-file Journal units", async (t) => {
  await t.test("valid exact unit", async (t) => {
    const { unit } = await temporaryExactUnit(t);
    const loaded = await loadJournalUnit(unit);
    assert.equal(loaded.issues.length, 0);
    assert.deepEqual(
      entriesFromUnits([loaded]).map((entry) => entry.id),
      ["ja::exact-unit", "en::exact-unit"],
    );
  });

  for (const expected of ["index.yaml", "ja.md", "en.md"] as const) {
    await t.test(`missing ${expected}`, async (t) => {
      const { unit } = await temporaryExactUnit(t);
      await fs.rm(path.join(unit, expected));
      const loaded = await loadJournalUnit(unit);
      if (expected === "index.yaml") {
        assert.equal(loaded.shared.state, "missing");
        assert.ok(
          loaded.issues.some(
            (issue) => issue.ruleId === "content.file.missing",
          ),
        );
        const capabilities = evaluateJournalCapabilities(loaded);
        assert.equal(capabilities.preview.ja.allowed, false);
        assert.equal(capabilities.preview.en.allowed, false);
      } else {
        const locale = expected.slice(0, 2) as "ja" | "en";
        const sibling = locale === "ja" ? "en" : "ja";
        assert.equal(loaded.locales[locale].state, "missing");
        assert.ok(
          loaded.issues.some(
            (issue) =>
              issue.ruleId === "content.locale.missing" &&
              issue.locale === locale,
          ),
        );
        const capabilities = evaluateJournalCapabilities(loaded);
        assert.equal(capabilities.preview[locale].allowed, false);
        assert.equal(capabilities.preview[sibling].allowed, true);
      }
    });
  }

  await t.test("unexpected extra regular file", async (t) => {
    const { unit } = await temporaryExactUnit(t);
    await fs.writeFile(path.join(unit, "extra.txt"), "unexpected");
    assertRepositoryIntegrity(await loadJournalUnit(unit));
  });

  await t.test("nested directory and content", async (t) => {
    const { unit } = await temporaryExactUnit(t);
    await fs.mkdir(path.join(unit, "nested"));
    await fs.writeFile(path.join(unit, "nested", "entry.md"), "nested");
    assertRepositoryIntegrity(await loadJournalUnit(unit));
  });

  for (const expected of ["index.yaml", "ja.md", "en.md"] as const) {
    await t.test(`symlinked ${expected}`, async (t) => {
      const { root, unit } = await temporaryExactUnit(t);
      const source = path.join(unit, expected);
      const target = path.join(root, `target-${expected.replace(".", "-")}`);
      await fs.rename(source, target);
      await fs.symlink(target, source);
      const loaded = await loadJournalUnit(unit);
      assertRepositoryIntegrity(loaded);
      if (expected === "index.yaml") {
        assert.equal(loaded.shared.state, "missing");
        assert.ok(
          loaded.issues.some((issue) => issue.ruleId === "content.file.unsafe"),
        );
      } else {
        const locale = expected.slice(0, 2) as "ja" | "en";
        assert.equal(loaded.locales[locale].state, "missing");
        assert.ok(
          loaded.issues.some(
            (issue) =>
              issue.ruleId === "content.locale.unsafe" &&
              issue.locale === locale,
          ),
        );
      }
    });
  }

  await t.test("non-regular expected source path", async (t) => {
    const { unit } = await temporaryExactUnit(t);
    await fs.rm(path.join(unit, "ja.md"));
    await fs.mkdir(path.join(unit, "ja.md"));
    const loaded = await loadJournalUnit(unit);
    assertRepositoryIntegrity(loaded);
    assert.equal(loaded.locales.ja.state, "missing");
    assert.ok(
      loaded.issues.some(
        (issue) =>
          issue.ruleId === "content.locale.unsafe" && issue.locale === "ja",
      ),
    );
  });
});

test("repository and canonical Astro schema accept the same integrated entries", async () => {
  const shared = {
    date: "2026-01-31",
    category: "interview",
    hero: { image: "/images/journal/parity.jpg" },
    visibility: "public",
  };
  const localized = {
    title: "Parity test",
    summary: "Canonical schema parity",
    hero_alt: "Parity test image",
  };
  const cases = [
    { name: "valid entry", shared, accepted: true },
    {
      name: "invalid calendar date",
      shared: { ...shared, date: "2026-02-30" },
      accepted: false,
    },
    {
      name: "removed author field",
      shared: { ...shared, author: "valid-author" },
      accepted: false,
    },
    {
      name: "removed credits field",
      shared: {
        ...shared,
        credits: [{ role: "Photography", person: "valid-author" }],
      },
      accepted: false,
    },
  ];

  for (const parityCase of cases) {
    const temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "kiki-journal-schema-parity-"),
    );
    const directory = path.join(temporaryRoot, "schema-parity");
    try {
      await fs.mkdir(directory);
      await fs.writeFile(
        path.join(directory, "index.yaml"),
        stringify(parityCase.shared),
      );
      const markdown = `---\n${stringify(localized)}---\nBody\n`;
      await Promise.all(
        ["ja", "en"].map((locale) =>
          fs.writeFile(path.join(directory, `${locale}.md`), markdown),
        ),
      );

      const units = await loadJournalRepository(temporaryRoot);
      const repositoryAccepted = entriesFromUnits(units).length === 2;
      const schemaAccepted = journalSchema.safeParse({
        ...parityCase.shared,
        ...localized,
        contentId: "schema-parity",
        locale: "ja",
      }).success;
      assert.equal(repositoryAccepted, schemaAccepted, parityCase.name);
      assert.equal(schemaAccepted, parityCase.accepted, parityCase.name);
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }
});

test("journal fixtures report broken shared data without creating stale entries", async () => {
  const units = await loadJournalRepository(fixtures);
  const broken = units.find((unit) => unit.contentId === "broken-shared")!;
  assert.equal(broken.shared.state, "invalid");
  assert.ok(
    broken.issues.some((item) => item.ruleId === "content.shared.parse"),
  );
  assert.deepEqual(entriesFromUnits([broken]), []);
});

test("reports missing locale and placeholders without discarding valid siblings", async () => {
  const units = await loadJournalRepository(fixtures);
  const missing = units.find((unit) => unit.contentId === "missing-en")!;
  const placeholder = units.find(
    (unit) => unit.contentId === "placeholder-en",
  )!;
  assert.equal(missing.locales.en.state, "missing");
  assert.ok(
    missing.issues.some(
      (item) =>
        item.ruleId === "content.locale.missing" && item.locale === "en",
    ),
  );
  assert.equal(entriesFromUnits([missing]).length, 1);
  assert.equal(
    placeholder.issues.filter(
      (item) => item.ruleId === "content.placeholder.unresolved",
    ).length,
    4,
  );
  const capability = evaluateJournalCapabilities(placeholder);
  assert.equal(capability.save.allowed, true);
  assert.equal(capability.preview.ja.allowed, true);
  assert.equal(capability.preview.en.allowed, false);
  assert.equal(capability.publish.allowed, false);
});

test("query adapter filters locales, finds by Content ID, and sorts stably", async () => {
  const entries = entriesFromUnits(await loadJournalRepository(fixtures));
  const ja = queryJournalEntries(entries, "ja");
  assert.deepEqual(
    ja.map((entry) => entry.data.contentId),
    ["valid-public", "hidden", "missing-en", "placeholder-en"],
  );
  const tied = ja.slice(0, 2).map((entry, index) => ({
    ...entry,
    id: `tie-${index}`,
    data: {
      ...entry.data,
      date: "2026-01-01",
      contentId: index ? "alpha" : "zeta",
    },
  }));
  assert.deepEqual(
    queryJournalEntries(tied, "ja").map((entry) => entry.data.contentId),
    ["alpha", "zeta"],
  );
});

test("Production facade transports repository issues to all four Journal surfaces", async () => {
  const units = await loadJournalRepository(fixtures);
  const entries = entriesFromUnits(units);
  const production = createJournalProductionFacade(
    createJournalReadModel(entries, units),
  );
  for (const select of [
    production.forIndex,
    production.forDetail,
    production.forHomeStories,
    production.forNewsIntegration,
  ]) {
    assert.deepEqual(
      select("en").map((entry) => entry.data.contentId),
      ["valid-public"],
    );
    assert.deepEqual(
      select("ja").map((entry) => entry.data.contentId),
      ["valid-public", "missing-en", "placeholder-en"],
    );
  }

  assert.ok(
    units
      .find((unit) => unit.contentId === "placeholder-en")
      ?.issues.some(
        (issue) => issue.ruleId === "content.placeholder.unresolved",
      ),
  );
  assert.equal(
    production
      .forDetail("ja")
      .some((entry) => entry.data.contentId === "hidden"),
    false,
  );
});

test("canonical production inventory exposes all JA and EN Journal routes", async () => {
  const units = await loadJournalRepository(
    path.resolve("src/content/journal"),
  );
  const production = createJournalProductionFacade(
    createJournalReadModel(entriesFromUnits(units), units),
  );
  const jaContentIds = production
    .forDetail("ja")
    .map((entry) => entry.data.contentId);
  const enContentIds = production
    .forDetail("en")
    .map((entry) => entry.data.contentId);
  assert.deepEqual(jaContentIds, [
    "essay-keisuke-matsuda",
    "interview-keisuke-matsuda-2026-02",
    "report-yuka-mori-2025-07",
    "interview-keisuke-matsuda-2020-02",
    "interview-keisuke-matsuda-2020-03",
    "interview-keisuke-matsuda-2020-04",
    "interview-keisuke-matsuda-2020-06",
    "interview-keisuke-matsuda-2020-07",
    "interview-keisuke-matsuda-2020-09",
  ]);
  assert.deepEqual(enContentIds, [
    "essay-keisuke-matsuda",
    "interview-keisuke-matsuda-2026-02",
    "report-yuka-mori-2025-07",
    "interview-keisuke-matsuda-2020-02",
    "interview-keisuke-matsuda-2020-03",
    "interview-keisuke-matsuda-2020-04",
    "interview-keisuke-matsuda-2020-06",
    "interview-keisuke-matsuda-2020-07",
    "interview-keisuke-matsuda-2020-09",
  ]);
  assert.deepEqual(
    jaContentIds.map((contentId) =>
      journalRouteRegistry.build({
        collection: "journal",
        contentId,
        locale: "ja",
      }),
    ),
    [
      "/journal/essay-keisuke-matsuda/",
      "/journal/interview-keisuke-matsuda-2026-02/",
      "/journal/report-yuka-mori-2025-07/",
      "/journal/interview-keisuke-matsuda-2020-02/",
      "/journal/interview-keisuke-matsuda-2020-03/",
      "/journal/interview-keisuke-matsuda-2020-04/",
      "/journal/interview-keisuke-matsuda-2020-06/",
      "/journal/interview-keisuke-matsuda-2020-07/",
      "/journal/interview-keisuke-matsuda-2020-09/",
    ],
  );
  assert.deepEqual(
    enContentIds.map((contentId) =>
      journalRouteRegistry.build({
        collection: "journal",
        contentId,
        locale: "en",
      }),
    ),
    [
      "/en/journal/essay-keisuke-matsuda/",
      "/en/journal/interview-keisuke-matsuda-2026-02/",
      "/en/journal/report-yuka-mori-2025-07/",
      "/en/journal/interview-keisuke-matsuda-2020-02/",
      "/en/journal/interview-keisuke-matsuda-2020-03/",
      "/en/journal/interview-keisuke-matsuda-2020-04/",
      "/en/journal/interview-keisuke-matsuda-2020-06/",
      "/en/journal/interview-keisuke-matsuda-2020-07/",
      "/en/journal/interview-keisuke-matsuda-2020-09/",
    ],
  );
  assert.deepEqual(
    production.forIndex("en").map((entry) => entry.data.contentId),
    [
      "essay-keisuke-matsuda",
      "interview-keisuke-matsuda-2026-02",
      "report-yuka-mori-2025-07",
      "interview-keisuke-matsuda-2020-02",
      "interview-keisuke-matsuda-2020-03",
      "interview-keisuke-matsuda-2020-04",
      "interview-keisuke-matsuda-2020-06",
      "interview-keisuke-matsuda-2020-07",
      "interview-keisuke-matsuda-2020-09",
    ],
  );
});

test("Route Registry normalizes generated routes and accepts either trailing-slash input", () => {
  const ja = {
    collection: "journal",
    contentId: "valid-public",
    locale: "ja",
  } as const;
  const en = { ...ja, locale: "en" } as const;
  assert.equal(journalRouteRegistry.build(ja), "/journal/valid-public/");
  assert.equal(journalRouteRegistry.build(en), "/en/journal/valid-public/");
  assert.deepEqual(journalRouteRegistry.parse("/en/journal/valid-public/"), en);
  assert.deepEqual(journalRouteRegistry.parse("/journal/valid-public"), ja);
  assert.equal(journalRouteRegistry.parse("/news/valid-public/"), undefined);
});

test("Astro Store synchronization removes stale entries after repository changes", async () => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "kiki-journal-loader-"),
  );
  const records = new Map<string, { id: string }>();
  const store = {
    keys: () => records.keys(),
    delete: (id: string) => records.delete(id),
    set: (entry: { id: string }) => records.set(entry.id, entry),
  };
  const context = {
    store,
    parseData: async ({ data }: { data: unknown }) => data,
    renderMarkdown: async () => ({ metadata: { imagePaths: [] } }),
    generateDigest: (value: string) => value,
    config: { root: new URL(`file://${process.cwd()}/`) },
  };
  try {
    await fs.cp(fixtures, temporaryRoot, { recursive: true });
    await synchronizeJournalStore(context as never, temporaryRoot);
    assert.ok(records.has("ja::valid-public"));
    assert.ok(records.has("en::valid-public"));
    await fs.rm(path.join(temporaryRoot, "valid-public"), { recursive: true });
    await synchronizeJournalStore(context as never, temporaryRoot);
    assert.equal(records.has("ja::valid-public"), false);
    assert.equal(records.has("en::valid-public"), false);
    await fs.writeFile(
      path.join(temporaryRoot, "missing-en", "index.yaml"),
      "date: [broken",
    );
    await synchronizeJournalStore(context as never, temporaryRoot);
    assert.equal(records.has("ja::missing-en"), false);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("parseData content failure becomes a render-blocking owned Issue", async () => {
  const records = new Map<string, { id: string }>();
  const parseFailure = new Error("Astro schema rejected source data");
  parseFailure.name = "InvalidContentEntryDataError";
  const context = {
    store: {
      keys: () => records.keys(),
      delete: (id: string) => records.delete(id),
      set: (entry: { id: string }) => records.set(entry.id, entry),
    },
    parseData: async ({ id, data }: { id: string; data: unknown }) => {
      if (id === "en::valid-public") throw parseFailure;
      return data;
    },
    renderMarkdown: async () => ({ metadata: { imagePaths: [] } }),
    generateDigest: (value: string) => value,
    config: { root: new URL(`file://${process.cwd()}/`) },
  };

  const units = await synchronizeJournalStore(context as never, fixtures);
  const unit = units.find(
    (candidate) => candidate.contentId === "valid-public",
  )!;
  const failure = unit.issues.find(
    (issue) => issue.ruleId === "content.adapter.parse-data",
  );
  assert.deepEqual(
    {
      contentId: failure?.contentId,
      locale: failure?.locale,
      stage: failure?.stage,
      severity: failure?.severity,
      renderBlocking: failure?.renderBlocking,
      diagnostic: failure?.diagnostic,
    },
    {
      contentId: "valid-public",
      locale: "en",
      stage: "parseData",
      severity: "error",
      renderBlocking: true,
      diagnostic: {
        name: "InvalidContentEntryDataError",
        message: "Astro schema rejected source data",
      },
    },
  );
  assert.equal(records.has("en::valid-public"), false);
  const production = createJournalProductionFacade(
    createJournalReadModel(entriesFromUnits(units), units),
  );
  assert.equal(
    production
      .forIndex("en")
      .some((entry) => entry.data.contentId === "valid-public"),
    false,
  );
  assert.ok(
    production
      .forIndex("ja")
      .some((entry) => entry.data.contentId === "valid-public"),
  );
});

test("Markdown content failure becomes a locale-scoped adapter Issue", async () => {
  const records = new Map<string, { id: string }>();
  const markdownFailure = Object.assign(new Error("Broken Markdown source"), {
    type: "MarkdownError",
  });
  const context = {
    store: {
      keys: () => records.keys(),
      delete: (id: string) => records.delete(id),
      set: (entry: { id: string }) => records.set(entry.id, entry),
    },
    parseData: async ({ data }: { data: unknown }) => data,
    renderMarkdown: async (_body: string, options: { fileURL: URL }) => {
      if (options.fileURL.pathname.endsWith("/valid-public/ja.md")) {
        throw markdownFailure;
      }
      return { metadata: { imagePaths: [] } };
    },
    generateDigest: (value: string) => value,
    config: { root: new URL(`file://${process.cwd()}/`) },
  };

  const units = await synchronizeJournalStore(context as never, fixtures);
  const failure = units
    .find((unit) => unit.contentId === "valid-public")
    ?.issues.find(
      (issue) => issue.ruleId === "content.adapter.markdown-render",
    );
  assert.equal(failure?.locale, "ja");
  assert.equal(failure?.stage, "render");
  assert.equal(failure?.diagnostic?.message, "Broken Markdown source");
  assert.equal(records.has("ja::valid-public"), false);
  assert.equal(records.has("en::valid-public"), true);
});

test("unexpected adapter failure is contextualized and fails fast", async () => {
  const context = {
    store: {
      keys: () => [][Symbol.iterator](),
      delete: () => false,
      set: () => undefined,
    },
    parseData: async ({ id, data }: { id: string; data: unknown }) => {
      if (id === "ja::valid-public") throw new TypeError("adapter bug");
      return data;
    },
    renderMarkdown: async () => ({ metadata: { imagePaths: [] } }),
    generateDigest: (value: string) => value,
    config: { root: new URL(`file://${process.cwd()}/`) },
  };

  await assert.rejects(
    synchronizeJournalStore(context as never, fixtures),
    (error: unknown) => {
      assert.ok(error instanceof JournalAdapterFailure);
      assert.equal(error.contentId, "valid-public");
      assert.equal(error.locale, "ja");
      assert.equal(error.stage, "parseData");
      assert.match(error.message, /TypeError: adapter bug/);
      return true;
    },
  );
});

test("Production facade and Route Registry cover all consumer integration paths", async () => {
  const units = await loadJournalRepository(fixtures);
  const entries = entriesFromUnits(units);
  const production = createJournalProductionFacade(
    createJournalReadModel(entries, units),
  );
  const index = production.forIndex("ja").map((entry) => ({
    title: entry.data.title,
    href: journalRouteRegistry.build({
      collection: "journal",
      contentId: entry.data.contentId,
      locale: "ja",
    }),
  }));
  const detail = production
    .forDetail("ja")
    .find((entry) => entry.data.contentId === "valid-public");
  const home = production.forHomeStories("ja").slice(0, 6);
  const news = production.forNewsIntegration("ja");
  const parsedReference = journalRouteRegistry.parse(index[0].href);
  const referenced =
    parsedReference &&
    findJournalEntry(
      production.forNewsIntegration(parsedReference.locale),
      parsedReference.locale,
      parsedReference.contentId,
    );
  assert.ok(index.length && detail && home.length && news.length && referenced);
  assert.equal(
    referenced?.data.hero.image,
    "/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
  );
});
