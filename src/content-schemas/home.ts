import { z } from "astro/zod";

export const HOME_HERO_LAYOUTS = ["default", "portrait", "alternate"] as const;
export const HOME_MEDIA_TYPES = ["image", "video"] as const;
export const HOME_SECTION_IDS = ["artists", "about"] as const;

const nonEmpty = z.string().trim().min(1);
const imagePath = nonEmpty.startsWith("/");
const internalPath = nonEmpty.startsWith("/");
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => /^https?:\/\//.test(value),
    "Must use an http:// or https:// URL.",
  );
const link = z.union([httpUrl, internalPath]);

export const homeMediaSchema = z
  .object({
    type: z.enum(HOME_MEDIA_TYPES),
    image: imagePath.optional(),
    video: nonEmpty.optional(),
    poster: imagePath.optional(),
  })
  .strict()
  .superRefine((media, context) => {
    if (media.type === "image") {
      if (!media.image)
        context.addIssue({
          code: "custom",
          path: ["image"],
          message: "Image media requires image.",
        });
      for (const field of ["video", "poster"] as const)
        if (media[field] !== undefined)
          context.addIssue({
            code: "custom",
            path: [field],
            message: `Image media must not define ${field}.`,
          });
    } else {
      for (const field of ["video", "poster"] as const)
        if (!media[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: `Video media requires ${field}.`,
          });
      if (media.image !== undefined)
        context.addIssue({
          code: "custom",
          path: ["image"],
          message: "Video media must not define image.",
        });
    }
  });

export const homeSchema = z
  .object({
    home_hero: z
      .object({
        media: homeMediaSchema,
        layout: z.enum(HOME_HERO_LAYOUTS).optional(),
      })
      .strict()
      .optional(),
    sections: z
      .array(
        z
          .object({
            id: z.enum(HOME_SECTION_IDS),
            title: nonEmpty.regex(
              /^[\x20-\x7e]+$/,
              "Must use an English navigation term.",
            ),
            href: link,
            image: z
              .object({
                src: imagePath,
              })
              .strict(),
          })
          .strict(),
      )
      .length(2),
    title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict()
  .superRefine((home, context) => {
    const ids = home.sections.map(({ id }) => id);
    for (const id of HOME_SECTION_IDS) {
      const count = ids.filter((value) => value === id).length;
      if (count !== 1)
        context.addIssue({
          code: "custom",
          path: ["sections"],
          message: `Home requires exactly one ${id} section.`,
        });
    }
  });

export type HomeData = z.infer<typeof homeSchema>;
