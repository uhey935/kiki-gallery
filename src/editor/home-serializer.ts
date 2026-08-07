import { stringify } from "yaml";
import type { HomeEditorDraftState } from "./home-draft-state.ts";
export function serializeHomeEditorDraft(draft: HomeEditorDraftState) {
  return `---\n${stringify(draft.data, { lineWidth: 0 }).trimEnd()}\n---\n`;
}
