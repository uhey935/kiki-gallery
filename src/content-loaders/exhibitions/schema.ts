import { z } from "astro/zod";

export const EXHIBITION_LOCALES = ["ja", "en"] as const;
const nonEmpty = z.string().min(1);
const contentId = nonEmpty.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const exhibitionSharedSchema = z
  .object({
    artists: z.array(contentId).min(1),
    works: z.array(contentId).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    display_artists: z.boolean().optional(),
    hero: z
      .object({
        image: nonEmpty,
        orientation: z.enum(["portrait", "landscape"]),
        position: z
          .enum(["top", "center", "bottom", "left", "right"])
          .optional(),
        treatment: z.enum(["default", "contain", "cover"]).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["artists", value.artists],
      ["works", value.works ?? []],
    ] as const) {
      const seen = new Set<string>();
      values.forEach((id, index) => {
        if (seen.has(id))
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: `${field} must be unique.`,
          });
        seen.add(id);
      });
    }
    if (value.end_date < value.start_date)
      context.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "end_date must not precede start_date.",
      });
  });

export const exhibitionLocalizedSchema = z
  .object({
    title: nonEmpty,
    summary: nonEmpty.optional(),
    venue: nonEmpty.optional(),
    opening_hours: nonEmpty.optional(),
    closed_days: nonEmpty.optional(),
    attendance: nonEmpty.optional(),
    hero_alt: nonEmpty,
    hero_caption: nonEmpty.optional(),
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();

export type ExhibitionShared = z.infer<typeof exhibitionSharedSchema>;
export type ExhibitionLocalized = z.infer<typeof exhibitionLocalizedSchema>;
export type ExhibitionLocale = (typeof EXHIBITION_LOCALES)[number];
