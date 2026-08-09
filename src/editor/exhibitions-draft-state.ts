import {
  editorExhibitionSchema,
  type ExhibitionData,
} from "../content-schemas/exhibition.ts";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { ExhibitionsEditorEntryState } from "./exhibitions-state.ts";

export type ExhibitionsEditorDraftState = {
  contentId: string;
  data: ExhibitionData;
  body: string;
  sourceRaw: string;
};
export function normalizeExhibitionDateInput(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(Number.NaN);
  const normalized = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(normalized.getTime()) ||
    normalized.toISOString().slice(0, 10) !== value
  )
    return new Date(Number.NaN);
  return normalized;
}
export function createExhibitionsEditorDraft(
  entry: ExhibitionsEditorEntryState,
): ExhibitionsEditorDraftState | undefined {
  return entry.data
    ? {
        contentId: entry.contentId,
        data: structuredClone(entry.data),
        body: entry.body,
        sourceRaw: entry.raw,
      }
    : undefined;
}
export function validateExhibitionsEditorDraft(
  draft: ExhibitionsEditorDraftState,
) {
  const result = editorExhibitionSchema.safeParse(draft.data);
  const issues: ContentIssue[] = result.success
    ? []
    : result.error.issues.map((item) => ({
        ruleId: "content.exhibition.structure",
        severity: "error",
        category: "structure",
        collection: "exhibitions",
        contentId: draft.contentId,
        fieldPath: item.path.join("."),
        messageKey: item.message,
        recovery: { kind: "edit-field", fieldPath: item.path.join(".") },
      }));
  const allowed = issues.length === 0;
  return {
    issues,
    capabilities: { save: allowed, preview: allowed, publish: allowed },
  };
}
export const isExhibitionsEditorDraftDirty = (
  initial: ExhibitionsEditorDraftState,
  current: ExhibitionsEditorDraftState,
) =>
  JSON.stringify(initial.data) !== JSON.stringify(current.data) ||
  initial.body !== current.body;
