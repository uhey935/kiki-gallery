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
    bio: z.string().optional(),
    bio_short: z.string().optional(),
    image: z.string().optional(),
    shop_url: z.string().optional(),
    awards: z.array(z.string()).optional(),
    exhibitions: z.array(z.string()).optional(),
    medium: z.string().optional(),
    region: z.string().optional(),
    news_title: z.string().optional(),
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
    image: z.string(),
    size: z.string().optional(),
    material: z.string().optional(),
    alt: z.string().optional(),
    date: z.string().optional(),
    news_title: z.string().optional(),
  }),
});

/* =========================
   exhibitions
========================= */
const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/exhibitions" }),
  schema: z.object({
    title: z.string(),

    // ID（リンク用）
    artist: z.union([
      z.string(),
      z.array(z.string())
    ]),

    // 表示用（fallback）
    artist_name: z.union([
      z.string(),
      z.array(z.string())
    ]).optional(),

    date: z.string().optional(),
    end_date: z.string().optional(),

    image: z.string().optional(),

    open_time: z.string().optional(),
    closed_days: z.string().optional(),
    attendance: z.string().optional(),

    venue: z.object({
      name: z.string(),
      map: z.string().optional(),
    }).optional(),

    news_title: z.string().optional(),

    // News用
    published_at: z.string().optional(),
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
  }),
});

/* =========================
   news
========================= */
const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/news" }),
  schema: z.object({
    title: z.string(),
    date: z.string().optional(),
    excerpt: z.string().optional(),
    has_page: z.boolean().optional(),
    link: z.string().optional(),
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