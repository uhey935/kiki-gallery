import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decideJournalSurface,
  entriesFromUnits,
  evaluateJournalCapabilities,
  findJournalEntry,
  journalRouteRegistry,
  loadJournalRepository,
  queryJournalEntries,
  selectJournalForSurface,
  synchronizeEntryMap,
} from "./repository.ts";
import { synchronizeJournalStore } from "./astro-loader.ts";

const fixtures = path.resolve("src/content-loaders/journal/fixtures");

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

test("production fixtures report broken shared data without creating stale entries", async () => {
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

test("Site Content Service owns all four Journal surface decisions", async () => {
  const units = await loadJournalRepository(fixtures);
  const entries = entriesFromUnits(units);
  for (const surface of [
    "index",
    "home-stories",
    "news-integration",
  ] as const) {
    assert.deepEqual(
      selectJournalForSurface(entries, units, "en", surface).map(
        (entry) => entry.data.contentId,
      ),
      ["valid-public"],
    );
  }
  const hidden = findJournalEntry(entries, "ja", "hidden")!;
  const hiddenUnit = units.find((unit) => unit.contentId === "hidden")!;
  assert.deepEqual(decideJournalSurface(hidden, hiddenUnit.issues, "detail"), {
    kind: "unavailable",
    reason: "hidden",
  });
});

test("Route Registry normalizes generated routes and accepts either trailing-slash input", () => {
  const ja = {
    collection: "journal",
    contentId: "valid-public",
    locale: "ja",
  } as const;
  const en = { ...ja, locale: "en" } as const;
  assert.equal(journalRouteRegistry.build(ja), "/journal/valid-public");
  assert.equal(journalRouteRegistry.build(en), "/en/journal/valid-public");
  assert.deepEqual(journalRouteRegistry.parse("/en/journal/valid-public/"), en);
  assert.deepEqual(journalRouteRegistry.parse("/journal/valid-public"), ja);
  assert.equal(journalRouteRegistry.parse("/news/valid-public/"), undefined);
});

test("full-set synchronization removes delete, rename, and valid-to-invalid stale entries", async () => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "kiki-journal-prototype-"),
  );
  try {
    await fs.cp(fixtures, temporaryRoot, { recursive: true });
    const store = new Map();
    synchronizeEntryMap(store, await loadJournalRepository(temporaryRoot));
    assert.ok(store.has("ja::valid-public"));
    await fs.rm(path.join(temporaryRoot, "valid-public"), { recursive: true });
    synchronizeEntryMap(store, await loadJournalRepository(temporaryRoot));
    assert.equal(store.has("ja::valid-public"), false);
    await fs.rename(
      path.join(temporaryRoot, "hidden"),
      path.join(temporaryRoot, "hidden-renamed"),
    );
    synchronizeEntryMap(store, await loadJournalRepository(temporaryRoot));
    assert.equal(store.has("ja::hidden"), false);
    assert.ok(store.has("ja::hidden-renamed"));
    await fs.writeFile(
      path.join(temporaryRoot, "missing-en", "index.yaml"),
      "date: [broken",
    );
    synchronizeEntryMap(store, await loadJournalRepository(temporaryRoot));
    assert.equal(store.has("ja::missing-en"), false);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
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

test("consumer harness can map Index, Detail, Home, News, and parsed News references", async () => {
  const units = await loadJournalRepository(fixtures);
  const entries = entriesFromUnits(units);
  const index = selectJournalForSurface(entries, units, "ja", "index").map(
    (entry) => ({
      title: entry.data.title,
      href: journalRouteRegistry.build({
        collection: "journal",
        contentId: entry.data.contentId,
        locale: "ja",
      }),
    }),
  );
  const detail = findJournalEntry(entries, "ja", "valid-public");
  const home = selectJournalForSurface(
    entries,
    units,
    "ja",
    "home-stories",
  ).slice(0, 6);
  const news = selectJournalForSurface(
    entries,
    units,
    "ja",
    "news-integration",
  );
  const parsedReference = journalRouteRegistry.parse(index[0].href);
  const referenced =
    parsedReference &&
    findJournalEntry(
      entries,
      parsedReference.locale,
      parsedReference.contentId,
    );
  assert.ok(index.length && detail && home.length && news.length && referenced);
  assert.equal(
    referenced?.data.hero.image,
    "/images/journal/interview-keisuke-matsuda-2026-02-1.jpg",
  );
});
