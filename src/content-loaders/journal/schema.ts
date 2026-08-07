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

const creditSchema = z
  .object({
    role: nonEmptyStringSchema,
    person: slugSchema.optional(),
    member: slugSchema.optional(),
  })
  .strict()
  .superRefine((credit, context) => {
    const hasPerson = credit.person !== undefined;
    const hasMember = credit.member !== undefined;

    if (!hasPerson && !hasMember) {
      context.addIssue({
        code: "custom",
        path: ["person"],
        message: "Credit requires either person or member.",
      });
    }

    if (hasPerson && hasMember) {
      for (const field of ["person", "member"] as const) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Credit must not define both person and member.",
        });
      }
    }
  });

export const journalSharedSchema = z
  .object({
    date: journalDateSchema,
    categories: z.array(z.enum(JOURNAL_CATEGORIES)).min(1),
    hero: journalHeroSchema,
    author: slugSchema.optional(),
    credits: z.array(creditSchema).optional(),
    visibility: z.enum(["public", "hidden"]),
  })
  .strict()
  .superRefine((journal, context) => {
    if (journal.author !== undefined && journal.credits !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["author"],
        message: "Journal must not define both author and credits.",
      });
    }
  });

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
export type JournalLocalized = z.infer<typeof journalLocalizedSchema>;
export type JournalEntryData = z.infer<typeof journalSchema>;
