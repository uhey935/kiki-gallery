import { randomUUID } from "node:crypto";
import {
  normalizeArtistsEditorDraft,
  validateArtistsEditorDraft,
  type ArtistsEditorDraftState,
} from "./artists-draft-state.ts";
import type { ArtistLocale } from "../content-loaders/artists/contracts.ts";
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
  input: ArtistsEditorDraftState,
  locale: ArtistLocale = "ja",
): ArtistsPreviewModel {
  const draft = normalizeArtistsEditorDraft(input);
  if (!validateArtistsEditorDraft(draft).capabilities.localePreview[locale])
    throw new ArtistsPreviewError(
      "Artist is blocked from preview",
      "preview-blocked",
    );
  if (
    draft.shared.state !== "editable" ||
    draft.locales[locale].state !== "editable"
  )
    throw new ArtistsPreviewError(
      "Artist locale is unavailable for preview",
      "preview-blocked",
    );
  const shared = draft.shared.value;
  const localized = draft.locales[locale].value;
  return {
    contentId: draft.contentId,
    data: {
      name: shared.sort_name,
      display_name: localized.name,
      hero: shared.hero,
      medium: shared.medium,
      medium_label: localized.medium_label,
      ...(shared.works_layout
        ? {
            works_layout: shared.works_layout.map((section) => ({
              layout: section.layout,
              works: section.works.map((id) => ({
                id,
                collection: "works" as const,
              })),
            })),
          }
        : {}),
      short_bio: localized.short_bio,
      biography: localized.biography,
      hero_alt: localized.hero_alt,
      seo_title: localized.seo_title,
      description: localized.description,
    },
    body: localized.body,
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
