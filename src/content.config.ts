import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/* =========================
   artists
========================= */
const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/artists" }),
  schema: z.object({
    name: z.string(),
    nameJa: z.string().optional(),
    image: z.string().optional(),

    bio: z.string().optional(),
    bio_short: z.string().optional(),

    shop_url: z.string().url().optional(),

    awards: z.array(z.string()).optional(),
    exhibitions: z.array(z.string()).optional(),

    medium: z.union([z.string(), z.array(z.string())]).optional(),
    region: z.string().optional(),
  }),
});

/* =========================
   works
========================= */
const works = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/works" }),
  schema: z.object({
    title: z.string(),
    artist: z.string(),

    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().optional(),
        })
      )
      .min(1),

    size: z.string().optional(),
    material: z.string().optional(),

    year: z.number().optional(),

    date: z.string().optional(),
    news_title: z.string().optional(),

    layout: z.string().optional(),
    position: z.number().optional(),

    inquiry: z.boolean().optional(),
  }),
});

/* =========================
   exhibitions
========================= */
const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/exhibitions" }),
  schema: z.object({
    title: z.string(),

    artist: z.union([z.string(), z.array(z.string())]),
    artist_name: z.union([z.string(), z.array(z.string())]).optional(),

    works: z.array(z.string()).optional(),

    date: z.string().optional(),
    end_date: z.string().optional(),

    news_title: z.string().optional(),

    open_time: z.string().optional(),
    closed_days: z.string().optional(),
    attendance: z.string().optional(),

    image: z.string().optional(),
    hero_portrait: z.boolean().optional(),
    lead: z.string().optional(),

    hero_media: z.string().optional(),
    hero_text_position: z.string().optional(),
    hero_text_color: z.string().optional(),

    venue: z
      .object({
        name: z.string(),
        address: z.string().optional(),
        map: z.string().optional(),
      })
      .optional(),

    published_at: z.string().optional(),
    
    display_artists: z.boolean().optional(),
  }),
});

/* =========================
   journal
========================= */
const journal = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/journal" }),
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    excerpt: z.string().optional(),

    has_page: z.boolean().optional(),
    link: z.string().optional(),

    categories: z.array(z.string()).optional(),

    hero_image: z.string().optional(),
    hero_caption: z.string().optional(),
  }),
});

/* =========================
   news
========================= */
const news = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/content/news",
  }),

  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    excerpt: z.string().optional(),
    has_page: z.boolean().optional(),
    link: z.string().optional(),

    type: z.string().optional(),
    image: z.string().optional(),
    show_on_home: z.boolean().optional(),
  }),
});

/* =========================
   export
========================= */
export const collections = {
  artists,
  works,
  exhibitions,
  journal,
  news,
};