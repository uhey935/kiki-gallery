import type { JournalCategory } from "./schema.ts";

export const CANONICAL_JOURNAL_CONTENT_IDS = [
  "essay-keisuke-matsuda",
  "interview-keisuke-matsuda-2020-02",
  "interview-keisuke-matsuda-2020-03",
  "interview-keisuke-matsuda-2020-04",
  "interview-keisuke-matsuda-2020-06",
  "interview-keisuke-matsuda-2020-07",
  "interview-keisuke-matsuda-2020-09",
  "interview-keisuke-matsuda-2026-02",
  "report-yuka-mori-2025-07",
] as const;

const categories = new Set<JournalCategory>(["interview", "essay", "report"]);

export type JournalCategoryMigrationSource = {
  contentId: string;
  shared: Record<string, unknown>;
};

export type JournalCategoryMigrationPlan = {
  contentId: string;
  category: JournalCategory;
};

export function planCanonicalJournalCategoryMigration(
  sources: JournalCategoryMigrationSource[],
): JournalCategoryMigrationPlan[] {
  const expected = [...CANONICAL_JOURNAL_CONTENT_IDS].sort();
  const actual = sources.map(({ contentId }) => contentId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Journal category migration inventory is not exact");
  }

  return sources
    .sort((left, right) => left.contentId.localeCompare(right.contentId))
    .map(({ contentId, shared }) => {
      if (Object.hasOwn(shared, "category")) {
        throw new Error(`${contentId}: category already exists`);
      }
      if (!Object.hasOwn(shared, "categories")) {
        throw new Error(`${contentId}: categories is missing`);
      }
      const legacy = shared.categories;
      if (!Array.isArray(legacy) || legacy.length !== 1) {
        throw new Error(
          `${contentId}: categories must contain exactly one value`,
        );
      }
      const [category] = legacy;
      if (
        typeof category !== "string" ||
        !categories.has(category as JournalCategory)
      ) {
        throw new Error(`${contentId}: category is not allowed`);
      }
      return { contentId, category: category as JournalCategory };
    });
}
