import { randomUUID } from "node:crypto";
import {
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import type { NewsLocale } from "../content-loaders/news/contracts.ts";
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
export type NewsPreviewModel = Pick<NewsEditorDraftState, "contentId"> & {
  locale?: NewsLocale;
  data: NewsEditorDraftState["data"];
};
export function createNewsPreviewModel(
  draft: NewsEditorDraftState,
  locale: NewsLocale = "ja",
): NewsPreviewModel {
  if (!validateNewsEditorDraft(draft).capabilities.preview[locale])
    throw new NewsPreviewError(
      "News is blocked from preview",
      "preview-blocked",
    );
  const localized = draft.locales[locale];
  if (draft.shared.state !== "editable" || localized.state !== "editable")
    throw new NewsPreviewError(
      "News locale is unavailable for preview",
      "preview-blocked",
    );
  return {
    contentId: draft.contentId,
    locale,
    data: {
      ...structuredClone(draft.shared.value),
      title: localized.value.title,
      ...(localized.value.summary === undefined
        ? {}
        : { summary: localized.value.summary }),
    },
  };
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
