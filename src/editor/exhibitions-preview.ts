import { randomUUID } from "node:crypto";
import {
  editorExhibitionSchema,
  type ExhibitionData,
} from "../content-schemas/exhibition.ts";
import {
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
export type ExhibitionsPreviewModel = {
  contentId: string;
  data: ExhibitionData;
  body: string;
};
export class ExhibitionsPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired";
  constructor(
    message: string,
    code:
      | "invalid-request"
      | "preview-blocked"
      | "preview-not-found"
      | "preview-expired",
  ) {
    super(message);
    this.code = code;
  }
}
export function createExhibitionsPreviewModel(
  draft: ExhibitionsEditorDraftState,
): ExhibitionsPreviewModel {
  if (!validateExhibitionsEditorDraft(draft).capabilities.preview)
    throw new ExhibitionsPreviewError(
      "Exhibition preview is blocked by validation",
      "preview-blocked",
    );
  return {
    contentId: draft.contentId,
    data: editorExhibitionSchema.parse(draft.data),
    body: draft.body,
  };
}
export class ExhibitionsPreviewStore {
  private records = new Map<
    string,
    { model: ExhibitionsPreviewModel; expiresAt: number }
  >();
  private readonly ttlMs: number;
  private readonly now: () => number;
  constructor(ttlMs = 600_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }
  create(model: ExhibitionsPreviewModel) {
    const token = randomUUID();
    this.records.set(token, {
      model: structuredClone(model),
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }
  read(token: string, contentId: string) {
    const record = this.records.get(token);
    if (!record)
      throw new ExhibitionsPreviewError(
        "Preview not found",
        "preview-not-found",
      );
    if (record.expiresAt <= this.now()) {
      this.records.delete(token);
      throw new ExhibitionsPreviewError("Preview expired", "preview-expired");
    }
    if (record.model.contentId !== contentId)
      throw new ExhibitionsPreviewError(
        "Preview not found",
        "preview-not-found",
      );
    return structuredClone(record.model);
  }
}
export const exhibitionsPreviewStore = new ExhibitionsPreviewStore();
