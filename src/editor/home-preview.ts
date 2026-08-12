import { randomUUID } from "node:crypto";
import type {
  HomeLocale,
  HomeLocalized,
  HomeShared,
} from "../content-loaders/home/schema.ts";
import {
  validateHomeEditorDraft,
  type HomeEditorDraftState,
} from "./home-draft-state.ts";
const projectHomeDestination = (
  destination: "artists" | "about",
  locale: HomeLocale,
) =>
  locale === "ja"
    ? destination === "artists"
      ? "/artists/"
      : "/about/"
    : destination === "artists"
      ? "/en/artists/"
      : "/en/about/";
export class HomePreviewError extends Error {
  readonly code:
    | "invalid-request"
    | "preview-blocked"
    | "preview-not-found"
    | "preview-expired";
  constructor(message: string, code: HomePreviewError["code"]) {
    super(message);
    this.code = code;
  }
}
export type HomePreviewModel = {
  contentId: "home";
  locale: HomeLocale;
  shared: HomeShared;
  localized: HomeLocalized;
  destinations: { artists: string; about: string };
};
export function createHomePreviewModel(
  draft: HomeEditorDraftState,
  locale: HomeLocale = "ja",
): HomePreviewModel {
  if (!validateHomeEditorDraft(draft).capabilities.preview[locale])
    throw new HomePreviewError(
      "Home is blocked from preview",
      "preview-blocked",
    );
  if (
    draft.shared.state !== "editable" ||
    draft.locales[locale].state !== "editable"
  )
    throw new HomePreviewError("Home source unavailable", "preview-blocked");
  return {
    contentId: "home",
    locale,
    shared: structuredClone(draft.shared.value),
    localized: structuredClone(draft.locales[locale].value),
    destinations: {
      artists: projectHomeDestination("artists", locale),
      about: projectHomeDestination("about", locale),
    },
  };
}
export class HomePreviewStore {
  private records = new Map<
    string,
    { expires: number; model: HomePreviewModel }
  >();
  private ttl: number;
  private now: () => number;
  constructor(ttl = 600000, now: () => number = Date.now) {
    this.ttl = ttl;
    this.now = now;
  }
  create(model: HomePreviewModel) {
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
      throw new HomePreviewError("Home preview not found", "preview-not-found");
    if (record.expires <= this.now()) {
      this.records.delete(token);
      throw new HomePreviewError("Home preview expired", "preview-expired");
    }
    if (
      localeOrId !== record.model.contentId &&
      localeOrId !== record.model.locale
    )
      throw new HomePreviewError("Home preview mismatch", "preview-not-found");
    return structuredClone(record.model);
  }
}
export const homePreviewStore = new HomePreviewStore();
