import { randomUUID } from "node:crypto";
import { presentAboutHours } from "../content-loaders/about/hours-presenter.ts";
import type { AboutLocale } from "../content-loaders/about/schema.ts";
import {
  validateAboutEditorDraft,
  type AboutEditorDraftState,
} from "./about-draft-state.ts";

export class AboutPreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired";
  constructor(message: string, code: AboutPreviewError["code"]) {
    super(message);
    this.code = code;
  }
}
export function createAboutPreviewModel(
  draft: AboutEditorDraftState,
  locale: AboutLocale = "ja",
) {
  if (!validateAboutEditorDraft(draft).capabilities.preview[locale])
    throw new AboutPreviewError(
      "About locale is blocked from preview",
      "preview-blocked",
    );
  if (
    draft.shared.state !== "editable" ||
    draft.locales[locale].state !== "editable"
  )
    throw new AboutPreviewError("About source unavailable", "preview-blocked");
  const shared = structuredClone(draft.shared.value);
  const localized = structuredClone(draft.locales[locale].value);
  return {
    contentId: "about" as const,
    locale,
    contentStatus: localized.content_status,
    hero: shared.images.hero,
    gallery: shared.images.gallery.map((image, index) => ({
      ...image,
      alt: localized.images.gallery[index].alt,
    })),
    address: localized.address,
    body: localized.body,
    seoTitle: localized.seo_title,
    description: localized.description,
    hours: presentAboutHours(shared.hours, locale),
    contact: shared.contact,
  };
}
export class AboutPreviewStore {
  private records = new Map<
    string,
    { expires: number; model: ReturnType<typeof createAboutPreviewModel> }
  >();
  private ttl: number;
  private now: () => number;
  constructor(ttl = 600000, now: () => number = Date.now) {
    this.ttl = ttl;
    this.now = now;
  }
  create(model: ReturnType<typeof createAboutPreviewModel>) {
    const token = randomUUID();
    this.records.set(token, {
      model: structuredClone(model),
      expires: this.now() + this.ttl,
    });
    return token;
  }
  read(token: string, localeOrId: string) {
    const record = this.records.get(token);
    if (!record)
      throw new AboutPreviewError(
        "About preview not found",
        "preview-not-found",
      );
    if (record.expires <= this.now()) {
      this.records.delete(token);
      throw new AboutPreviewError("About preview expired", "preview-expired");
    }
    if (localeOrId !== record.model.locale && localeOrId !== "about")
      throw new AboutPreviewError(
        "About preview mismatch",
        "preview-not-found",
      );
    return structuredClone(record.model);
  }
}
export const aboutPreviewStore = new AboutPreviewStore();
