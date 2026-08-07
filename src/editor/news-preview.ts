import { randomUUID } from "node:crypto";
import {
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
export class NewsPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired"
    | "preview-content-mismatch";
  constructor(message: string, code: NewsPreviewError["code"]) {
    super(message);
    this.code = code;
  }
}
export type NewsPreviewModel = Pick<NewsEditorDraftState, "contentId" | "data">;
export function createNewsPreviewModel(
  draft: NewsEditorDraftState,
): NewsPreviewModel {
  if (!validateNewsEditorDraft(draft).capabilities.preview)
    throw new NewsPreviewError(
      "News is blocked from preview",
      "preview-blocked",
    );
  return { contentId: draft.contentId, data: structuredClone(draft.data) };
}
export class NewsPreviewStore {
  private records = new Map<
    string,
    { expires: number; model: NewsPreviewModel }
  >();
  private ttl: number;
  private now: () => number;
  constructor(ttl = 15 * 60_000, now = () => Date.now()) {
    this.ttl = ttl;
    this.now = now;
  }
  create(model: NewsPreviewModel) {
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
      throw new NewsPreviewError("News preview not found", "preview-not-found");
    if (record.expires <= this.now()) {
      this.records.delete(token);
      throw new NewsPreviewError("News preview expired", "preview-expired");
    }
    if (record.model.contentId !== contentId)
      throw new NewsPreviewError(
        "News preview Content ID mismatch",
        "preview-content-mismatch",
      );
    return structuredClone(record.model);
  }
}
export const newsPreviewStore = new NewsPreviewStore();
