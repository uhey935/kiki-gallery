import { z } from "astro/zod";

export const ARTIST_LOCALES = ["ja", "en"] as const;

const nonEmpty = z.string().min(1);
const contentId = nonEmpty.regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Must contain lowercase alphanumeric segments separated by hyphens.",
);
const taxonomyTerm = nonEmpty.regex(
  /^[\x20-\x7e]+$/,
  "Must use a canonical ASCII taxonomy term.",
);

const workLayout = z
  .object({
    layout: z.enum(["single-a", "single-b", "double-a", "double-b"]),
    works: z.array(contentId),
  })
  .strict()
  .superRefine((section, context) => {
    const expected = section.layout.startsWith("single-") ? 1 : 2;
    if (section.works.length !== expected)
      context.addIssue({
        code: "custom",
        path: ["works"],
        message: `${section.layout} requires exactly ${expected} works.`,
      });
  });

export const artistIdentitySchema = z
  .object({
    sort_name: nonEmpty,
    hero: z.object({ image: nonEmpty }).strict(),
    works_layout: z.array(workLayout).optional(),
    medium: z.array(taxonomyTerm).min(1),
  })
  .strict()
  .superRefine((artist, context) => {
    const seen = new Set<string>();
    artist.works_layout?.forEach((section, sectionIndex) => {
      section.works.forEach((workId, workIndex) => {
        if (seen.has(workId))
          context.addIssue({
            code: "custom",
            path: ["works_layout", sectionIndex, "works", workIndex],
            message: `Work ${workId} must not appear more than once.`,
          });
        seen.add(workId);
      });
    });
  });

export const artistLocalizedSchema = z
  .object({
    name: nonEmpty,
    medium_label: nonEmpty,
    short_bio: nonEmpty,
    biography: nonEmpty.optional(),
    hero_alt: nonEmpty,
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();

/** Frozen 2026-08-11 migration output shape; not a runtime compatibility path. */
export const historicalArtistLocalizedSchema = artistLocalizedSchema.omit({
  medium_label: true,
});

export type ArtistIdentity = z.infer<typeof artistIdentitySchema>;
export type ArtistLocalized = z.infer<typeof artistLocalizedSchema>;
export type HistoricalArtistLocalized = z.infer<
  typeof historicalArtistLocalizedSchema
>;
export type ArtistLocale = (typeof ARTIST_LOCALES)[number];
