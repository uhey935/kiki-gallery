import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import { loadArtistUnit } from "../content-loaders/artists/repository.ts";
import type {
  ArtistIdentity,
  ArtistLocale,
  ArtistLocalized,
} from "../content-loaders/artists/contracts.ts";
import { editorArtistSchema, type ArtistData } from "../content-schemas/artist.ts";
import type { EditorCollectionState } from "./collection-contracts.ts";
import { isContentId } from "./content-id.ts";

export type ArtistsEditorLocaleState = ArtistLocalized & { body: string };
export type ArtistsEditorEntryState = {
  contentId: string;
  file: string;
  canonicalFiles?: { "index.yaml": string; "ja.md": string; "en.md": string };
  shared?: ArtistIdentity;
  locales: Partial<Record<ArtistLocale, ArtistsEditorLocaleState>>;
  /** JA compatibility view for the existing operator form. */
  data?: ArtistData;
  body: string;
  issues: ContentIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
};
export class ArtistsEditorEntryNotFoundError extends Error {}
export class ArtistsLegacySourceDetectedError extends Error {}
const canonicalRoot = path.resolve("src/content/artists");

function body(raw: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  return match?.[1].trim() ?? "";
}

async function readThreeFileEntry(contentId: string, root: string) {
  const directory = path.join(root, contentId);
  const unit = await loadArtistUnit(directory);
  const shared = unit.identity.state === "valid" ? unit.identity.value : undefined;
  const locales: ArtistsEditorEntryState["locales"] = {};
  for (const locale of ["ja", "en"] as const) {
    const source = unit.locales[locale];
    if (source.state === "valid") locales[locale] = { ...source.value, body: body(source.raw) };
  }
  const ja = locales.ja;
  const compatibility = shared && ja
    ? editorArtistSchema.safeParse({
        name: shared.sort_name,
        display_name: ja.name,
        hero: shared.hero,
        medium: shared.medium,
        works_layout: shared.works_layout?.map((section) => ({
          layout: section.layout,
          works: section.works.map((id) => ({ id, collection: "works" as const })),
        })),
        short_bio: ja.short_bio,
        biography: ja.biography,
        hero_alt: ja.hero_alt,
        seo_title: ja.seo_title,
        description: ja.description,
      })
    : undefined;
  const issues = unit.issues as ContentIssue[];
  const structural = issues.filter((item) =>
    ["parse", "structure", "unit-integrity", "repository-integrity"].includes(item.category),
  );
  return {
    contentId,
    file: directory,
    ...(unit.identity.state !== "missing" && unit.locales.ja.state !== "missing" && unit.locales.en.state !== "missing"
      ? { canonicalFiles: {
          "index.yaml": unit.identity.raw,
          "ja.md": unit.locales.ja.raw,
          "en.md": unit.locales.en.raw,
        } }
      : {}),
    shared,
    locales,
    data: compatibility?.success ? compatibility.data : undefined,
    body: ja?.body ?? "",
    issues,
    structuralStatus: structural.length ? "issues" as const : "valid" as const,
    issueCount: issues.length,
  };
}

async function readEntries(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".md")))
    throw new ArtistsLegacySourceDetectedError("Legacy flat Artist source detected; Editor refuses mixed repositories.");
  return Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().map((id) => readThreeFileEntry(id, root)));
}

export async function readArtistsEditorState(root = canonicalRoot): Promise<EditorCollectionState> {
  return { entries: (await readEntries(root)).map((entry) => ({
    contentId: entry.contentId,
    title: entry.locales.ja?.name ?? entry.contentId,
    detail: entry.shared ? `${entry.shared.sort_name} · ${entry.shared.medium.join(" / ")}` : "Invalid Artist data",
    status: entry.issueCount ? "issues" : entry.structuralStatus,
    statusLabel: entry.issueCount ? `${entry.issueCount} issues` : "Ready",
  })) };
}

export async function readArtistsEditorEntry(contentId: string, root = canonicalRoot) {
  if (!isContentId(contentId)) throw new ArtistsEditorEntryNotFoundError(contentId);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === `${contentId}.md`.toLowerCase())) throw new ArtistsLegacySourceDetectedError(contentId);
  if (entries.some((entry) => entry.name === contentId && entry.isDirectory())) return readThreeFileEntry(contentId, root);
  throw new ArtistsEditorEntryNotFoundError(contentId);
}
