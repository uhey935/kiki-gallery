export type JournalLocale = "ja" | "en";
export type JournalVisibility = "public" | "hidden";

export type JournalIndexData = {
  contentId: string;
  locale: JournalLocale;
  visibility: JournalVisibility;
  date: string;
};

export type JournalIndexEntry = {
  data: JournalIndexData;
};

export type JournalIndexIssue = {
  severity: "error" | "warning" | "info";
  locale?: JournalLocale;
};

export type JournalSurface =
  | "index"
  | "detail"
  | "home-stories"
  | "news-integration";

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
      ? `/journal/${reference.contentId}`
      : `/en/journal/${reference.contentId}`;
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

export function isJournalRenderable(
  entry: JournalIndexEntry,
  issues: JournalIndexIssue[],
): boolean {
  return !issues.some(
    (issue) =>
      issue.severity === "error" &&
      (issue.locale === entry.data.locale || issue.locale === undefined),
  );
}

export function decideJournalSurface<T extends JournalIndexEntry>(
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
  return queryJournalEntries(entries, locale).filter(
    (entry) =>
      decideJournalSurface(
        entry,
        issuesByContentId.get(entry.data.contentId) ?? [],
        surface,
      ).kind === "render",
  );
}

export function selectJournalIndexEntries<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
  issuesByContentId: ReadonlyMap<string, JournalIndexIssue[]> = new Map(),
): T[] {
  return selectJournalForSurface(entries, locale, "index", issuesByContentId);
}

export function selectJournalDetailEntries<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
  issuesByContentId: ReadonlyMap<string, JournalIndexIssue[]> = new Map(),
): T[] {
  return selectJournalForSurface(entries, locale, "detail", issuesByContentId);
}

export function selectJournalHomeStoryEntries<T extends JournalIndexEntry>(
  entries: T[],
  locale: JournalLocale,
  issuesByContentId: ReadonlyMap<string, JournalIndexIssue[]> = new Map(),
): T[] {
  return selectJournalForSurface(
    entries,
    locale,
    "home-stories",
    issuesByContentId,
  );
}

export function selectJournalNewsIntegrationEntries<
  T extends JournalIndexEntry,
>(
  entries: T[],
  locale: JournalLocale,
  issuesByContentId: ReadonlyMap<string, JournalIndexIssue[]> = new Map(),
): T[] {
  return selectJournalForSurface(
    entries,
    locale,
    "news-integration",
    issuesByContentId,
  );
}
