import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import {
  CANONICAL_JOURNAL_CONTENT_IDS,
  planCanonicalJournalCategoryMigration,
  type JournalCategoryMigrationSource,
} from "./category-migration.ts";

const legacySources = (): JournalCategoryMigrationSource[] =>
  CANONICAL_JOURNAL_CONTENT_IDS.map((contentId) => ({
    contentId,
    shared: {
      categories: [
        contentId.startsWith("essay-")
          ? "essay"
          : contentId.startsWith("report-")
            ? "report"
            : "interview",
      ],
    },
  }));

test("category migration accepts only the exact audited single-value inventory", () => {
  const plan = planCanonicalJournalCategoryMigration(legacySources());
  assert.equal(plan.length, 9);
  assert.deepEqual(plan.map(({ category }) => category).sort(), [
    "essay",
    "interview",
    "interview",
    "interview",
    "interview",
    "interview",
    "interview",
    "interview",
    "report",
  ]);
});

test("category migration rejects multiple, unknown, migrated, and unexpected inventory", () => {
  for (const shared of [
    { categories: ["essay", "report"] },
    { categories: ["unknown"] },
    { categories: [] },
    { category: "essay", categories: ["essay"] },
    {},
  ]) {
    const sources = legacySources();
    sources[0] = { ...sources[0], shared };
    assert.throws(() => planCanonicalJournalCategoryMigration(sources));
  }
  assert.throws(() =>
    planCanonicalJournalCategoryMigration(legacySources().slice(1)),
  );
  assert.throws(() =>
    planCanonicalJournalCategoryMigration([
      ...legacySources(),
      { contentId: "unexpected-entry", shared: { categories: ["essay"] } },
    ]),
  );
});

test("canonical Journal inventory uses one current category field", async () => {
  const root = path.resolve("src/content/journal");
  const ids = (await fs.readdir(root)).sort();
  assert.deepEqual(ids, [...CANONICAL_JOURNAL_CONTENT_IDS].sort());
  for (const contentId of ids) {
    const shared = parse(
      await fs.readFile(path.join(root, contentId, "index.yaml"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(typeof shared.category, "string", contentId);
    assert.equal(Object.hasOwn(shared, "categories"), false, contentId);
  }
});
