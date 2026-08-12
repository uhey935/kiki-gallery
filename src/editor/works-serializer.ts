import { parse, stringify } from "yaml";

import { editorWorkSchema, type WorkData } from "../content-schemas/work.ts";
import type { WorksEditorDraftState } from "./works-draft-state.ts";
import {
  workLocalizedSchema,
  workSharedSchema,
} from "../content-loaders/works/schema.ts";

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

export type SerializedWorksUnit = { shared: string; ja: string; en: string };
const markdown = (data: unknown, body: string) =>
  `---\n${stringify(data).trimEnd()}\n---\n${body ? `${body.replace(/\s+$/, "")}\n` : ""}`;

export function serializeWorksEditorUnit(
  draft: WorksEditorDraftState,
): SerializedWorksUnit {
  if (!draft.localized)
    throw new Error("Three-file localized Works Draft is required");
  const shared = workSharedSchema.parse({
    artist: draft.data.artist.id,
    images: draft.data.images.map((image) => ({ src: image.src })),
    ...(draft.data.year ? { year: draft.data.year } : {}),
    ...(draft.data.orientation ? { orientation: draft.data.orientation } : {}),
    inquiry: draft.data.inquiry,
  });
  const jaBody = draft.body;
  const jaData = {
    title: draft.data.title,
    images: draft.data.images.map((image) => ({ alt: image.alt })),
    ...(draft.data.material ? { material: draft.data.material } : {}),
    ...(draft.data.size ? { size: draft.data.size } : {}),
    ...(draft.data.seo_title ? { seo_title: draft.data.seo_title } : {}),
    ...(draft.data.description ? { description: draft.data.description } : {}),
  };
  const { body: enBody, ...enData } = draft.localized.en;
  const ja = workLocalizedSchema.parse(jaData);
  const en = workLocalizedSchema.parse(enData);
  if (
    shared.images.length !== ja.images.length ||
    shared.images.length !== en.images.length
  )
    throw new Error("Works logical image slot count mismatch");
  return {
    shared: stringify(shared),
    ja: markdown(ja, jaBody),
    en: markdown(en, enBody),
  };
}
