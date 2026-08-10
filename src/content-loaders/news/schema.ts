import { z } from "astro/zod";

export const NEWS_TYPES = ["exhibition", "artist", "general"] as const;
export const NEWS_LOCALES = ["ja", "en"] as const;

const nonEmptyStringSchema = z.string().min(1);

const contentIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must contain only lowercase alphanumeric segments separated by hyphens.",
  );

const internalPathSchema = z.string().startsWith("/");
const httpUrlSchema = z
  .url()
  .refine(
    (value) => /^https?:\/\//.test(value),
    "Must use an http:// or https:// URL.",
  );

export const newsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Must be a valid calendar date.");

export const newsSharedSchema = z
  .object({
    date: newsDateSchema,
    news_type: z.enum(NEWS_TYPES),
    link: z.union([httpUrlSchema, internalPathSchema]).optional(),
    show_on_home: z.boolean(),
  })
  .strict()
  .superRefine((news, context) => {
    if (news.show_on_home && !news.link) {
      context.addIssue({
        code: "custom",
        path: ["link"],
        message: "Home-visible News requires a link.",
      });
    }
  });

export const newsLocalizedSchema = z
  .object({
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema.optional(),
  })
  .strict();

export const newsEntrySchema = newsSharedSchema.safeExtend({
  contentId: contentIdSchema,
  locale: z.enum(NEWS_LOCALES),
  ...newsLocalizedSchema.shape,
});

export type NewsShared = z.infer<typeof newsSharedSchema>;
export type NewsLocalized = z.infer<typeof newsLocalizedSchema>;
export type NewsEntryData = z.infer<typeof newsEntrySchema>;
