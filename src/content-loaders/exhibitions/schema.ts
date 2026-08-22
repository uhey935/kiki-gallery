import { z } from "astro/zod";

export const EXHIBITION_LOCALES = ["ja", "en"] as const;
export const EXHIBITION_WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
const nonEmpty = z.string().min(1);
const contentId = nonEmpty.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const weekday = z.enum(EXHIBITION_WEEKDAYS);
const closedWeekdays = z.array(weekday).superRefine((days, context) => {
  if (new Set(days).size !== days.length)
    context.addIssue({ code: "custom", message: "weekdays must be unique" });
  const positions = days.map((day) => EXHIBITION_WEEKDAYS.indexOf(day));
  if (
    positions.some(
      (position, index) => index > 0 && position <= positions[index - 1],
    )
  )
    context.addIssue({
      code: "custom",
      message: "weekdays must use canonical order",
    });
});
const openingHours = z
  .object({ opens: time, closes: time })
  .strict()
  .superRefine((hours, context) => {
    if (hours.opens >= hours.closes)
      context.addIssue({
        code: "custom",
        path: ["closes"],
        message: "opens must be before closes",
      });
  });

export const exhibitionSharedSchema = z
  .object({
    artists: z.array(contentId).min(1),
    works: z.array(contentId).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    display_artists: z.boolean().optional(),
    opening_hours: openingHours.optional(),
    closed_weekdays: closedWeekdays.optional(),
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
    venue: nonEmpty.optional(),
    attendance: nonEmpty.optional(),
    hero_alt: nonEmpty,
    hero_caption: nonEmpty.optional(),
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();

export const exhibitionAstroEntrySchema = z.intersection(
  z.object({
    contentId,
    locale: z.enum(EXHIBITION_LOCALES),
  }),
  z.intersection(exhibitionSharedSchema, exhibitionLocalizedSchema),
);

export type ExhibitionShared = z.infer<typeof exhibitionSharedSchema>;
export type ExhibitionLocalized = z.infer<typeof exhibitionLocalizedSchema>;
export type ExhibitionLocale = (typeof EXHIBITION_LOCALES)[number];
export type ExhibitionWeekday = (typeof EXHIBITION_WEEKDAYS)[number];
