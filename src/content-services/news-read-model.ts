import type {
  LoadedNewsUnit,
  NewsContentIssue,
} from "../content-loaders/news/contracts.ts";

export type NewsReadModelEntry = {
  id: string;
  data: {
    contentId: string;
    locale: "ja" | "en";
    title: string;
    summary?: string;
    date: string;
    news_type: "exhibition" | "artist" | "general";
    link?: string;
    show_on_home: boolean;
  };
};

export type NewsReadModelIssue = {
  severity: "error" | "warning" | "info";
  locale?: "ja" | "en";
};

export type NewsReadModel<T extends NewsReadModelEntry> = {
  entries: T[];
  issuesByContentId: ReadonlyMap<string, NewsReadModelIssue[]>;
};

export function createNewsReadModel<T extends NewsReadModelEntry>(
  entries: T[],
  units: LoadedNewsUnit[],
  additionalIssues: ReadonlyMap<
    string,
    readonly NewsContentIssue[]
  > = new Map(),
): NewsReadModel<T> {
  const unitIds = new Set(units.map((unit) => unit.contentId));
  for (const contentId of additionalIssues.keys()) {
    if (!unitIds.has(contentId)) {
      throw new Error(`News Issue owner has no repository unit: ${contentId}`);
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
