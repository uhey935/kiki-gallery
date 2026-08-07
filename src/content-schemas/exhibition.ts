import { z } from "astro/zod";

const nonEmpty = z.string().min(1);
const referenceValue = (collection: "artists" | "works") =>
  z.union([
    nonEmpty.transform((id) => ({ id, collection })),
    z.object({ id: nonEmpty, collection: z.literal(collection) }),
  ]);

export const exhibitionArtistReferenceSchema = referenceValue("artists");
export const exhibitionWorkReferenceSchema = referenceValue("works");

export function createExhibitionSchema<
  A extends z.ZodType,
  W extends z.ZodType,
>(artistReference: A, workReference: W) {
  return z
    .object({
      artists: z.array(artistReference).min(1),
      works: z.array(workReference).optional(),
      hero: z
        .object({
          image: nonEmpty,
          orientation: z.enum(["portrait", "landscape"]),
          position: z
            .enum(["top", "center", "bottom", "left", "right"])
            .optional(),
          treatment: z.enum(["default", "contain", "cover"]).optional(),
          hero_caption: nonEmpty.optional(),
        })
        .strict(),
      start_date: z.coerce.date(),
      end_date: z.coerce.date(),
      display_artists: z.boolean().optional(),
      title: nonEmpty.optional(),
      summary: nonEmpty.optional(),
      venue: nonEmpty.optional(),
      opening_hours: nonEmpty.optional(),
      closed_days: nonEmpty.optional(),
      attendance: nonEmpty.optional(),
      hero_alt: nonEmpty,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.end_date.getTime() < value.start_date.getTime())
        context.addIssue({
          code: "custom",
          path: ["end_date"],
          message: "end_date must not precede start_date.",
        });
    });
}

export const editorExhibitionSchema = createExhibitionSchema(
  exhibitionArtistReferenceSchema,
  exhibitionWorkReferenceSchema,
);
export type ExhibitionData = z.infer<typeof editorExhibitionSchema>;
