import { readdir } from "node:fs/promises";
import path from "node:path";

import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { WorkData } from "../content-schemas/work.ts";
import { loadWorkUnit } from "../content-loaders/works/repository.ts";
import type { WorkLocalized } from "../content-loaders/works/schema.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";
import { isContentId } from "./content-id.ts";

export type WorksEditorEntryState = {
  contentId: string;
  file: string;
  raw: string;
  rawFiles: { shared: string; ja: string; en: string };
  data?: WorkData;
  localized?: {
    ja: WorkLocalized & { body: string };
    en: WorkLocalized & { body: string };
  };
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

async function readEntries(root: string): Promise<WorksEditorEntryState[]> {
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const directory = path.join(root, name);
      const unit = await loadWorkUnit(directory);
      const structuralStatus = unit.issues.some((item) => item.locale !== "en")
        ? "issues"
        : "valid";
      const issues = unit.issues.map((item) =>
        issue(
          name,
          item.locale ? `${item.locale}.${item.ruleId}` : item.ruleId,
          item.message,
        ),
      );
      const rawFiles = {
        shared: unit.shared.state === "valid" ? unit.shared.raw : "",
        ja: unit.locales.ja.state === "valid" ? unit.locales.ja.raw : "",
        en: unit.locales.en.state === "valid" ? unit.locales.en.raw : "",
      };
      if (
        unit.shared.state !== "valid" ||
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid"
      )
        return {
          contentId: name,
          file: directory,
          raw: JSON.stringify(rawFiles),
          rawFiles,
          body: "",
          issues,
          structuralStatus: "issues" as const,
          issueCount: issues.length,
        };
      const shared = unit.shared.value,
        ja = unit.locales.ja.value,
        en = unit.locales.en.value;
      const data: WorkData = {
        artist: { id: shared.artist, collection: "artists" },
        images: shared.images.map((image, index) => ({
          src: image.src,
          alt: ja.images[index].alt,
        })),
        title: ja.title,
        inquiry: shared.inquiry,
        ...(shared.year ? { year: shared.year } : {}),
        ...(shared.orientation ? { orientation: shared.orientation } : {}),
        ...(ja.material ? { material: ja.material } : {}),
        ...(ja.size ? { size: ja.size } : {}),
        ...(ja.seo_title ? { seo_title: ja.seo_title } : {}),
        ...(ja.description ? { description: ja.description } : {}),
      };
      return {
        contentId: name,
        file: directory,
        raw: JSON.stringify(rawFiles),
        rawFiles,
        data,
        localized: {
          ja: { ...ja, body: unit.locales.ja.body ?? "" },
          en: { ...en, body: unit.locales.en.body ?? "" },
        },
        body: unit.locales.ja.body ?? "",
        issues,
        structuralStatus,
        issueCount: issues.length,
      };
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
