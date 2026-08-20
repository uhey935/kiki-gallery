import { TextDecoder } from "node:util";
import { parseDocument, stringify } from "yaml";
import { editorArtistSchema } from "../../content-schemas/artist.ts";
import {
  artistIdentitySchema,
  historicalArtistLocalizedSchema,
  type ArtistIdentity,
  type HistoricalArtistLocalized,
} from "./schema.ts";

export const ARTISTS_MIGRATION_VERSION = 1 as const;

export const ARTISTS_EN_PLACEHOLDERS = {
  short_bio: "__TODO_EN_SHORT_BIO__",
  biography: "__TODO_EN_BIOGRAPHY__",
  hero_alt: "__TODO_EN_HERO_ALT__",
  seo_title: "__TODO_EN_SEO_TITLE__",
  description: "__TODO_EN_DESCRIPTION__",
} as const;

const LEGACY_FIELDS = new Set([
  "name",
  "display_name",
  "hero",
  "works_layout",
  "medium",
  "short_bio",
  "biography",
  "hero_alt",
  "seo_title",
  "description",
]);

export type ArtistFieldMappingEvidence = {
  sourceField: string | null;
  destination: "index.yaml" | "ja.md" | "en.md";
  targetField: string;
  strategy:
    | "copy"
    | "display-name-or-name-materialized"
    | "explicit-placeholder-no-translation";
};

export type ConvertedArtistFiles = {
  shared: string;
  ja: string;
  en: string;
  fieldMapping: ArtistFieldMappingEvidence[];
};

function decodeUtf8(bytes: Buffer, source: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: source is not valid UTF-8`);
  }
}

function splitLegacyMarkdown(bytes: Buffer, source: string) {
  const raw = decodeUtf8(bytes, source);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match)
    throw new Error(`${source}: malformed Markdown frontmatter delimiters`);
  const body = Buffer.from(match[2], "utf8");
  if (body.byteLength !== 0)
    throw new Error(`${source}: Artist Markdown body must be empty`);
  return { frontmatter: match[1], body };
}

function markdownFile(frontmatter: HistoricalArtistLocalized): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n`;
}

function copy(
  sourceField: string,
  destination: "index.yaml" | "ja.md" | "en.md",
  targetField = sourceField,
): ArtistFieldMappingEvidence {
  return { sourceField, destination, targetField, strategy: "copy" };
}

export function convertLegacyArtistMarkdown(
  sourceBytes: Buffer,
  source: string,
): ConvertedArtistFiles {
  const { frontmatter } = splitLegacyMarkdown(sourceBytes, source);
  const document = parseDocument(frontmatter, {
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length)
    throw new Error(`${source}: ${document.errors[0].message}`);
  const raw = document.toJS() as Record<string, unknown>;
  const unknownFields = Object.keys(raw).filter(
    (field) => !LEGACY_FIELDS.has(field),
  );
  if (unknownFields.length)
    throw new Error(
      `${source}: unknown legacy Artist fields: ${unknownFields.join(", ")}`,
    );

  const legacy = editorArtistSchema.safeParse(raw);
  if (!legacy.success)
    throw new Error(
      `${source}: invalid legacy Artist: ${legacy.error.message}`,
    );

  const sharedCandidate = {
    sort_name: legacy.data.name,
    hero: legacy.data.hero,
    ...(legacy.data.works_layout
      ? {
          works_layout: legacy.data.works_layout.map((section) => ({
            layout: section.layout,
            works: section.works.map((work) => work.id),
          })),
        }
      : {}),
    medium: legacy.data.medium,
  };
  const jaCandidate = {
    name: legacy.data.display_name ?? legacy.data.name,
    short_bio: legacy.data.short_bio,
    ...(legacy.data.biography ? { biography: legacy.data.biography } : {}),
    hero_alt: legacy.data.hero_alt,
    ...(legacy.data.seo_title ? { seo_title: legacy.data.seo_title } : {}),
    ...(legacy.data.description
      ? { description: legacy.data.description }
      : {}),
  };
  const enCandidate = {
    name: legacy.data.name,
    short_bio: ARTISTS_EN_PLACEHOLDERS.short_bio,
    ...(legacy.data.biography
      ? { biography: ARTISTS_EN_PLACEHOLDERS.biography }
      : {}),
    hero_alt: ARTISTS_EN_PLACEHOLDERS.hero_alt,
    ...(legacy.data.seo_title
      ? { seo_title: ARTISTS_EN_PLACEHOLDERS.seo_title }
      : {}),
    ...(legacy.data.description
      ? { description: ARTISTS_EN_PLACEHOLDERS.description }
      : {}),
  };
  const shared = artistIdentitySchema.parse(sharedCandidate);
  const ja = historicalArtistLocalizedSchema.parse(jaCandidate);
  const en = historicalArtistLocalizedSchema.parse(enCandidate);

  const fieldMapping: ArtistFieldMappingEvidence[] = [
    copy("name", "index.yaml", "sort_name"),
    copy("hero.image", "index.yaml", "hero.image"),
    ...(legacy.data.works_layout ? [copy("works_layout", "index.yaml")] : []),
    copy("medium", "index.yaml"),
    {
      sourceField: legacy.data.display_name ? "display_name" : "name",
      destination: "ja.md",
      targetField: "name",
      strategy: "display-name-or-name-materialized",
    },
    copy("short_bio", "ja.md"),
    ...(legacy.data.biography ? [copy("biography", "ja.md")] : []),
    copy("hero_alt", "ja.md"),
    ...(legacy.data.seo_title ? [copy("seo_title", "ja.md")] : []),
    ...(legacy.data.description ? [copy("description", "ja.md")] : []),
    copy("name", "en.md"),
    ...(["short_bio", "hero_alt"] as const).map((targetField) => ({
      sourceField: null,
      destination: "en.md" as const,
      targetField,
      strategy: "explicit-placeholder-no-translation" as const,
    })),
    ...(["biography", "seo_title", "description"] as const)
      .filter((field) => legacy.data[field] !== undefined)
      .map((targetField) => ({
        sourceField: null,
        destination: "en.md" as const,
        targetField,
        strategy: "explicit-placeholder-no-translation" as const,
      })),
  ];

  return {
    shared: stringify(shared as ArtistIdentity),
    ja: markdownFile(ja),
    en: markdownFile(en),
    fieldMapping,
  };
}
