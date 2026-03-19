import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/artists" }),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
  }),
});

const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/exhibitions" }),
});

export const collections = {
  artists,
  exhibitions,
};