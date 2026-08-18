import { z } from "astro/zod";

export const ABOUT_LOCALES = ["ja", "en"] as const;
export const ABOUT_WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export const ABOUT_GALLERY_COUNT = 4 as const;
export const ABOUT_PLACEHOLDER_PREFIX = "__TODO_ABOUT_" as const;
export const ABOUT_ASSET_URLS = [
  "/images/about/about-hero.jpg",
  "/images/about/about-01.jpg",
  "/images/about/about-02.jpg",
  "/images/about/about-03.jpg",
  "/images/about/about-04.jpg",
] as const;

export const aboutPlaceholderMarkers = {
  ja: {
    statement: "__TODO_ABOUT_JA_STATEMENT__",
    address: "__TODO_ABOUT_JA_ADDRESS__",
    alts: [1, 2, 3, 4].map((slot) => `__TODO_ABOUT_JA_ALT_${slot}__`),
  },
  en: {
    statement: "__TODO_ABOUT_EN_STATEMENT__",
    address: "__TODO_ABOUT_EN_ADDRESS__",
    alts: [1, 2, 3, 4].map((slot) => `__TODO_ABOUT_EN_ALT_${slot}__`),
  },
} as const;

const nonEmpty = z.string().trim().min(1);
const publicAsset = nonEmpty.startsWith("/");
const email = nonEmpty.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const externalUrl = nonEmpty.refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !value.includes("...") &&
      !/\b(?:xxxxx|example)\b/i.test(value) &&
      !/^https?:\/\/(?:www\.)?instagram\.com\/?$/i.test(value)
    );
  } catch {
    return false;
  }
}, "approved external URL required");
const weekday = z.enum(ABOUT_WEEKDAYS);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const orderedUniqueDays = z
  .array(weekday)
  .min(1)
  .superRefine((days, context) => {
    if (new Set(days).size !== days.length)
      context.addIssue({ code: "custom", message: "weekdays must be unique" });
    const positions = days.map((day) => ABOUT_WEEKDAYS.indexOf(day));
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

const pendingHoursSchema = z.object({ status: z.literal("pending") }).strict();
const approvedHoursSchema = z
  .object({
    status: z.literal("approved"),
    timezone: z.literal("Asia/Tokyo"),
    open_days: orderedUniqueDays,
    opens: time,
    closes: time,
    closed_days: orderedUniqueDays,
  })
  .strict()
  .superRefine((hours, context) => {
    if (hours.opens >= hours.closes)
      context.addIssue({
        code: "custom",
        message: "opens must be before closes",
      });
    const open = new Set(hours.open_days);
    const closed = new Set(hours.closed_days);
    if (hours.open_days.some((day) => closed.has(day)))
      context.addIssue({
        code: "custom",
        message: "open and closed days overlap",
      });
    if (
      ABOUT_WEEKDAYS.some((day) => !open.has(day) && !closed.has(day)) ||
      open.size + closed.size !== ABOUT_WEEKDAYS.length
    )
      context.addIssue({
        code: "custom",
        message: "hours must cover every weekday",
      });
  });

export const aboutHoursSchema = z.discriminatedUnion("status", [
  pendingHoursSchema,
  approvedHoursSchema,
]);

export const aboutSharedSchema = z
  .object({
    images: z
      .object({
        hero: z.object({ src: publicAsset }).strict(),
        gallery: z
          .array(z.object({ src: publicAsset }).strict())
          .length(ABOUT_GALLERY_COUNT)
          .superRefine((images, context) => {
            if (new Set(images.map(({ src }) => src)).size !== images.length)
              context.addIssue({
                code: "custom",
                message: "gallery sources must be unique",
              });
          }),
      })
      .strict(),
    hours: aboutHoursSchema,
    contact: z
      .object({
        email: email.optional(),
        map_url: externalUrl.optional(),
        instagram_url: externalUrl.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const containsAboutPlaceholder = (value: string) =>
  /__TODO_ABOUT_[A-Z0-9_]+__/.test(value);

export const aboutLocalizedFrontmatterSchema = z
  .object({
    content_status: z.enum(["placeholder", "review", "approved"]),
    address: nonEmpty,
    images: z
      .object({
        gallery: z
          .array(z.object({ alt: nonEmpty }).strict())
          .length(ABOUT_GALLERY_COUNT),
      })
      .strict(),
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.content_status === "placeholder") return;
    const candidates = [
      value.address,
      ...value.images.gallery.map(({ alt }) => alt),
    ];
    if (candidates.some(containsAboutPlaceholder))
      context.addIssue({
        code: "custom",
        message: "review/approved content cannot contain placeholders",
      });
  });

export type AboutHours = z.infer<typeof aboutHoursSchema>;
export type AboutShared = z.infer<typeof aboutSharedSchema>;
export type AboutLocalizedFrontmatter = z.infer<
  typeof aboutLocalizedFrontmatterSchema
>;
export type AboutLocale = (typeof ABOUT_LOCALES)[number];
