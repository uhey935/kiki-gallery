import { TextDecoder } from "node:util";
import { parseDocument, stringify } from "yaml";
import { editorExhibitionSchema } from "../../content-schemas/exhibition.ts";
import { exhibitionLocalizedSchema, exhibitionSharedSchema } from "./schema.ts";

export const EXHIBITIONS_MIGRATION_VERSION = 1 as const;
export const EXHIBITIONS_EN_PLACEHOLDERS = {
  title: "__TODO_EN_TITLE__",
  hero_alt: "__TODO_EN_HERO_ALT__",
  body: "__TODO_EN_BODY__",
} as const;
const LEGACY_FIELDS = new Set([
  "artists",
  "works",
  "hero",
  "start_date",
  "end_date",
  "display_artists",
  "title",
  "summary",
  "venue",
  "opening_hours",
  "closed_days",
  "attendance",
  "hero_alt",
]);
export type ExhibitionMappingEvidence = {
  sourceField: string | null;
  destination: "index.yaml" | "ja.md" | "en.md";
  targetField: string;
  strategy:
    | "copy"
    | "body-byte-copy"
    | "explicit-placeholder-no-translation"
    | "absent-no-generation";
};
export type ConvertedExhibitionFiles = {
  shared: string;
  ja: string;
  en: string;
  bodyBase64: string;
  fieldMapping: ExhibitionMappingEvidence[];
};
function markdown(frontmatter: object, body = "") {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body}`;
}
export function convertLegacyExhibitionMarkdown(
  bytes: Buffer,
  source: string,
): ConvertedExhibitionFiles {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: source is not valid UTF-8`);
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${source}: malformed Markdown frontmatter`);
  const document = parseDocument(match[1], { strict: true, uniqueKeys: true });
  if (document.errors.length)
    throw new Error(`${source}: ${document.errors[0].message}`);
  const candidate = document.toJS() as Record<string, unknown>;
  const unknown = Object.keys(candidate).filter(
    (field) => !LEGACY_FIELDS.has(field),
  );
  if (unknown.length)
    throw new Error(`${source}: unknown fields: ${unknown.join(", ")}`);
  const legacy = editorExhibitionSchema.safeParse(candidate);
  if (!legacy.success || !legacy.data.title)
    throw new Error(
      `${source}: invalid legacy Exhibition or missing explicit title`,
    );
  const hero = legacy.data.hero;
  const shared = exhibitionSharedSchema.parse({
    artists: legacy.data.artists.map(({ id }) => id),
    ...(legacy.data.works
      ? { works: legacy.data.works.map(({ id }) => id) }
      : {}),
    start_date: legacy.data.start_date.toISOString().slice(0, 10),
    end_date: legacy.data.end_date.toISOString().slice(0, 10),
    ...(legacy.data.display_artists === undefined
      ? {}
      : { display_artists: legacy.data.display_artists }),
    hero: {
      image: hero.image,
      orientation: hero.orientation,
      ...(hero.position ? { position: hero.position } : {}),
      ...(hero.treatment ? { treatment: hero.treatment } : {}),
    },
  });
  const localized = exhibitionLocalizedSchema.parse({
    title: legacy.data.title,
    ...(legacy.data.summary ? { summary: legacy.data.summary } : {}),
    ...(legacy.data.venue ? { venue: legacy.data.venue } : {}),
    ...(legacy.data.opening_hours
      ? { opening_hours: legacy.data.opening_hours }
      : {}),
    ...(legacy.data.closed_days
      ? { closed_days: legacy.data.closed_days }
      : {}),
    ...(legacy.data.attendance ? { attendance: legacy.data.attendance } : {}),
    hero_alt: legacy.data.hero_alt,
    ...(hero.hero_caption ? { hero_caption: hero.hero_caption } : {}),
  });
  const body = match[2];
  const en = exhibitionLocalizedSchema.parse({
    title: EXHIBITIONS_EN_PLACEHOLDERS.title,
    hero_alt: EXHIBITIONS_EN_PLACEHOLDERS.hero_alt,
  });
  const copied = [
    "title",
    "summary",
    "venue",
    "opening_hours",
    "closed_days",
    "attendance",
    "hero_alt",
    "hero_caption",
  ]
    .filter((field) => field in localized)
    .map((targetField) => ({
      sourceField:
        targetField === "hero_caption" ? "hero.hero_caption" : targetField,
      destination: "ja.md" as const,
      targetField,
      strategy: "copy" as const,
    }));
  return {
    shared: stringify(shared),
    ja: markdown(localized, body),
    en: markdown(en, body ? EXHIBITIONS_EN_PLACEHOLDERS.body : ""),
    bodyBase64: Buffer.from(body).toString("base64"),
    fieldMapping: [
      ...[
        "artists",
        "works",
        "start_date",
        "end_date",
        "display_artists",
        "hero.image",
        "hero.orientation",
        "hero.position",
        "hero.treatment",
      ]
        .filter(
          (field) =>
            field
              .split(".")
              .reduce<unknown>(
                (v, k) =>
                  typeof v === "object" && v
                    ? (v as Record<string, unknown>)[k]
                    : undefined,
                shared,
              ) !== undefined,
        )
        .map((targetField) => ({
          sourceField: targetField,
          destination: "index.yaml" as const,
          targetField,
          strategy: "copy" as const,
        })),
      ...copied,
      {
        sourceField: "Markdown body",
        destination: "ja.md",
        targetField: "Markdown body",
        strategy: "body-byte-copy",
      },
      {
        sourceField: null,
        destination: "en.md",
        targetField: "title",
        strategy: "explicit-placeholder-no-translation",
      },
      {
        sourceField: null,
        destination: "en.md",
        targetField: "hero_alt",
        strategy: "explicit-placeholder-no-translation",
      },
      ...(body
        ? [
            {
              sourceField: null,
              destination: "en.md" as const,
              targetField: "Markdown body",
              strategy: "explicit-placeholder-no-translation" as const,
            },
          ]
        : []),
      {
        sourceField: null,
        destination: "ja.md",
        targetField: "seo_title",
        strategy: "absent-no-generation",
      },
      {
        sourceField: null,
        destination: "ja.md",
        targetField: "description",
        strategy: "absent-no-generation",
      },
    ],
  };
}
