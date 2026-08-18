import type {
  JournalReadModel,
  JournalReadModelEntry,
  JournalReadModelIssue,
} from "../content-services/journal-read-model.ts";

export type JournalLocale = "ja" | "en";
export type JournalVisibility = "public" | "hidden";

export type JournalIndexData = {
  contentId: string;
  locale: JournalLocale;
  visibility: JournalVisibility;
  date: string;
};

export type JournalIndexEntry = JournalReadModelEntry;
export type JournalIndexIssue = JournalReadModelIssue;

export type JournalSurface =
  "index" | "detail" | "home-stories" | "news-integration";

export type { JournalReadModel };

export type JournalProductionFacade<T extends JournalIndexEntry> = {
  forIndex(locale: JournalLocale): T[];
  forDetail(locale: JournalLocale): T[];
  forHomeStories(locale: JournalLocale): T[];
  forNewsIntegration(locale: JournalLocale): T[];
};

export type JournalRenderDecision<T extends JournalIndexEntry> =
  | { kind: "render"; entry: T }
  | { kind: "exclude"; reason: "hidden" | "not-renderable" }
  | { kind: "unavailable"; reason: "hidden" };

export type JournalContentReference = {
  collection: "journal";
  contentId: string;
  locale: JournalLocale;
};

const JOURNAL_CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const journalRouteRegistry = {
  build(reference: JournalContentReference): string {
    if (!JOURNAL_CONTENT_ID.test(reference.contentId)) {
      throw new Error("Invalid Journal Content ID.");
    }

    return reference.locale === "ja"
      ? `/journal/${reference.contentId}/`
      : `/en/journal/${reference.contentId}/`;
  },

  parse(pathname: string): JournalContentReference | undefined {
    const match = pathname.match(
      /^\/(en\/)?journal\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/)?$/,
    );
    if (!match) return undefined;

    return {
      collection: "journal",
      contentId: match[2],
      locale: match[1] ? "en" : "ja",
    };
  },

  params(reference: JournalContentReference): { slug: string } {
    this.build(reference);
    return { slug: reference.contentId };
  },
};

export function queryJournalEntries<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
): T[] {
  return entries
    .filter((entry) => entry.data.locale === locale)
    .sort(
      (a, b) =>
        b.data.date.localeCompare(a.data.date) ||
        a.data.contentId.localeCompare(b.data.contentId),
    );
}

export function findJournalEntry<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
  contentId: string,
): T | undefined {
  return queryJournalEntries(entries, locale).find(
    (entry) => entry.data.contentId === contentId,
  );
}

function isJournalRenderable(
  entry: JournalIndexEntry,
  issues: JournalIndexIssue[],
): boolean {
  return !issues.some(
    (issue) =>
      issue.severity === "error" &&
      (issue.locale === entry.data.locale || issue.locale === undefined),
  );
}

function decideJournalSurface<T extends JournalIndexEntry>(
  entry: T,
  issues: JournalIndexIssue[],
  surface: JournalSurface,
): JournalRenderDecision<T> {
  if (!isJournalRenderable(entry, issues)) {
    return { kind: "exclude", reason: "not-renderable" };
  }
  if (entry.data.visibility === "hidden") {
    return surface === "detail"
      ? { kind: "unavailable", reason: "hidden" }
      : { kind: "exclude", reason: "hidden" };
  }
  return { kind: "render", entry };
}

function selectJournalForSurface<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
  surface: JournalSurface,
  issuesByContentId: ReadonlyMap<string, JournalIndexIssue[]>,
): T[] {
  return queryJournalEntries(entries, locale).filter((entry) => {
    const issues = issuesByContentId.get(entry.data.contentId);
    if (!issues) {
      throw new Error(
        `Missing Journal issues for Content ID: ${entry.data.contentId}`,
      );
    }
    return decideJournalSurface(entry, issues, surface).kind === "render";
  });
}

export function createJournalProductionFacade<T extends JournalIndexEntry>(
  readModel: JournalReadModel<T>,
): JournalProductionFacade<T> {
  const select = (locale: JournalLocale, surface: JournalSurface) =>
    selectJournalForSurface(
      readModel.entries,
      locale,
      surface,
      readModel.issuesByContentId,
    );

  return {
    forIndex: (locale) => select(locale, "index"),
    forDetail: (locale) => select(locale, "detail"),
    forHomeStories: (locale) => select(locale, "home-stories"),
    forNewsIntegration: (locale) => select(locale, "news-integration"),
  };
}
