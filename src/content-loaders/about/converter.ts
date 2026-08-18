import { stringify } from "yaml";
import {
  ABOUT_ASSET_URLS,
  aboutLocalizedFrontmatterSchema,
  aboutPlaceholderMarkers,
  aboutSharedSchema,
  containsAboutPlaceholder,
  type AboutHours,
} from "./schema.ts";

export const ABOUT_MIGRATION_VERSION = 1 as const;

export type ApprovedAboutLocaleInput = {
  statement: string;
  address: string;
  alts: [string, string, string, string];
  seo_title?: string;
  description?: string;
};

export type AboutMigrationInput = {
  hours?: Exclude<AboutHours, { status: "pending" }>;
  ja?: ApprovedAboutLocaleInput;
  en?: ApprovedAboutLocaleInput;
  contact?: { email?: string; map_url?: string; instagram_url?: string };
};

const markdown = (frontmatter: object, body: string) =>
  `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;

function localeFile(locale: "ja" | "en", input?: ApprovedAboutLocaleInput) {
  const marker = aboutPlaceholderMarkers[locale];
  if (
    input &&
    (!input.statement.trim() || containsAboutPlaceholder(input.statement))
  )
    throw new Error(`${locale.toUpperCase()} approved statement is invalid`);
  const frontmatter = aboutLocalizedFrontmatterSchema.parse(
    input
      ? {
          content_status: "approved",
          address: input.address,
          images: { gallery: input.alts.map((alt) => ({ alt })) },
          ...(input.seo_title ? { seo_title: input.seo_title } : {}),
          ...(input.description ? { description: input.description } : {}),
        }
      : {
          content_status: "placeholder",
          address: marker.address,
          images: { gallery: marker.alts.map((alt) => ({ alt })) },
        },
  );
  return markdown(frontmatter, input?.statement ?? marker.statement);
}

export function planAboutMigration(input: AboutMigrationInput = {}) {
  const blockers = [
    ...(!input.hours ? ["approved hours required"] : []),
    ...(!input.ja ? ["approved JA content required"] : []),
    ...(!input.en ? ["approved EN content required"] : []),
  ];
  const shared = aboutSharedSchema.parse({
    images: {
      hero: { src: ABOUT_ASSET_URLS[0] },
      gallery: ABOUT_ASSET_URLS.slice(1).map((src) => ({ src })),
    },
    hours: input.hours ?? { status: "pending" },
    ...(input.contact && Object.keys(input.contact).length
      ? { contact: input.contact }
      : {}),
  });
  return {
    migrationVersion: ABOUT_MIGRATION_VERSION,
    status: blockers.length ? ("blocked" as const) : ("ready" as const),
    provisional: blockers.length > 0,
    blockers,
    files: {
      "index.yaml": stringify(shared),
      "ja.md": localeFile("ja", input.ja),
      "en.md": localeFile("en", input.en),
    },
  };
}
