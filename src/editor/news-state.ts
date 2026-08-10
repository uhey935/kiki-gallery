import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
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
  sourceModel: "legacy" | "three-file";
  file: string;
  raw: string;
  shared?: NewsShared;
  locales: Partial<Record<NewsLocale, NewsEditorLocaleState>>;
  /** Temporary JA compatibility view for the existing flat News Editor UI. */
  data?: NewsData;
  body: string;
  legacy?: {
    file: string;
    raw: string;
    body: string;
    data?: NewsData;
  };
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};

export class NewsEditorEntryNotFoundError extends Error {}

const canonicalRoot = path.resolve("src/content/news");
const issue = (
  contentId: string,
  fieldPath: string,
  messageKey: string,
): ContentIssue => ({
  ruleId: "content.news.structure",
  severity: "error",
  category: "structure",
  collection: "news",
  contentId,
  fieldPath,
  messageKey,
  recovery: { kind: "edit-field", fieldPath },
});

function parseLegacySource(
  contentId: string,
  file: string,
  raw: string,
): NewsEditorEntryState {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) {
    const issues = [
      issue(contentId, "frontmatter", "content.news.frontmatter.invalid"),
    ];
    return {
      contentId,
      sourceModel: "legacy",
      file,
      raw,
      locales: {},
      body: "",
      issues,
      structuralStatus: "issues",
      issueCount: 1,
    };
  }
  try {
    const result = newsSchema.safeParse(parse(match[1]));
    const body = match[2].trim();
    if (result.success) {
      const shared: NewsShared = {
        date: result.data.date,
        news_type: result.data.news_type,
        ...(result.data.link === undefined ? {} : { link: result.data.link }),
        show_on_home: result.data.show_on_home,
      };
      const ja: NewsEditorLocaleState = {
        title: result.data.title,
        ...(result.data.summary === undefined
          ? {}
          : { summary: result.data.summary }),
        body,
      };
      return {
        contentId,
        sourceModel: "legacy",
        file,
        raw,
        shared,
        locales: { ja },
        data: result.data,
        body,
        legacy: { file, raw, body, data: result.data },
        issues: [],
        structuralStatus: "valid",
        issueCount: 0,
      };
    }
    const issues = result.error.issues.map((item) =>
      issue(contentId, item.path.join("."), item.message),
    );
    return {
      contentId,
      sourceModel: "legacy",
      file,
      raw,
      locales: {},
      body,
      legacy: { file, raw, body },
      issues,
      structuralStatus: "issues",
      issueCount: issues.length,
    };
  } catch {
    const issues = [
      issue(contentId, "frontmatter", "content.news.frontmatter.invalid"),
    ];
    return {
      contentId,
      sourceModel: "legacy",
      file,
      raw,
      locales: {},
      body: match[2].trim(),
      legacy: { file, raw, body: match[2].trim() },
      issues,
      structuralStatus: "issues",
      issueCount: 1,
    };
  }
}

async function readLegacyEntry(contentId: string, root: string) {
  const file = path.join(root, `${contentId}.md`);
  try {
    return parseLegacySource(contentId, file, await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

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
  const legacy = await readLegacyEntry(contentId, root);
  return {
    contentId,
    sourceModel: "three-file" as const,
    file: directory,
    raw: unit.shared.state === "missing" ? "" : unit.shared.raw,
    shared,
    locales,
    data: data?.success ? data.data : undefined,
    body: ja?.body.trim() ?? "",
    ...(legacy
      ? {
          legacy: {
            file: legacy.file,
            raw: legacy.raw,
            body: legacy.body,
            data: legacy.data,
          },
        }
      : {}),
    issues,
    structuralStatus: structuralIssues.length
      ? ("issues" as const)
      : ("valid" as const),
    issueCount: issues.length,
  };
}

async function readEntries(root: string): Promise<NewsEditorEntryState[]> {
  const directoryEntries = await readdir(root, { withFileTypes: true });
  const directoryIds = new Set(
    directoryEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const legacyIds = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3));
  const contentIds = [...new Set([...directoryIds, ...legacyIds])].sort();
  return Promise.all(
    contentIds.map(async (contentId) =>
      directoryIds.has(contentId)
        ? readThreeFileEntry(contentId, root)
        : (await readLegacyEntry(contentId, root))!,
    ),
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
  const legacy = await readLegacyEntry(contentId, root);
  if (!legacy) throw new NewsEditorEntryNotFoundError(contentId);
  return legacy;
}
