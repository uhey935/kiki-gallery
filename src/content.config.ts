import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// artists
const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/artists" }),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
  }),
});

// exhibitions
const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/exhibitions" }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    artist: z.string(),
    date: z.string(),
    image: z.string(),
  }),
});

// journal
const journal = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/journal" }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    related_exhibition: z.string(),
    date: z.string(),
  }),
});

export const collections = {
  artists,
  exhibitions,
  journal,
};