import { z } from "astro/zod";

const JOURNAL_CATEGORIES = ["interview", "essay", "report"] as const;
const LOCALES = ["ja", "en"] as const;

const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must contain only lowercase alphanumeric segments separated by hyphens.",
  );

const nonEmptyStringSchema = z.string().min(1);

export const journalCategorySchema = z.enum(JOURNAL_CATEGORIES);

export const journalDateSchema = z
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

const journalHeroSchema = z
  .object({
    image: nonEmptyStringSchema,
    hero_caption: nonEmptyStringSchema.optional(),
  })
  .strict();

export const journalSharedSchema = z
  .object({
    date: journalDateSchema,
    category: journalCategorySchema,
    hero: journalHeroSchema,
    visibility: z.enum(["public", "hidden"]),
  })
  .strict();

export const journalLocalizedSchema = z
  .object({
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    hero_alt: nonEmptyStringSchema,
  })
  .strict();

export const journalSchema = journalSharedSchema.safeExtend({
  contentId: slugSchema,
  locale: z.enum(LOCALES),
  ...journalLocalizedSchema.shape,
});

export type JournalShared = z.infer<typeof journalSharedSchema>;
export type JournalCategory = z.infer<typeof journalCategorySchema>;
export type JournalLocalized = z.infer<typeof journalLocalizedSchema>;
export type JournalEntryData = z.infer<typeof journalSchema>;
