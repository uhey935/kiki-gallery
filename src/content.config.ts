import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";

const HOME_HERO_LAYOUTS = ["default", "portrait", "alternate"] as const;
const HERO_ORIENTATIONS = ["portrait", "landscape"] as const;
const HERO_POSITIONS = ["top", "center", "bottom", "left", "right"] as const;
const HERO_TREATMENTS = ["default", "contain", "cover"] as const;
const WORK_LAYOUTS = ["single-a", "single-b", "double-a", "double-b"] as const;
const JOURNAL_CATEGORIES = ["interview", "essay", "report"] as const;
const NEWS_TYPES = ["exhibition", "artist", "general"] as const;
const MEDIA_TYPES = ["image", "video"] as const;

const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must contain only lowercase alphanumeric segments separated by hyphens.",
  );

const nonEmptyStringSchema = z.string().min(1);
const navigationLanguageSchema = nonEmptyStringSchema.regex(
  /^[\x20-\x7e]+$/,
  "Must use an English navigation term.",
);
const imagePathSchema = nonEmptyStringSchema;
const videoPathSchema = nonEmptyStringSchema;
const isoDateSchema = z.coerce.date();
const journalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Must be a valid calendar date.");
const homeHeroLayoutSchema = z.enum(HOME_HERO_LAYOUTS);
const heroOrientationSchema = z.enum(HERO_ORIENTATIONS);
const heroPositionSchema = z.enum(HERO_POSITIONS);
const heroTreatmentSchema = z.enum(HERO_TREATMENTS);
const workLayoutSchema = z.enum(WORK_LAYOUTS);
const journalCategorySchema = z.enum(JOURNAL_CATEGORIES);
const newsTypeSchema = z.enum(NEWS_TYPES);
const mediaTypeSchema = z.enum(MEDIA_TYPES);

const internalPathSchema = z.string().startsWith("/");
const linkSchema = z.union([z.string().url(), internalPathSchema]);
const newsLinkSchema = z.union([
  z
    .string()
    .url()
    .refine(
      (value) => /^https?:\/\//.test(value),
      "Must use an http:// or https:// URL.",
    ),
  internalPathSchema,
]);
const artistHeroSchema = z
  .object({
    image: imagePathSchema,
  })
  .strict();

const exhibitionHeroSchema = z
  .object({
    image: imagePathSchema,
    orientation: heroOrientationSchema,
    position: heroPositionSchema.optional(),
    treatment: heroTreatmentSchema.optional(),
    hero_caption: nonEmptyStringSchema.optional(),
  })
  .strict();

const journalHeroSchema = z
  .object({
    image: imagePathSchema,
    hero_caption: nonEmptyStringSchema.optional(),
  })
  .strict();

const mediaSchema = z
  .object({
    type: mediaTypeSchema,
    image: imagePathSchema.optional(),
    video: videoPathSchema.optional(),
    poster: imagePathSchema.optional(),
  })
  .strict()
  .superRefine((media, context) => {
    if (media.type === "image") {
      if (!media.image) {
        context.addIssue({
          code: "custom",
          path: ["image"],
          message: "Image media requires image.",
        });
      }

      for (const field of ["video", "poster"] as const) {
        if (media[field] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `Image media must not define ${field}.`,
          });
        }
      }
    }

    if (media.type === "video") {
      for (const field of ["video", "poster"] as const) {
        if (!media[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `Video media requires ${field}.`,
          });
        }
      }

      if (media.image !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["image"],
          message: "Video media must not define image.",
        });
      }
    }
  });

const homeHeroSchema = z
  .object({
    media: mediaSchema,
    layout: homeHeroLayoutSchema.optional(),
  })
  .strict();

const responsiveImageSchema = z
  .object({
    landscape: imagePathSchema,
    square: imagePathSchema,
    portrait: imagePathSchema,
  })
  .strict();

const homeSectionSchema = z
  .object({
    id: nonEmptyStringSchema,
    title: navigationLanguageSchema,
    href: linkSchema,
    image: responsiveImageSchema,
  })
  .strict();

const workLayoutSectionSchema = z
  .object({
    layout: workLayoutSchema,
    works: z.array(reference("works")),
  })
  .strict()
  .superRefine((section, context) => {
    const expectedWorkCount = section.layout.startsWith("single-") ? 1 : 2;

    if (section.works.length !== expectedWorkCount) {
      context.addIssue({
        code: "custom",
        path: ["works"],
        message: `${section.layout} requires exactly ${expectedWorkCount} work${expectedWorkCount === 1 ? "" : "s"}.`,
      });
    }
  });

const workImageSchema = z
  .object({
    src: imagePathSchema,
    alt: nonEmptyStringSchema,
  })
  .strict();

const inquirySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("inquiry"),
      url: linkSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("shop"),
      url: linkSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("none"),
    })
    .strict(),
]);

const contributorReferenceSchema = slugSchema;

const creditSchema = z
  .object({
    role: nonEmptyStringSchema,
    person: contributorReferenceSchema.optional(),
    member: contributorReferenceSchema.optional(),
  })
  .strict()
  .superRefine((credit, context) => {
    const hasPerson = credit.person !== undefined;
    const hasMember = credit.member !== undefined;

    if (!hasPerson && !hasMember) {
      context.addIssue({
        code: "custom",
        path: ["person"],
        message: "Credit requires either person or member.",
      });
    }

    if (hasPerson && hasMember) {
      context.addIssue({
        code: "custom",
        path: ["person"],
        message: "Credit must not define both person and member.",
      });

      context.addIssue({
        code: "custom",
        path: ["member"],
        message: "Credit must not define both person and member.",
      });
    }
  });

const seoFieldsSchema = {
  seo_title: nonEmptyStringSchema.optional(),
  description: nonEmptyStringSchema.optional(),
};

const homeSchema = z
  .object({
    home_hero: homeHeroSchema.optional(),
    sections: z.array(homeSectionSchema),
    title: nonEmptyStringSchema.optional(),
    description: nonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((home, context) => {
    const seenSectionIds = new Set<string>();

    home.sections.forEach((section, index) => {
      if (seenSectionIds.has(section.id)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `Duplicate Home Section id: ${section.id}.`,
        });
      }
      seenSectionIds.add(section.id);
    });
  });

const artistSchema = z
  .object({
    hero: artistHeroSchema,
    works_layout: z.array(workLayoutSectionSchema).optional(),
    name: nonEmptyStringSchema,
    display_name: nonEmptyStringSchema.optional(),
    biography: nonEmptyStringSchema.optional(),
    short_bio: nonEmptyStringSchema,
    medium: z.array(navigationLanguageSchema).min(1),
    hero_alt: nonEmptyStringSchema,
    ...seoFieldsSchema,
  })
  .strict()
  .superRefine((artist, context) => {
    const seenWorkIds = new Set<string>();

    artist.works_layout?.forEach((section, sectionIndex) => {
      section.works.forEach((work, workIndex) => {
        if (seenWorkIds.has(work.id)) {
          context.addIssue({
            code: "custom",
            path: ["works_layout", sectionIndex, "works", workIndex],
            message: `Work ${work.id} must not appear more than once in works_layout.`,
          });
        }
        seenWorkIds.add(work.id);
      });
    });
  });

const workSchema = z
  .object({
    artist: reference("artists"),
    images: z.array(workImageSchema).min(1),
    year: z.number().int().positive().optional(),
    size: nonEmptyStringSchema.optional(),
    inquiry: inquirySchema,
    orientation: z.literal("landscape").optional(),
    title: nonEmptyStringSchema,
    material: nonEmptyStringSchema.optional(),
    ...seoFieldsSchema,
  })
  .strict()
  .superRefine((work, context) => {
    const seenImagePaths = new Set<string>();

    work.images.forEach((image, index) => {
      if (seenImagePaths.has(image.src)) {
        context.addIssue({
          code: "custom",
          path: ["images", index, "src"],
          message: `Duplicate Work image path: ${image.src}.`,
        });
      }
      seenImagePaths.add(image.src);
    });
  });

const exhibitionSchema = z
  .object({
    artists: z.array(reference("artists")).min(1),
    works: z.array(reference("works")).optional(),
    hero: exhibitionHeroSchema,
    start_date: isoDateSchema,
    end_date: isoDateSchema,
    display_artists: z.boolean().optional(),
    title: nonEmptyStringSchema.optional(),
    summary: nonEmptyStringSchema.optional(),
    venue: nonEmptyStringSchema.optional(),
    opening_hours: nonEmptyStringSchema.optional(),
    closed_days: nonEmptyStringSchema.optional(),
    attendance: nonEmptyStringSchema.optional(),
    hero_alt: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((exhibition, context) => {
    if (exhibition.end_date.getTime() < exhibition.start_date.getTime()) {
      context.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "end_date must not precede start_date.",
      });
    }
  });

const journalSchema = z
  .object({
    categories: z.array(journalCategorySchema).min(1),
    hero: journalHeroSchema,
    date: journalDateSchema,
    author: contributorReferenceSchema.optional(),
    credits: z.array(creditSchema).optional(),
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    hero_alt: nonEmptyStringSchema,
  })
  .strict()
  .superRefine((journal, context) => {
    if (journal.author !== undefined && journal.credits !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["author"],
        message: "Journal must not define both author and credits.",
      });

      context.addIssue({
        code: "custom",
        path: ["credits"],
        message: "Journal must not define both author and credits.",
      });
    }
  });

const newsSchema = z
  .object({
    date: journalDateSchema,
    news_type: newsTypeSchema,
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema.optional(),
    link: newsLinkSchema.optional(),
    show_on_home: z.boolean(),
  })
  .strict();

const home = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/home" }),
  schema: homeSchema,
});

const artists = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/artists" }),
  schema: artistSchema,
});

const works = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/works" }),
  schema: workSchema,
});

const exhibitions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/exhibitions" }),
  schema: exhibitionSchema,
});

const journal = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/journal" }),
  schema: journalSchema,
});

const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/news" }),
  schema: newsSchema,
});

export const collections = {
  home,
  artists,
  works,
  exhibitions,
  journal,
  news,
};
