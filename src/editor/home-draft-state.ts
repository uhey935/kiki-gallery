import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import { homeSchema, type HomeData } from "../content-schemas/home.ts";
import type { HomeEditorEntryState } from "./home-state.ts";
export type HomeEditorDraftState = {
  contentId: "home";
  data: HomeData;
  sourceRaw: string;
};
export const createHomeEditorDraft = (
  entry: HomeEditorEntryState,
): HomeEditorDraftState | undefined =>
  entry.data
    ? {
        contentId: "home",
        data: structuredClone(entry.data),
        sourceRaw: entry.raw,
      }
    : undefined;
export function validateHomeEditorDraft(draft: HomeEditorDraftState) {
  const result = homeSchema.safeParse(draft.data);
  const issues: ContentIssue[] = result.success
    ? []
    : result.error.issues.map((item) => ({
        ruleId: "content.home.structure",
        severity: "error",
        category: "structure",
        collection: "home",
        contentId: draft.contentId,
        fieldPath: item.path.join("."),
        messageKey: item.message,
        recovery: { kind: "edit-field", fieldPath: item.path.join(".") },
      }));
  const allowed = draft.contentId === "home" && issues.length === 0;
  return {
    issues,
    capabilities: { save: allowed, preview: allowed, publish: allowed },
  };
}
export const isHomeEditorDraftDirty = (
  initial: HomeEditorDraftState,
  current: HomeEditorDraftState,
) => JSON.stringify(initial.data) !== JSON.stringify(current.data);
