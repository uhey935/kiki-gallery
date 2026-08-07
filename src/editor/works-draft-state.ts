import { editorWorkSchema, type WorkData } from "../content-schemas/work.ts";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { WorksEditorEntryState } from "./works-state.ts";

export type WorksEditorDraftState = {
  contentId: string;
  data: WorkData;
  body: string;
  sourceRaw: string;
};

export type WorksEditorDraftValidation = {
  issues: ContentIssue[];
  capabilities: { save: boolean; preview: boolean; publish: boolean };
};

export function createWorksEditorDraft(
  entry: WorksEditorEntryState,
): WorksEditorDraftState | undefined {
  return entry.data
    ? {
        contentId: entry.contentId,
        data: structuredClone(entry.data),
        body: entry.body,
        sourceRaw: entry.raw,
      }
    : undefined;
}

export function validateWorksEditorDraft(
  draft: WorksEditorDraftState,
): WorksEditorDraftValidation {
  const result = editorWorkSchema.safeParse(draft.data);
  const issues: ContentIssue[] = result.success
    ? []
    : result.error.issues.map((item) => ({
        ruleId: "content.work.structure",
        severity: "error" as const,
        category: "structure" as const,
        collection: "works" as const,
        contentId: draft.contentId,
        fieldPath: item.path.join("."),
        messageKey: item.message,
        recovery: {
          kind: "edit-field" as const,
          fieldPath: item.path.join("."),
        },
      }));
  const allowed = issues.length === 0;
  return {
    issues,
    capabilities: { save: allowed, preview: allowed, publish: allowed },
  };
}

export function updateWorksEditorDraft(
  draft: WorksEditorDraftState,
  update: (next: WorksEditorDraftState) => void,
): WorksEditorDraftState {
  const next = structuredClone(draft);
  update(next);
  return next;
}

export function isWorksEditorDraftDirty(
  initial: WorksEditorDraftState,
  current: WorksEditorDraftState,
): boolean {
  return (
    initial.contentId !== current.contentId ||
    JSON.stringify(initial.data) !== JSON.stringify(current.data) ||
    initial.body !== current.body
  );
}
