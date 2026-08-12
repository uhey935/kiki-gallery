import { stringify } from "yaml";
import type { ExhibitionLocale, ExhibitionLocalized, ExhibitionShared } from "../content-loaders/exhibitions/schema.ts";
import type { ExhibitionsEditorDraftSource, ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";

export type ExhibitionsSerializedFiles = { "index.yaml": string; "ja.md": string; "en.md": string };
export class ExhibitionsDraftNotSerializableError extends Error {}
function value<T>(source: ExhibitionsEditorDraftSource<T>, scope: "shared" | ExhibitionLocale) {
  if (source.state !== "editable") throw new ExhibitionsDraftNotSerializableError(`Exhibition draft source unavailable: ${scope}`);
  return source.value;
}
function shared(v: ExhibitionShared): ExhibitionShared { return {
  artists: v.artists,
  ...(v.works ? { works: v.works } : {}),
  start_date: v.start_date,
  end_date: v.end_date,
  ...(v.display_artists === undefined ? {} : { display_artists: v.display_artists }),
  hero: { image: v.hero.image, orientation: v.hero.orientation, ...(v.hero.position ? { position: v.hero.position } : {}), ...(v.hero.treatment ? { treatment: v.hero.treatment } : {}) },
}; }
function locale(v: ExhibitionLocalized & { body: string }) {
  const { body, ...data } = v;
  const ordered: ExhibitionLocalized = {
    title: data.title,
    ...(data.summary ? { summary: data.summary } : {}),
    ...(data.venue ? { venue: data.venue } : {}),
    ...(data.opening_hours ? { opening_hours: data.opening_hours } : {}),
    ...(data.closed_days ? { closed_days: data.closed_days } : {}),
    ...(data.attendance ? { attendance: data.attendance } : {}),
    hero_alt: data.hero_alt,
    ...(data.hero_caption ? { hero_caption: data.hero_caption } : {}),
    ...(data.seo_title ? { seo_title: data.seo_title } : {}),
    ...(data.description ? { description: data.description } : {}),
  };
  return `---\n${stringify(ordered)}---\n${body}`;
}
export function serializeExhibitionsEditorDraft(draft: ExhibitionsEditorDraftState): ExhibitionsSerializedFiles {
  return { "index.yaml": stringify(shared(value(draft.shared, "shared"))), "ja.md": locale(value(draft.locales.ja, "ja")), "en.md": locale(value(draft.locales.en, "en")) };
}
