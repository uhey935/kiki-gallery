import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/* =========================
   Content Enums
========================= */

const WORK_TEMPLATES = [
  "single-a",
  "single-b",
  "double-a",
  "double-b",
] as const;

const workLayoutSectionSchema = z
  .object({
    template: z.enum(WORK_TEMPLATES),
    works: z.array(z.string()),
  })
  .superRefine((section, context) => {
    const expectedWorkCount = section.template.startsWith("single-") ? 1 : 2;

    if (section.works.length !== expectedWorkCount) {
      context.addIssue({
        code: "custom",
        path: ["works"],
        message: `${section.template} requires exactly ${expectedWorkCount} work${expectedWorkCount === 1 ? "" : "s"}.`,
      });
    }
  });

/* =========================
   home
========================= */

const home = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/content/home",
  }),

  schema: z.object({
    hero_image: z.string(),

    sections: z.array(
      z.object({
       id: z.string(),

        title: z.string(),
        href: z.string(),

       image: z.object({
          landscape: z.string(),
          square: z.string(),
          portrait: z.string(),
        }),
      }),
    ),
  }),
});

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

    works_layout: z.array(workLayoutSectionSchema),
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

    orientation: z.literal("landscape").optional(),

    year: z.number().optional(),

    date: z.string().optional(),
    news_title: z.string().optional(),

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

    start_date: z.string(),
    end_date: z.string().optional(),

    news_title: z.string().optional(),

    open_time: z.string().optional(),
    closed_days: z.string().optional(),
    attendance: z.string().optional(),

    image: z.string().optional(),

    hero_image: z.string().optional(),

    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string().optional(),
        })
      )
      .optional(),

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
  home,
};
