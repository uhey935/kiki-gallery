import { parse, stringify } from "yaml";
import {
  editorExhibitionSchema,
  type ExhibitionData,
} from "../content-schemas/exhibition.ts";
import type { ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";

const date = (value: Date) => value.toISOString().slice(0, 10);
function parsed(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) return;
  const result = editorExhibitionSchema.safeParse(parse(match[1]));
  return result.success
    ? { data: result.data, body: match[2].trim() }
    : undefined;
}
function ordered(data: ExhibitionData) {
  return {
    ...(data.title === undefined ? {} : { title: data.title }),
    artists: data.artists.map(({ id }) => id),
    ...(data.works === undefined
      ? {}
      : { works: data.works.map(({ id }) => id) }),
    start_date: date(data.start_date),
    end_date: date(data.end_date),
    ...(data.display_artists === undefined
      ? {}
      : { display_artists: data.display_artists }),
    hero: data.hero,
    hero_alt: data.hero_alt,
    ...(data.summary === undefined ? {} : { summary: data.summary }),
    ...(data.venue === undefined ? {} : { venue: data.venue }),
    ...(data.opening_hours === undefined
      ? {}
      : { opening_hours: data.opening_hours }),
    ...(data.closed_days === undefined
      ? {}
      : { closed_days: data.closed_days }),
    ...(data.attendance === undefined ? {} : { attendance: data.attendance }),
  };
}
export function serializeExhibitionsEditorDraft(
  draft: ExhibitionsEditorDraftState,
) {
  const original = parsed(draft.sourceRaw);
  if (
    original &&
    JSON.stringify(original.data) === JSON.stringify(draft.data) &&
    original.body === draft.body
  )
    return draft.sourceRaw;
  const body = draft.body ? `\n${draft.body.replace(/\s+$/, "")}\n` : "";
  return `---\n${stringify(ordered(editorExhibitionSchema.parse(draft.data)))}---\n${body}`;
}
