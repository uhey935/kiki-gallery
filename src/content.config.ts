import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/artists" }),
  schema: z.object({
    name: z.string(),
    nameJa: z.string().optional(),
    bio: z.string().optional(),
    shortBio: z.string().optional(),
    image: z.string().optional(),
    shop_url: z.string().optional(),
  }),
});

const works = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/works" }),
  schema: z.object({
    title: z.string(),
    artist: z.string(),
    image: z.string(),
  }),
});

const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "src/content/exhibitions" }),
});

export const collections = {
  artists,
  exhibitions,
  works,
};