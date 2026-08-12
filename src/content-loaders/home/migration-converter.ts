import { TextDecoder } from "node:util";
import { parseDocument, stringify } from "yaml";
import { homeSchema } from "../../content-schemas/home.ts";
import {
  HOME_EN_ABOUT_INTRO_PLACEHOLDER,
  HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER,
  homeLocalizedSchema,
  homeSharedSchema,
} from "./schema.ts";

export const HOME_MIGRATION_VERSION = 1 as const;
const legacyFields = new Set(["home_hero", "sections", "title", "description"]);

export type HomeMigrationInput = {
  jaAboutIntro: string;
  jaTemporary?: boolean;
  enAboutIntro?: string;
};

export type ConvertedHomeFiles = {
  shared: string;
  ja: string;
  en: string;
  enPlaceholder: boolean;
  jaTemporary: boolean;
  mapping: Array<{
    sourceField: string | null;
    destination: "index.yaml" | "ja.md" | "en.md";
    targetField: string;
    strategy: "map" | "human-input" | "reserved-placeholder" | "absent";
  }>;
};

const markdown = (frontmatter: object) =>
  `---\n${stringify(frontmatter).trimEnd()}\n---\n`;
const temporaryJaMarkdown = (frontmatter: object) =>
  `---\n# ${HOME_JA_ABOUT_INTRO_TEMPORARY_MARKER}\n${stringify(frontmatter).trimEnd()}\n---\n`;

export function convertLegacyHomeMarkdown(
  bytes: Buffer,
  source: string,
  input: HomeMigrationInput,
): ConvertedHomeFiles {
  if (!input.jaAboutIntro.trim())
    throw new Error("Human-approved JA about_intro is required");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${source}: source is not valid UTF-8`);
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match || match[2].trim())
    throw new Error(`${source}: malformed frontmatter or unexpected body`);
  const document = parseDocument(match[1], { strict: true, uniqueKeys: true });
  if (document.errors.length) throw new Error(`${source}: invalid YAML`);
  const candidate = document.toJS() as Record<string, unknown>;
  const unknown = Object.keys(candidate).filter(
    (key) => !legacyFields.has(key),
  );
  if (unknown.length)
    throw new Error(`${source}: unknown fields: ${unknown.join(", ")}`);
  const hero = candidate.home_hero as Record<string, unknown> | undefined;
  if (hero && "layout" in hero)
    throw new Error(`${source}: obsolete home_hero.layout is not migratable`);
  const legacy = homeSchema.parse(candidate);
  const byId = new Map(legacy.sections.map((section) => [section.id, section]));
  const artists = byId.get("artists");
  const about = byId.get("about");
  if (
    artists?.title !== "Artists" ||
    artists.href !== "/artists" ||
    artists.image.src !== "/images/home/artists-square.jpg" ||
    about?.title !== "About" ||
    about.href !== "/about" ||
    about.image.src !== "/images/home/about-landscape.jpg"
  )
    throw new Error(`${source}: Home fixed composition mapping mismatch`);
  const shared = homeSharedSchema.parse({
    ...(legacy.home_hero
      ? { home_hero: { media: legacy.home_hero.media } }
      : {}),
    sections: {
      artists: { destination: "artists", image: { src: artists.image.src } },
      about: { destination: "about", image: { src: about.image.src } },
    },
  });
  const ja = homeLocalizedSchema.parse({
    about_intro: input.jaAboutIntro,
    ...(legacy.title ? { seo_title: legacy.title } : {}),
    ...(legacy.description ? { description: legacy.description } : {}),
  });
  const enPlaceholder = !input.enAboutIntro?.trim();
  const en = homeLocalizedSchema.parse({
    about_intro: enPlaceholder
      ? HOME_EN_ABOUT_INTRO_PLACEHOLDER
      : input.enAboutIntro,
  });
  return {
    shared: stringify(shared),
    ja: input.jaTemporary ? temporaryJaMarkdown(ja) : markdown(ja),
    en: markdown(en),
    enPlaceholder,
    jaTemporary: input.jaTemporary === true,
    mapping: [
      {
        sourceField: "sections[artists/about]",
        destination: "index.yaml",
        targetField: "sections",
        strategy: "map",
      },
      {
        sourceField: "home_hero.media",
        destination: "index.yaml",
        targetField: "home_hero.media",
        strategy: legacy.home_hero ? "map" : "absent",
      },
      {
        sourceField: null,
        destination: "ja.md",
        targetField: "about_intro",
        strategy: input.jaTemporary ? "reserved-placeholder" : "human-input",
      },
      {
        sourceField: "title",
        destination: "ja.md",
        targetField: "seo_title",
        strategy: legacy.title ? "map" : "absent",
      },
      {
        sourceField: "description",
        destination: "ja.md",
        targetField: "description",
        strategy: legacy.description ? "map" : "absent",
      },
      {
        sourceField: null,
        destination: "en.md",
        targetField: "about_intro",
        strategy: enPlaceholder ? "reserved-placeholder" : "human-input",
      },
    ],
  };
}
