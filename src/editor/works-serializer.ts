import { parse, stringify } from "yaml";

import { editorWorkSchema, type WorkData } from "../content-schemas/work.ts";
import type { WorksEditorDraftState } from "./works-draft-state.ts";

function parsedSource(
  raw: string,
): { data: WorkData; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) return undefined;
  const result = editorWorkSchema.safeParse(parse(match[1]));
  return result.success
    ? { data: result.data, body: match[2].trim() }
    : undefined;
}

function orderedWork(data: WorkData): Record<string, unknown> {
  return {
    title: data.title,
    artist: data.artist.id,
    images: data.images,
    ...(data.orientation === undefined
      ? {}
      : { orientation: data.orientation }),
    ...(data.size === undefined ? {} : { size: data.size }),
    ...(data.material === undefined ? {} : { material: data.material }),
    ...(data.year === undefined ? {} : { year: data.year }),
    inquiry: data.inquiry,
    ...(data.seo_title === undefined ? {} : { seo_title: data.seo_title }),
    ...(data.description === undefined
      ? {}
      : { description: data.description }),
  };
}

export function serializeWorksEditorDraft(
  draft: WorksEditorDraftState,
): string {
  // A clean draft is already canonical. Returning its source is what preserves
  // deliberate blank lines, scalar spelling, and the exact final newline.
  const original = parsedSource(draft.sourceRaw);
  if (
    original &&
    JSON.stringify(original.data) === JSON.stringify(draft.data) &&
    original.body === draft.body
  )
    return draft.sourceRaw;

  const body = draft.body ? `\n${draft.body.replace(/\s+$/, "")}\n` : "";
  return `---\n${stringify(orderedWork(draft.data))}---\n${body}`;
}
