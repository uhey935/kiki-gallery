import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import { loadNewsUnit } from "../content-loaders/news/repository.ts";
import type {
  NewsLocale,
  NewsLocalized,
  NewsShared,
} from "../content-loaders/news/contracts.ts";
import { newsSchema, type NewsData } from "../content-schemas/news.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";
import { isContentId } from "./content-id.ts";

export type NewsEditorLocaleState = NewsLocalized & { body: string };

export type NewsEditorEntryState = {
  contentId: string;
  file: string;
  raw: string;
  canonicalFiles?: { "index.yaml": string; "ja.md": string; "en.md": string };
  shared?: NewsShared;
  locales: Partial<Record<NewsLocale, NewsEditorLocaleState>>;
  /** Temporary JA compatibility view for the existing flat News Editor UI. */
  data?: NewsData;
  body: string;
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};

export class NewsEditorEntryNotFoundError extends Error {}

const canonicalRoot = path.resolve("src/content/news");
async function readThreeFileEntry(contentId: string, root: string) {
  const directory = path.join(root, contentId);
  const unit = await loadNewsUnit(directory);
  const shared = unit.shared.state === "valid" ? unit.shared.value : undefined;
  const locales: NewsEditorEntryState["locales"] = {};
  for (const locale of ["ja", "en"] as const) {
    const source = unit.locales[locale];
    if (source.state === "valid") locales[locale] = source.value;
  }
  const ja = locales.ja;
  const data =
    shared && ja
      ? newsSchema.safeParse({
          ...shared,
          title: ja.title,
          ...(ja.summary === undefined ? {} : { summary: ja.summary }),
        })
      : undefined;
  const issues = unit.issues as ContentIssue[];
  const structuralIssues = issues.filter((item) =>
    ["parse", "structure", "unit-integrity", "repository-integrity"].includes(
      item.category,
    ),
  );
  return {
    contentId,
    file: directory,
    raw: unit.shared.state === "missing" ? "" : unit.shared.raw,
    ...(unit.shared.state !== "missing" &&
    unit.locales.ja.state !== "missing" &&
    unit.locales.en.state !== "missing"
      ? {
          canonicalFiles: {
            "index.yaml": unit.shared.raw,
            "ja.md": unit.locales.ja.raw,
            "en.md": unit.locales.en.raw,
          },
        }
      : {}),
    shared,
    locales,
    data: data?.success ? data.data : undefined,
    body: ja?.body.trim() ?? "",
    issues,
    structuralStatus: structuralIssues.length
      ? ("issues" as const)
      : ("valid" as const),
    issueCount: issues.length,
  };
}

async function readEntries(root: string): Promise<NewsEditorEntryState[]> {
  const directoryEntries = await readdir(root, { withFileTypes: true });
  const contentIds = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    contentIds.map((contentId) => readThreeFileEntry(contentId, root)),
  );
}

export async function readNewsEditorState(
  root = canonicalRoot,
): Promise<EditorCollectionState> {
  return {
    entries: (await readEntries(root)).map((entry) => ({
      contentId: entry.contentId,
      title: entry.locales.ja?.title ?? entry.contentId,
      detail: entry.shared
        ? `${entry.shared.date} · ${entry.shared.news_type}`
        : "Invalid News data",
      status: entry.issueCount ? "issues" : entry.structuralStatus,
      statusLabel: entry.issueCount ? `${entry.issueCount} issues` : "Ready",
    })),
  };
}

export async function readNewsEditorEntry(
  contentId: string,
  root = canonicalRoot,
) {
  if (!isContentId(contentId))
    throw new NewsEditorEntryNotFoundError(contentId);
  const entries = await readdir(root, { withFileTypes: true });
  const directory = entries.find(
    (entry) => entry.name === contentId && entry.isDirectory(),
  );
  if (directory) return readThreeFileEntry(contentId, root);
  throw new NewsEditorEntryNotFoundError(contentId);
}
