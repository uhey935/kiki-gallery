import { z } from "astro/zod";

export const WORK_LOCALES = ["ja", "en"] as const;
export type WorkLocale = (typeof WORK_LOCALES)[number];
const text = z.string().trim().min(1);
const publicUrl = text.regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/);
const inquiry = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("inquiry"), url: z.string().min(1).optional() })
    .strict(),
  z.object({ type: z.literal("shop"), url: z.string().min(1) }).strict(),
  z.object({ type: z.literal("none") }).strict(),
]);

export const workSharedSchema = z
  .object({
    artist: text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    images: z.array(z.object({ src: publicUrl }).strict()).min(1),
    year: z.number().int().positive().optional(),
    orientation: z.literal("landscape").optional(),
    inquiry,
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.images.forEach((image, index) => {
      if (seen.has(image.src))
        context.addIssue({
          code: "custom",
          path: ["images", index, "src"],
          message: "Duplicate Work image src.",
        });
      seen.add(image.src);
    });
  });

export const workLocalizedSchema = z
  .object({
    title: text,
    images: z.array(z.object({ alt: text }).strict()).min(1),
    material: text.optional(),
    size: text.optional(),
    seo_title: text.optional(),
    description: text.optional(),
  })
  .strict();

export type WorkShared = z.infer<typeof workSharedSchema>;
export type WorkLocalized = z.infer<typeof workLocalizedSchema>;

export function validateImageAlignment(
  shared: WorkShared,
  localized: WorkLocalized,
) {
  if (shared.images.length !== localized.images.length)
    throw new Error(
      `Localized alt count ${localized.images.length} does not match shared image count ${shared.images.length}`,
    );
}
