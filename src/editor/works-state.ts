import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import { editorWorkSchema, type WorkData } from "../content-schemas/work.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";
import { isContentId } from "./content-id.ts";

export type WorksEditorEntryState = {
  contentId: string;
  file: string;
  raw: string;
  data?: WorkData;
  body: string;
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};

export class WorksEditorEntryNotFoundError extends Error {
  constructor(contentId: string) {
    super(`Works Editor entry not found: ${contentId}`);
    this.name = "WorksEditorEntryNotFoundError";
  }
}

const canonicalWorksRoot = path.resolve("src/content/works");

function issue(
  contentId: string,
  fieldPath: string,
  message: string,
): ContentIssue {
  return {
    ruleId: "content.work.structure",
    severity: "error",
    category: "structure",
    collection: "works",
    contentId,
    fieldPath,
    messageKey: message,
    recovery: { kind: "edit-field", fieldPath },
  };
}

function parseSource(
  contentId: string,
  file: string,
  raw: string,
): WorksEditorEntryState {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) {
    const issues = [
      issue(contentId, "frontmatter", "content.work.frontmatter.invalid"),
    ];
    return {
      contentId,
      file,
      raw,
      body: "",
      issues,
      structuralStatus: "issues",
      issueCount: issues.length,
    };
  }
  try {
    const parsed = editorWorkSchema.safeParse(parse(match[1]));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((item) =>
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
    }
    return {
      contentId,
      file,
      raw,
      data: parsed.data,
      body: match[2].trim(),
      issues: [],
      structuralStatus: "valid",
      issueCount: 0,
    };
  } catch {
    const issues = [
      issue(contentId, "frontmatter", "content.work.frontmatter.invalid"),
    ];
    return {
      contentId,
      file,
      raw,
      body: match[2].trim(),
      issues,
      structuralStatus: "issues",
      issueCount: issues.length,
    };
  }
}

async function readEntries(root: string): Promise<WorksEditorEntryState[]> {
  const names = (await readdir(root))
    .filter((name) => name.endsWith(".md"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const contentId = name.slice(0, -3);
      const file = path.join(root, name);
      return parseSource(contentId, file, await readFile(file, "utf8"));
    }),
  );
}

export async function readWorksEditorState(
  root = canonicalWorksRoot,
): Promise<EditorCollectionState> {
  const entries = await readEntries(root);
  return {
    entries: entries.map((entry) => ({
      contentId: entry.contentId,
      title: entry.data?.title ?? entry.contentId,
      detail: entry.data
        ? `Artist ${entry.data.artist.id}`
        : "Invalid Work data",
      status: entry.structuralStatus,
      statusLabel:
        entry.issueCount === 0 ? "Ready" : `${entry.issueCount} issues`,
    })),
  };
}

export async function readWorksEditorEntry(
  contentId: string,
  root = canonicalWorksRoot,
): Promise<WorksEditorEntryState> {
  if (!isContentId(contentId))
    throw new WorksEditorEntryNotFoundError(contentId);
  const entry = (await readEntries(root)).find(
    (candidate) => candidate.contentId === contentId,
  );
  if (!entry) throw new WorksEditorEntryNotFoundError(contentId);
  return entry;
}
