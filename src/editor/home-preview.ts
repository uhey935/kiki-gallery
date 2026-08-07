import { randomUUID } from "node:crypto";
import {
  validateHomeEditorDraft,
  type HomeEditorDraftState,
} from "./home-draft-state.ts";
export class HomePreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired"
    | "preview-content-mismatch";
  constructor(message: string, code: HomePreviewError["code"]) {
    super(message);
    this.code = code;
  }
}
export type HomePreviewModel = Pick<HomeEditorDraftState, "contentId" | "data">;
export function createHomePreviewModel(
  draft: HomeEditorDraftState,
): HomePreviewModel {
  if (!validateHomeEditorDraft(draft).capabilities.preview)
    throw new HomePreviewError(
      "Home is blocked from preview",
      "preview-blocked",
    );
  return { contentId: "home", data: structuredClone(draft.data) };
}
export class HomePreviewStore {
  private records = new Map<
    string,
    { expires: number; model: HomePreviewModel }
  >();
  private ttl: number;
  private now: () => number;
  constructor(ttl = 15 * 60_000, now = () => Date.now()) {
    this.ttl = ttl;
    this.now = now;
  }
  create(model: HomePreviewModel) {
    const token = randomUUID();
    this.records.set(token, {
      expires: this.now() + this.ttl,
      model: structuredClone(model),
    });
    return token;
  }
  read(token: string, contentId: string) {
    const record = this.records.get(token);
    if (!record)
      throw new HomePreviewError("Home preview not found", "preview-not-found");
    if (record.expires <= this.now()) {
      this.records.delete(token);
      throw new HomePreviewError("Home preview expired", "preview-expired");
    }
    if (contentId !== "home" || record.model.contentId !== contentId)
      throw new HomePreviewError(
        "Home preview Content ID mismatch",
        "preview-content-mismatch",
      );
    return structuredClone(record.model);
  }
}
export const homePreviewStore = new HomePreviewStore();
