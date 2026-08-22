import { z } from "astro/zod";

export const HOME_MIGRATION_V1_EN_ABOUT_INTRO_PLACEHOLDER =
  "__TODO_HOME_EN_ABOUT_INTRO__" as const;
export const HOME_MIGRATION_V1_JA_ABOUT_INTRO_TEMPORARY_MARKER =
  "__TODO_HOME_JA_ABOUT_INTRO__" as const;
export const HOME_MIGRATION_V1_JA_ABOUT_INTRO_TEMPORARY_COPY =
  "KiKi Galleryは、現代美術を中心に紹介するアートギャラリーです。" as const;

const nonEmpty = z.string().trim().min(1);
const absoluteAssetPath = nonEmpty.startsWith("/");

export const homeMigrationV1SharedSchema = z
  .object({
    home_hero: z
      .object({
        media: z.discriminatedUnion("type", [
          z
            .object({ type: z.literal("image"), image: absoluteAssetPath })
            .strict(),
          z
            .object({
              type: z.literal("video"),
              video: absoluteAssetPath,
              poster: absoluteAssetPath.optional(),
            })
            .strict(),
        ]),
      })
      .strict()
      .optional(),
    sections: z
      .object({
        artists: z
          .object({
            destination: z.literal("artists"),
            image: z
              .object({ src: z.literal("/images/home/artists-square.jpg") })
              .strict(),
          })
          .strict(),
        about: z
          .object({
            destination: z.literal("about"),
            image: z
              .object({ src: z.literal("/images/home/about-landscape.jpg") })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const homeMigrationV1LocalizedSchema = z
  .object({
    about_intro: nonEmpty,
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();
