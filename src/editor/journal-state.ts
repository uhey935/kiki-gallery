import path from "node:path";

import { evaluateJournalCapabilities } from "../content-loaders/journal/capabilities.ts";
import type {
  ContentIssue,
  LoadedJournalUnit,
  Locale,
  SourceState,
} from "../content-loaders/journal/contracts.ts";
import type {
  JournalLocalized,
  JournalShared,
} from "../content-loaders/journal/schema.ts";
import { loadJournalRepository } from "../content-loaders/journal/repository.ts";
import { isContentId } from "./content-id.ts";

export type JournalEditorSourceStatus = SourceState<unknown>["state"];

export type JournalEditorEntrySummary = {
  contentId: string;
  title: string;
  date?: string;
  localeStatus: Record<Locale, JournalEditorSourceStatus>;
  structuralStatus: "valid" | "issues";
  issueCount: number;
  capabilities: {
    save: boolean;
    preview: Record<Locale, boolean>;
    publish: boolean;
  };
};

export type JournalEditorCollectionState = {
  entries: JournalEditorEntrySummary[];
};

export type JournalEditorEntryState = JournalEditorEntrySummary & {
  shared: SourceState<JournalShared>;
  locales: Record<Locale, SourceState<JournalLocalized & { body: string }>>;
  issues: ContentIssue[];
};

export class JournalEditorEntryNotFoundError extends Error {
  constructor(contentId: string) {
    super(`Journal Editor entry not found: ${contentId}`);
    this.name = "JournalEditorEntryNotFoundError";
  }
}

const canonicalJournalRoot = path.resolve("src/content/journal");

function titleFor(unit: LoadedJournalUnit): string {
  for (const locale of ["ja", "en"] as const) {
    const source = unit.locales[locale];
    if (source.state === "valid") return source.value.title;
  }
  return unit.contentId;
}

function toSummary(unit: LoadedJournalUnit): JournalEditorEntrySummary {
  const capabilities = evaluateJournalCapabilities(unit);
  return {
    contentId: unit.contentId,
    title: titleFor(unit),
    date: unit.shared.state === "valid" ? unit.shared.value.date : undefined,
    localeStatus: {
      ja: unit.locales.ja.state,
      en: unit.locales.en.state,
    },
    structuralStatus: unit.issues.length === 0 ? "valid" : "issues",
    issueCount: unit.issues.length,
    capabilities: {
      save: capabilities.save.allowed,
      preview: {
        ja: capabilities.preview.ja.allowed,
        en: capabilities.preview.en.allowed,
      },
      publish: capabilities.publish.allowed,
    },
  };
}

function toEntryState(unit: LoadedJournalUnit): JournalEditorEntryState {
  return {
    ...toSummary(unit),
    shared: unit.shared,
    locales: unit.locales,
    issues: unit.issues,
  };
}

export async function readJournalEditorState(
  root = canonicalJournalRoot,
): Promise<JournalEditorCollectionState> {
  const units = await loadJournalRepository(root);
  return {
    entries: units.map(toSummary).sort((left, right) => {
      const byDate = (right.date ?? "").localeCompare(left.date ?? "");
      return byDate || left.contentId.localeCompare(right.contentId);
    }),
  };
}

export async function readJournalEditorEntry(
  contentId: string,
  root = canonicalJournalRoot,
): Promise<JournalEditorEntryState> {
  if (!isContentId(contentId)) {
    throw new JournalEditorEntryNotFoundError(contentId);
  }

  const units = await loadJournalRepository(root);
  const unit = units.find((candidate) => candidate.contentId === contentId);
  if (!unit) throw new JournalEditorEntryNotFoundError(contentId);
  return toEntryState(unit);
}
