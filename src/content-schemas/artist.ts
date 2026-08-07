import { z } from "astro/zod";

const nonEmpty = z.string().min(1);
const navigationTerm = nonEmpty.regex(
  /^[\x20-\x7e]+$/,
  "Must use an English navigation term.",
);
const referenceValue = z.union([
  nonEmpty.transform((id) => ({ id, collection: "works" as const })),
  z.object({ id: nonEmpty, collection: z.literal("works") }),
]);

export function createArtistSchema<W extends z.ZodType>(workReference: W) {
  const workLayout = z
    .object({
      layout: z.enum(["single-a", "single-b", "double-a", "double-b"]),
      works: z.array(workReference),
    })
    .strict()
    .superRefine((section, context) => {
      const count = section.layout.startsWith("single-") ? 1 : 2;
      if (section.works.length !== count)
        context.addIssue({
          code: "custom",
          path: ["works"],
          message: `${section.layout} requires exactly ${count} work${count === 1 ? "" : "s"}.`,
        });
    });

  return z
    .object({
      hero: z.object({ image: nonEmpty }).strict(),
      works_layout: z.array(workLayout).optional(),
      name: nonEmpty,
      display_name: nonEmpty.optional(),
      biography: nonEmpty.optional(),
      short_bio: nonEmpty,
      medium: z.array(navigationTerm).min(1),
      hero_alt: nonEmpty,
      seo_title: nonEmpty.optional(),
      description: nonEmpty.optional(),
    })
    .strict()
    .superRefine((artist, context) => {
      const seen = new Set<string>();
      artist.works_layout?.forEach((section, sectionIndex) => {
        section.works.forEach((value, workIndex) => {
          const work = value as { id: string };
          if (seen.has(work.id))
            context.addIssue({
              code: "custom",
              path: ["works_layout", sectionIndex, "works", workIndex],
              message: `Work ${work.id} must not appear more than once in works_layout.`,
            });
          seen.add(work.id);
        });
      });
    });
}

export const editorArtistSchema = createArtistSchema(referenceValue);
export type ArtistData = z.infer<typeof editorArtistSchema>;
