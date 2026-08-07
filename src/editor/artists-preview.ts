import { randomUUID } from "node:crypto";
import {
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
export class ArtistsPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired"
    | "preview-content-mismatch";
  constructor(message: string, code: ArtistsPreviewError["code"]) {
    super(message);
    this.code = code;
  }
}
export type ArtistsPreviewModel = Pick<
  ArtistsEditorDraftState,
  "contentId" | "data" | "body"
>;
export function createArtistsPreviewModel(
  draft: ArtistsEditorDraftState,
): ArtistsPreviewModel {
  if (!validateArtistsEditorDraft(draft).capabilities.preview)
    throw new ArtistsPreviewError(
      "Artist is blocked from preview",
      "preview-blocked",
    );
  return {
    contentId: draft.contentId,
    data: structuredClone(draft.data),
    body: draft.body,
  };
}
export class ArtistsPreviewStore {
  private records = new Map<
    string,
    { expires: number; model: ArtistsPreviewModel }
  >();
  private ttl: number;
  private now: () => number;
  constructor(ttl = 15 * 60_000, now = () => Date.now()) {
    this.ttl = ttl;
    this.now = now;
  }
  create(model: ArtistsPreviewModel) {
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
      throw new ArtistsPreviewError(
        "Artist preview not found",
        "preview-not-found",
      );
    if (record.expires <= this.now()) {
      this.records.delete(token);
      throw new ArtistsPreviewError(
        "Artist preview expired",
        "preview-expired",
      );
    }
    if (record.model.contentId !== contentId)
      throw new ArtistsPreviewError(
        "Artist preview Content ID mismatch",
        "preview-content-mismatch",
      );
    return structuredClone(record.model);
  }
}
export const artistsPreviewStore = new ArtistsPreviewStore();
