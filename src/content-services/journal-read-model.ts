import type {
  ContentIssue,
  LoadedJournalUnit,
} from "../content-loaders/journal/contracts.ts";

export type JournalReadModelEntry = {
  data: {
    contentId: string;
    locale: "ja" | "en";
    visibility: "public" | "hidden";
    date: string;
  };
};

export type JournalReadModelIssue = {
  severity: "error" | "warning" | "info";
  locale?: "ja" | "en";
};

export type JournalReadModel<T extends JournalReadModelEntry> = {
  entries: T[];
  issuesByContentId: ReadonlyMap<string, JournalReadModelIssue[]>;
};

export function createJournalReadModel<T extends JournalReadModelEntry>(
  entries: T[],
  units: LoadedJournalUnit[],
  additionalIssues: ReadonlyMap<string, readonly ContentIssue[]> = new Map(),
): JournalReadModel<T> {
  const unitIds = new Set(units.map((unit) => unit.contentId));
  for (const contentId of additionalIssues.keys()) {
    if (!unitIds.has(contentId)) {
      throw new Error(
        `Journal Issue owner has no repository unit: ${contentId}`,
      );
    }
  }
  return {
    entries,
    issuesByContentId: new Map(
      units.map((unit) => [
        unit.contentId,
        [...unit.issues, ...(additionalIssues.get(unit.contentId) ?? [])],
      ]),
    ),
  };
}
