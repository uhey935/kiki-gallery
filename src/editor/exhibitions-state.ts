import path from "node:path";
import type { ExhibitionIssue, SourceState } from "../content-loaders/exhibitions/contracts.ts";
import { evaluateExhibitionLocale } from "../content-loaders/exhibitions/facade.ts";
import { loadExhibitionRepository } from "../content-loaders/exhibitions/repository.ts";
import type { ExhibitionLocale, ExhibitionLocalized, ExhibitionShared } from "../content-loaders/exhibitions/schema.ts";
import { isContentId } from "./content-id.ts";

export type ExhibitionsEditorEntryState = {
  contentId: string;
  shared: SourceState<ExhibitionShared>;
  locales: Record<ExhibitionLocale, SourceState<ExhibitionLocalized & { body: string }>>;
  issues: ExhibitionIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
  capabilities: { save: boolean; preview: Record<ExhibitionLocale, boolean>; publish: boolean };
  data?: { artists: Array<{ id: string; collection: "artists" }>; works?: Array<{ id: string; collection: "works" }> };
};
export class ExhibitionsEditorEntryNotFoundError extends Error {}
const canonicalRoot = path.resolve("src/content/exhibitions");

async function entries(root: string) {
  const units = await loadExhibitionRepository(root);
  const capable = () => true;
  return units.map((unit): ExhibitionsEditorEntryState => {
    const ja = evaluateExhibitionLocale(unit, "ja", capable).allowed;
    const en = evaluateExhibitionLocale(unit, "en", capable).allowed;
    const locale = (value: typeof unit.locales.ja) =>
      value.state === "valid"
        ? { ...value, value: { ...value.value, body: value.body ?? "" } }
        : value;
    return {
      contentId: unit.contentId,
      shared: unit.shared,
      locales: { ja: locale(unit.locales.ja), en: locale(unit.locales.en) },
      issues: unit.issues,
      structuralStatus: unit.issues.length ? "issues" : "valid",
      issueCount: unit.issues.length,
      capabilities: { save: unit.shared.state === "valid" && unit.locales.ja.state === "valid" && unit.locales.en.state === "valid", preview: { ja, en }, publish: ja },
      ...(unit.shared.state === "valid" ? { data: { artists: unit.shared.value.artists.map(id => ({ id, collection: "artists" as const })), ...(unit.shared.value.works ? { works: unit.shared.value.works.map(id => ({ id, collection: "works" as const })) } : {}) } } : {}),
    };
  });
}

export async function readExhibitionsEditorState(root = canonicalRoot) {
  const values = await entries(root);
  return { entries: values.map((entry) => ({
    contentId: entry.contentId,
    title: entry.locales.ja.state === "valid" ? entry.locales.ja.value.title : entry.contentId,
    detail: entry.shared.state === "valid" ? `${entry.shared.value.start_date} · ${entry.shared.value.artists.length} artist(s)` : "Invalid Exhibition data",
    status: entry.structuralStatus,
    statusLabel: entry.issueCount ? `${entry.issueCount} issues` : "Ready",
  })) };
}

export async function readExhibitionsEditorEntry(contentId: string, root = canonicalRoot) {
  if (!isContentId(contentId)) throw new ExhibitionsEditorEntryNotFoundError(contentId);
  const entry = (await entries(root)).find((candidate) => candidate.contentId === contentId);
  if (!entry) throw new ExhibitionsEditorEntryNotFoundError(contentId);
  return entry;
}
