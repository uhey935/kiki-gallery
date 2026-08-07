import { z } from "astro/zod";

export const NEWS_TYPES = ["exhibition", "artist", "general"] as const;

const nonEmpty = z.string().min(1);
const internalPath = z.string().startsWith("/");
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => /^https?:\/\//.test(value),
    "Must use an http:// or https:// URL.",
  );

export const newsSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD.")
      .refine((value) => {
        const [year, month, day] = value.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        return (
          date.getUTCFullYear() === year &&
          date.getUTCMonth() === month - 1 &&
          date.getUTCDate() === day
        );
      }, "Must be a valid date."),
    news_type: z.enum(NEWS_TYPES),
    title: nonEmpty,
    summary: nonEmpty.optional(),
    link: z.union([httpUrl, internalPath]).optional(),
    show_on_home: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.show_on_home && !value.link)
      context.addIssue({
        code: "custom",
        path: ["link"],
        message: "Home-visible News requires a link.",
      });
  });

export type NewsData = z.infer<typeof newsSchema>;
