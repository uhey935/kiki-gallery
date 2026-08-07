import { newsSchema, type NewsData } from "../content-schemas/news.ts";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { NewsEditorEntryState } from "./news-state.ts";
export type NewsEditorDraftState = {
  contentId: string;
  data: NewsData;
  sourceRaw: string;
};
export const createNewsEditorDraft = (
  entry: NewsEditorEntryState,
): NewsEditorDraftState | undefined =>
  entry.data
    ? {
        contentId: entry.contentId,
        data: structuredClone(entry.data),
        sourceRaw: entry.raw,
      }
    : undefined;
export function validateNewsEditorDraft(draft: NewsEditorDraftState) {
  const result = newsSchema.safeParse(draft.data);
  const issues: ContentIssue[] = result.success
    ? []
    : result.error.issues.map((item) => ({
        ruleId: "content.news.structure",
        severity: "error",
        category: "structure",
        collection: "news",
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
export const isNewsEditorDraftDirty = (
  initial: NewsEditorDraftState,
  current: NewsEditorDraftState,
) => JSON.stringify(initial.data) !== JSON.stringify(current.data);
