import assert from "node:assert/strict";
import test from "node:test";
import {
  findJournalEntry,
  journalRouteRegistry,
  selectJournalDetailEntries,
  selectJournalHomeStoryEntries,
  selectJournalIndexEntries,
  selectJournalNewsIntegrationEntries,
} from "./journal.ts";
import { resolveNewsImage } from "../utils/resolveNewsImage.ts";

test("production query consumes native canonical locale entries", () => {
  const entries = [
    { id: "opaque-ja-zeta", data: { contentId: "zeta", locale: "ja" as const, visibility: "public" as const, date: "2026-01-01" } },
    { id: "opaque-ja-alpha", data: { contentId: "alpha", locale: "ja" as const, visibility: "public" as const, date: "2026-01-01" } },
    { id: "opaque-ja-newest", data: { contentId: "newest", locale: "ja" as const, visibility: "public" as const, date: "2026-02-01" } },
    { id: "opaque-en-newest", data: { contentId: "newest", locale: "en" as const, visibility: "public" as const, date: "2026-02-01" } },
  ];

  assert.deepEqual(
    selectJournalIndexEntries(entries, "ja").map(
      (entry) => entry.data.contentId,
    ),
    ["newest", "alpha", "zeta"],
  );
  assert.deepEqual(selectJournalIndexEntries(entries, "en").map((entry) => entry.id), ["opaque-en-newest"]);
});

test("Journal Index excludes hidden and non-renderable locale states", () => {
  const entries = [
    {
      data: {
        contentId: "public",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
      },
    },
    {
      data: {
        contentId: "hidden",
        locale: "ja" as const,
        visibility: "hidden" as const,
        date: "2026-03-01",
      },
    },
    {
      data: {
        contentId: "placeholder",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-02-01",
      },
    },
    {
      data: {
        contentId: "english",
        locale: "en" as const,
        visibility: "public" as const,
        date: "2026-05-01",
      },
    },
  ];
  const issues = new Map([
    ["placeholder", [{ severity: "error" as const, locale: "ja" as const }]],
  ]);

  assert.deepEqual(
    selectJournalIndexEntries(entries, "ja", issues).map(
      (entry) => entry.data.contentId,
    ),
    ["public"],
  );
});

test("Journal Detail enumerates only public renderable JA Content IDs", () => {
  const entries = [
    {
      id: "opaque-store-key-for-public",
      data: {
        contentId: "public-entry",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
      },
    },
    {
      id: "opaque-store-key-for-hidden",
      data: {
        contentId: "hidden-entry",
        locale: "ja" as const,
        visibility: "hidden" as const,
        date: "2026-03-01",
      },
    },
    {
      id: "opaque-store-key-for-blocked",
      data: {
        contentId: "blocked-entry",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-02-01",
      },
    },
    {
      id: "opaque-store-key-for-english",
      data: {
        contentId: "english-entry",
        locale: "en" as const,
        visibility: "public" as const,
        date: "2026-05-01",
      },
    },
  ];
  const issues = new Map([
    ["blocked-entry", [{ severity: "error" as const, locale: "ja" as const }]],
  ]);

  assert.deepEqual(
    selectJournalDetailEntries(entries, "ja", issues).map(
      (entry) => entry.data.contentId,
    ),
    ["public-entry"],
  );
});

test("Home Stories selects public renderable JA entries in stable query order", () => {
  const entries = [
    {
      data: {
        contentId: "zeta",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
      },
    },
    {
      data: {
        contentId: "alpha",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
      },
    },
    {
      data: {
        contentId: "hidden",
        locale: "ja" as const,
        visibility: "hidden" as const,
        date: "2026-05-01",
      },
    },
    {
      data: {
        contentId: "blocked",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-06-01",
      },
    },
    {
      data: {
        contentId: "english",
        locale: "en" as const,
        visibility: "public" as const,
        date: "2026-07-01",
      },
    },
  ];
  const issues = new Map([
    ["blocked", [{ severity: "error" as const, locale: "ja" as const }]],
  ]);

  assert.deepEqual(
    selectJournalHomeStoryEntries(entries, "ja", issues).map(
      (entry) => entry.data.contentId,
    ),
    ["alpha", "zeta"],
  );
});

test("News integration excludes hidden, EN, and unrenderable Journal entries", () => {
  const entries = [
    {
      data: {
        contentId: "public",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
      },
    },
    {
      data: {
        contentId: "hidden",
        locale: "ja" as const,
        visibility: "hidden" as const,
        date: "2026-05-01",
      },
    },
    {
      data: {
        contentId: "english",
        locale: "en" as const,
        visibility: "public" as const,
        date: "2026-06-01",
      },
    },
    {
      data: {
        contentId: "placeholder",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-07-01",
      },
    },
  ];
  const issues = new Map([
    ["placeholder", [{ severity: "error" as const, locale: "ja" as const }]],
  ]);

  assert.deepEqual(
    selectJournalNewsIntegrationEntries(entries, "ja", issues).map(
      (entry) => entry.data.contentId,
    ),
    ["public"],
  );
});

test("News image resolution parses an internal Journal route and resolves locale plus Content ID", () => {
  const journal = [
    {
      id: "opaque-store-entry-id",
      data: {
        contentId: "public-entry",
        locale: "ja" as const,
        visibility: "public" as const,
        date: "2026-04-01",
        hero: { image: "/images/journal/public.jpg" },
        hero_alt: "Public hero",
      },
    },
  ];
  const news = {
    id: "linked-news",
    data: { link: "/journal/public-entry/" },
  };

  assert.equal(
    findJournalEntry(journal, "ja", "opaque-store-entry-id"),
    undefined,
  );
  assert.deepEqual(
    resolveNewsImage(news as never, {
      exhibitions: new Map(),
      artists: new Map(),
      journal,
    }),
    { image: "/images/journal/public.jpg", alt: "Public hero" },
  );
});

test("Journal Route Registry uses Content ID and locale, not Entry ID", () => {
  const reference = {
    collection: "journal" as const,
    contentId: "public-entry",
    locale: "ja" as const,
  };

  assert.equal(journalRouteRegistry.build(reference), "/journal/public-entry");
  assert.deepEqual(journalRouteRegistry.params(reference), {
    slug: "public-entry",
  });
  assert.deepEqual(
    journalRouteRegistry.parse("/journal/public-entry/"),
    reference,
  );
  assert.equal(journalRouteRegistry.parse("/news/public-entry"), undefined);
  assert.throws(() =>
    journalRouteRegistry.build({ ...reference, contentId: "opaque::entry" }),
  );
});
