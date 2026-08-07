import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import {
  editorArtistSchema,
  type ArtistData,
} from "../content-schemas/artist.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";
import { isContentId } from "./content-id.ts";

export type ArtistsEditorEntryState = {
  contentId: string;
  file: string;
  raw: string;
  data?: ArtistData;
  body: string;
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};
export class ArtistsEditorEntryNotFoundError extends Error {}
const canonicalRoot = path.resolve("src/content/artists");
const issue = (
  contentId: string,
  fieldPath: string,
  messageKey: string,
): ContentIssue => ({
  ruleId: "content.artist.structure",
  severity: "error",
  category: "structure",
  collection: "artists",
  contentId,
  fieldPath,
  messageKey,
  recovery: { kind: "edit-field", fieldPath },
});

function parseSource(
  contentId: string,
  file: string,
  raw: string,
): ArtistsEditorEntryState {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) {
    const issues = [
      issue(contentId, "frontmatter", "content.artist.frontmatter.invalid"),
    ];
    return {
      contentId,
      file,
      raw,
      body: "",
      issues,
      structuralStatus: "issues",
      issueCount: 1,
    };
  }
  try {
    const result = editorArtistSchema.safeParse(parse(match[1]));
    if (result.success)
      return {
        contentId,
        file,
        raw,
        data: result.data,
        body: match[2].trim(),
        issues: [],
        structuralStatus: "valid",
        issueCount: 0,
      };
    const issues = result.error.issues.map((item) =>
      issue(contentId, item.path.join("."), item.message),
    );
    return {
      contentId,
      file,
      raw,
      body: match[2].trim(),
      issues,
      structuralStatus: "issues",
      issueCount: issues.length,
    };
  } catch {
    const issues = [
      issue(contentId, "frontmatter", "content.artist.frontmatter.invalid"),
    ];
    return {
      contentId,
      file,
      raw,
      body: match[2].trim(),
      issues,
      structuralStatus: "issues",
      issueCount: 1,
    };
  }
}
async function readEntries(root: string) {
  return Promise.all(
    (await readdir(root))
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map(async (name) => {
        const contentId = name.slice(0, -3);
        const file = path.join(root, name);
        return parseSource(contentId, file, await readFile(file, "utf8"));
      }),
  );
}
export async function readArtistsEditorState(
  root = canonicalRoot,
): Promise<EditorCollectionState> {
  return {
    entries: (await readEntries(root)).map((entry) => ({
      contentId: entry.contentId,
      title: entry.data?.display_name ?? entry.data?.name ?? entry.contentId,
      detail: entry.data
        ? `${entry.data.name} · ${entry.data.medium.join(" / ")}`
        : "Invalid Artist data",
      status: entry.structuralStatus,
      statusLabel: entry.issueCount ? `${entry.issueCount} issues` : "Ready",
    })),
  };
}
export async function readArtistsEditorEntry(
  contentId: string,
  root = canonicalRoot,
) {
  if (!isContentId(contentId))
    throw new ArtistsEditorEntryNotFoundError(contentId);
  const entry = (await readEntries(root)).find(
    (candidate) => candidate.contentId === contentId,
  );
  if (!entry) throw new ArtistsEditorEntryNotFoundError(contentId);
  return entry;
}
