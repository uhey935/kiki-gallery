import path from "node:path";
import type { JournalEntry, LoadedJournalUnit, Locale } from "./contracts.ts";
import { journalSchema } from "./schema.ts";

const LOCALES = ["ja", "en"] as const;

function journalEntryId(contentId: string, locale: Locale): string {
  return `${locale}::${contentId}`;
}

export function entriesFromUnits(units: LoadedJournalUnit[]): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const unit of units) {
    if (unit.shared.state !== "valid") continue;
    for (const locale of LOCALES) {
      const localized = unit.locales[locale];
      if (localized.state !== "valid") continue;
      const { body, ...data } = localized.value;
      const parsed = journalSchema.safeParse({
        ...unit.shared.value,
        ...data,
        contentId: unit.contentId,
        locale,
      });
      if (!parsed.success) continue;
      entries.push({
        id: journalEntryId(unit.contentId, locale),
        data: parsed.data,
        body,
        filePath: path.join(unit.directory, `${locale}.md`),
      });
    }
  }
  return entries;
}
