import type {
  NewsReadModel,
  NewsReadModelEntry,
  NewsReadModelIssue,
} from "../content-services/news-read-model.ts";

export type NewsLocale = "ja" | "en";
export type NewsProductionEntry = NewsReadModelEntry;
export type NewsProductionIssue = NewsReadModelIssue;
export type { NewsReadModel };

export type NewsProductionFacade<T extends NewsProductionEntry> = {
  forIndex(locale: NewsLocale): T[];
  forHome(locale: NewsLocale): T[];
};

export function queryNewsEntries<T extends NewsProductionEntry>(
  entries: T[],
  locale: NewsLocale,
): T[] {
  return entries
    .filter((entry) => entry.data.locale === locale)
    .sort(
      (a, b) =>
        b.data.date.localeCompare(a.data.date) ||
        a.data.contentId.localeCompare(b.data.contentId),
    );
}

function isNewsRenderable(
  entry: NewsProductionEntry,
  issues: NewsProductionIssue[],
): boolean {
  return !issues.some(
    (issue) =>
      issue.severity === "error" &&
      (issue.locale === entry.data.locale || issue.locale === undefined),
  );
}

function selectNews<T extends NewsProductionEntry>(
  readModel: NewsReadModel<T>,
  locale: NewsLocale,
  homeOnly: boolean,
): T[] {
  return queryNewsEntries(readModel.entries, locale).filter((entry) => {
    const issues = readModel.issuesByContentId.get(entry.data.contentId);
    if (!issues) {
      throw new Error(
        `Missing News issues for Content ID: ${entry.data.contentId}`,
      );
    }
    return (
      isNewsRenderable(entry, issues) &&
      (!homeOnly || (entry.data.show_on_home && entry.data.link !== undefined))
    );
  });
}

export function createNewsProductionFacade<T extends NewsProductionEntry>(
  readModel: NewsReadModel<T>,
): NewsProductionFacade<T> {
  return {
    forIndex: (locale) => selectNews(readModel, locale, false),
    forHome: (locale) => selectNews(readModel, locale, true),
  };
}
