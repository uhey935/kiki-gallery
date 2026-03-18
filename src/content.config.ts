import { defineCollection, z } from "astro:content";

const artists = defineCollection({
  type: "content",
  schema: z.object({
    name: z.string(),
    slug: z.string(),
  }),
});

export const collections = {
  artists,
};