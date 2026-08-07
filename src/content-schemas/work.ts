import { z } from "astro/zod";

const nonEmptyStringSchema = z.string().min(1);
const internalPathSchema = z.string().startsWith("/");
const linkSchema = z.union([z.string().url(), internalPathSchema]);

const workArtistReferenceValueSchema = z.object({
  id: z.string().min(1),
  collection: z.literal("artists"),
});

export const workArtistReferenceSchema = z.union([
  z
    .string()
    .min(1)
    .transform((id) => ({ id, collection: "artists" as const })),
  workArtistReferenceValueSchema,
]);

export function createWorkSchema<T extends z.ZodType>(artistReference: T) {
  const workImageSchema = z
    .object({
      src: nonEmptyStringSchema,
      alt: nonEmptyStringSchema,
    })
    .strict();

  const inquirySchema = z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("inquiry"),
        url: linkSchema.optional(),
      })
      .strict(),
    z.object({ type: z.literal("shop"), url: linkSchema }).strict(),
    z.object({ type: z.literal("none") }).strict(),
  ]);

  return z
    .object({
      artist: artistReference,
      images: z.array(workImageSchema).min(1),
      year: z.number().int().positive().optional(),
      size: nonEmptyStringSchema.optional(),
      inquiry: inquirySchema,
      orientation: z.literal("landscape").optional(),
      title: nonEmptyStringSchema,
      material: nonEmptyStringSchema.optional(),
      seo_title: nonEmptyStringSchema.optional(),
      description: nonEmptyStringSchema.optional(),
    })
    .strict()
    .superRefine((work, context) => {
      const seenImagePaths = new Set<string>();
      work.images.forEach((image, index) => {
        if (seenImagePaths.has(image.src)) {
          context.addIssue({
            code: "custom",
            path: ["images", index, "src"],
            message: `Duplicate Work image path: ${image.src}.`,
          });
        }
        seenImagePaths.add(image.src);
      });
    });
}

export const editorWorkSchema = createWorkSchema(workArtistReferenceSchema);
export type WorkData = z.infer<typeof editorWorkSchema>;
