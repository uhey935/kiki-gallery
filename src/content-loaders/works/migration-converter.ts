import { TextDecoder } from "node:util";
import { parseDocument, stringify } from "yaml";
import { editorWorkSchema } from "../../content-schemas/work.ts";
import {
  validateImageAlignment,
  workLocalizedSchema,
  workSharedSchema,
} from "./schema.ts";

export const WORKS_MIGRATION_VERSION = 1 as const;
export const WORK_PLACEHOLDERS = {
  title: "__TODO_WORK_TITLE__",
  material: "__TODO_WORK_MATERIAL__",
  size: "__TODO_WORK_SIZE__",
  body: "__TODO_WORK_BODY__",
  alt: (index: number) => `__TODO_WORK_IMAGE_ALT_${index + 1}__`,
} as const;
const allowed = new Set([
  "title",
  "artist",
  "images",
  "year",
  "orientation",
  "inquiry",
  "material",
  "size",
  "seo_title",
  "description",
]);
function split(bytes: Buffer, source: string) {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: invalid UTF-8`);
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${source}: malformed frontmatter`);
  return { frontmatter: match[1], body: match[2] };
}
function localeFile(data: unknown, body: string) {
  return `---\n${stringify(data).trimEnd()}\n---\n${body}`;
}
export function convertLegacyWorkMarkdown(sourceBytes: Buffer, source: string) {
  const sourceParts = split(sourceBytes, source);
  const document = parseDocument(sourceParts.frontmatter, {
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length)
    throw new Error(`${source}: ${document.errors[0].message}`);
  const raw = document.toJS() as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`${source}: unknown fields: ${unknown.join(", ")}`);
  const legacy = editorWorkSchema.parse(raw);
  const artist =
    typeof legacy.artist === "string" ? legacy.artist : legacy.artist.id;
  const shared = workSharedSchema.parse({
    artist,
    images: legacy.images.map(({ src }) => ({ src })),
    ...(legacy.year ? { year: legacy.year } : {}),
    ...(legacy.orientation ? { orientation: legacy.orientation } : {}),
    inquiry: legacy.inquiry,
  });
  const ja = workLocalizedSchema.parse({
    title: legacy.title,
    images: legacy.images.map(({ alt }) => ({ alt })),
    ...(legacy.material ? { material: legacy.material } : {}),
    ...(legacy.size ? { size: legacy.size } : {}),
    ...(legacy.seo_title ? { seo_title: legacy.seo_title } : {}),
    ...(legacy.description ? { description: legacy.description } : {}),
  });
  const en = workLocalizedSchema.parse({
    title: WORK_PLACEHOLDERS.title,
    images: legacy.images.map((_, i) => ({ alt: WORK_PLACEHOLDERS.alt(i) })),
    ...(legacy.material ? { material: WORK_PLACEHOLDERS.material } : {}),
    ...(legacy.size ? { size: WORK_PLACEHOLDERS.size } : {}),
  });
  validateImageAlignment(shared, ja);
  validateImageAlignment(shared, en);
  return {
    shared: stringify(shared),
    ja: localeFile(ja, sourceParts.body),
    en: localeFile(
      en,
      sourceParts.body.trim().length ? WORK_PLACEHOLDERS.body : "",
    ),
    body: {
      sourceBase64: Buffer.from(sourceParts.body).toString("base64"),
      byteLength: Buffer.byteLength(sourceParts.body),
      empty: sourceParts.body.length === 0,
    },
    mapping: {
      artist,
      imageSlots: legacy.images.map((image, index) => ({
        index,
        src: image.src,
        jaAlt: image.alt,
        enAlt: WORK_PLACEHOLDERS.alt(index),
      })),
      size: legacy.size,
      material: legacy.material,
    },
  };
}
