import { z } from "astro/zod";

export const HOME_LOCALES = ["ja", "en"] as const;
export const HOME_DESTINATIONS = ["artists", "about"] as const;
export const HOME_EN_ABOUT_INTRO_PLACEHOLDER =
  "__TODO_HOME_EN_ABOUT_INTRO__" as const;

const nonEmpty = z.string().trim().min(1);
const absoluteAssetPath = nonEmpty.startsWith("/");

export const homeSharedSchema = z
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
              .object({
                src: z.literal("/images/home/artists-square.jpg"),
              })
              .strict(),
          })
          .strict(),
        about: z
          .object({
            destination: z.literal("about"),
            image: z
              .object({
                src: z.literal("/images/home/about-landscape.jpg"),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const homeLocalizedSchema = z
  .object({
    about_intro: nonEmpty,
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();

export type HomeShared = z.infer<typeof homeSharedSchema>;
export type HomeLocalized = z.infer<typeof homeLocalizedSchema>;
export type HomeLocale = (typeof HOME_LOCALES)[number];
