import path from "node:path";
import type { LoadedNewsUnit, NewsEntry, NewsLocale } from "./contracts.ts";
import { NEWS_LOCALES, newsEntrySchema } from "./schema.ts";

function newsEntryId(contentId: string, locale: NewsLocale): string {
  return `${locale}::${contentId}`;
}

export function newsEntriesFromUnits(units: LoadedNewsUnit[]): NewsEntry[] {
  const entries: NewsEntry[] = [];
  for (const unit of units) {
    if (unit.shared.state !== "valid") continue;
    for (const locale of NEWS_LOCALES) {
      const localized = unit.locales[locale];
      if (localized.state !== "valid") continue;
      const { body, ...data } = localized.value;
      const parsed = newsEntrySchema.safeParse({
        ...unit.shared.value,
        ...data,
        contentId: unit.contentId,
        locale,
      });
      if (!parsed.success) continue;
      entries.push({
        id: newsEntryId(unit.contentId, locale),
        data: parsed.data,
        body,
        filePath: path.join(unit.directory, `${locale}.md`),
      });
    }
  }
  return entries;
}
