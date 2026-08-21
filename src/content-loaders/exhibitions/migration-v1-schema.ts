import { z } from "astro/zod";

const nonEmpty = z.string().min(1);

/** Frozen v1 flat-to-three-file output contract. Not used by canonical loading. */
export const exhibitionV1LocalizedSchema = z
  .object({
    title: nonEmpty,
    summary: nonEmpty.optional(),
    venue: nonEmpty.optional(),
    opening_hours: nonEmpty.optional(),
    closed_days: nonEmpty.optional(),
    attendance: nonEmpty.optional(),
    hero_alt: nonEmpty,
    hero_caption: nonEmpty.optional(),
    seo_title: nonEmpty.optional(),
    description: nonEmpty.optional(),
  })
  .strict();
