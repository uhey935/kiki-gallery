import {
  editorArtistSchema,
  type ArtistData,
} from "../content-schemas/artist.ts";
import type { ContentIssue } from "../content-loaders/journal/contracts.ts";
import type { ArtistsEditorEntryState } from "./artists-state.ts";
export type ArtistsEditorDraftState = {
  contentId: string;
  data: ArtistData;
  body: string;
  sourceRaw: string;
};
export const createArtistsEditorDraft = (
  entry: ArtistsEditorEntryState,
): ArtistsEditorDraftState | undefined =>
  entry.data
    ? {
        contentId: entry.contentId,
        data: structuredClone(entry.data),
        body: entry.body,
        sourceRaw: entry.raw,
      }
    : undefined;
export function validateArtistsEditorDraft(draft: ArtistsEditorDraftState) {
  const result = editorArtistSchema.safeParse(draft.data);
  const issues: ContentIssue[] = result.success
    ? []
    : result.error.issues.map((item) => ({
        ruleId: "content.artist.structure",
        severity: "error",
        category: "structure",
        collection: "artists",
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
export const isArtistsEditorDraftDirty = (
  initial: ArtistsEditorDraftState,
  current: ArtistsEditorDraftState,
) =>
  JSON.stringify(initial.data) !== JSON.stringify(current.data) ||
  initial.body !== current.body;
