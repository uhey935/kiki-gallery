import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import { homeSchema, type HomeData } from "../content-schemas/home.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";

export const HOME_CONTENT_ID = "home";
export type HomeEditorEntryState = {
  contentId: typeof HOME_CONTENT_ID;
  file: string;
  raw: string;
  data?: HomeData;
  body: string;
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};
export class HomeEditorEntryNotFoundError extends Error {}
const canonicalRoot = path.resolve("src/content/home");
const issue = (fieldPath: string, messageKey: string): ContentIssue => ({
  ruleId: "content.home.structure",
  severity: "error",
  category: "structure",
  collection: "home",
  contentId: HOME_CONTENT_ID,
  fieldPath,
  messageKey,
  recovery: { kind: "edit-field", fieldPath },
});

export async function readHomeEditorEntry(
  root = canonicalRoot,
): Promise<HomeEditorEntryState> {
  const names = (await readdir(root)).filter((name) => name.endsWith(".md"));
  if (names.length !== 1 || names[0] !== `${HOME_CONTENT_ID}.md`)
    throw new HomeEditorEntryNotFoundError(
      "Home must be exactly src/content/home/home.md",
    );
  const file = path.join(root, names[0]);
  const raw = await readFile(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match)
    return {
      contentId: HOME_CONTENT_ID,
      file,
      raw,
      body: "",
      issues: [issue("frontmatter", "content.home.frontmatter.invalid")],
      structuralStatus: "issues",
      issueCount: 1,
    };
  try {
    const result = homeSchema.safeParse(parse(match[1]));
    if (result.success)
      return {
        contentId: HOME_CONTENT_ID,
        file,
        raw,
        data: result.data,
        body: match[2].trim(),
        issues: [],
        structuralStatus: "valid",
        issueCount: 0,
      };
    const issues = result.error.issues.map((item) =>
      issue(item.path.join("."), item.message),
    );
    return {
      contentId: HOME_CONTENT_ID,
      file,
      raw,
      body: match[2].trim(),
      issues,
      structuralStatus: "issues",
      issueCount: issues.length,
    };
  } catch {
    return {
      contentId: HOME_CONTENT_ID,
      file,
      raw,
      body: match[2].trim(),
      issues: [issue("frontmatter", "content.home.frontmatter.invalid")],
      structuralStatus: "issues",
      issueCount: 1,
    };
  }
}

export async function readHomeEditorState(
  root = canonicalRoot,
): Promise<EditorCollectionState> {
  const entry = await readHomeEditorEntry(root);
  return {
    entries: [
      {
        contentId: HOME_CONTENT_ID,
        title: entry.data?.title ?? "Home",
        detail: "Singleton · nested responsive media",
        status: entry.structuralStatus,
        statusLabel: entry.issueCount ? `${entry.issueCount} issues` : "Ready",
      },
    ],
  };
}
