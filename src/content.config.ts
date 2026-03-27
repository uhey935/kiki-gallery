import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/artists" }),
  schema: z.object({
    name: z.string(),
    nameJa: z.string().optional(),
    bio: z.string().optional(),
    bio_short: z.string().optional(),
    image: z.string().optional(),
    shop_url: z.string().optional(),
  }),
});

const works = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/works" }),
  schema: z.object({
    title: z.string(),
    artist: z.string(),
    image: z.string(),
    size: z.string().optional(),
    material: z.string().optional(),
    alt: z.string().optional(),
  }),
});

const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/exhibitions" }),
  schema: z.object({
    title: z.string(),
    artist: z.string(),
    date: z.string(),
    end_date: z.string().optional(),
    image: z.string(),

    open_time: z.string().optional(),
    closed_days: z.string().optional(),
    attendance: z.string().optional(),

    venue: z
      .object({
        name: z.string(),
        map: z.string().optional(),
      })
      .optional(),
  }),
});

export const collections = {
  artists,
  works,
  exhibitions,
};