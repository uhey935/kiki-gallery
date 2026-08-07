import { editorWorkSchema, type WorkData } from "../content-schemas/work.ts";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { WorksEditorEntryState } from "./works-state.ts";

export type WorksEditorDraftState = {
  contentId: string;
  data: WorkData;
  body: string;
};

export function createWorksEditorDraft(
  entry: WorksEditorEntryState,
): WorksEditorDraftState | undefined {
  return entry.data
    ? {
        contentId: entry.contentId,
        data: structuredClone(entry.data),
        body: entry.body,
      }
    : undefined;
}

export function validateWorksEditorDraft(
  draft: WorksEditorDraftState,
): ContentIssue[] {
  const result = editorWorkSchema.safeParse(draft.data);
  if (result.success) return [];
  return result.error.issues.map((item) => ({
    ruleId: "content.work.structure",
    severity: "error",
    category: "structure",
    collection: "works",
    contentId: draft.contentId,
    fieldPath: item.path.join("."),
    messageKey: item.message,
    recovery: { kind: "edit-field", fieldPath: item.path.join(".") },
  }));
}
