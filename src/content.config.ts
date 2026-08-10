import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { journalThreeFileLoader } from "./content-loaders/journal/astro-loader";
import { journalSchema } from "./content-loaders/journal/schema";
import { newsThreeFileLoader } from "./content-loaders/news/astro-loader";
import { newsEntrySchema } from "./content-loaders/news/schema";
import { createWorkSchema } from "./content-schemas/work";
import { createExhibitionSchema } from "./content-schemas/exhibition";
import { createArtistSchema } from "./content-schemas/artist";
import { newsSchema } from "./content-schemas/news";
import { homeSchema } from "./content-schemas/home";

const artistSchema = createArtistSchema(reference("works"));

const workSchema = createWorkSchema(reference("artists"));

const exhibitionSchema = createExhibitionSchema(
  reference("artists"),
  reference("works"),
);

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
  loader: journalThreeFileLoader({ root: "./src/content/journal" }),
  schema: journalSchema,
});

const news = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/news" }),
  schema: newsSchema,
});

const newsThreeFile = defineCollection({
  loader: newsThreeFileLoader({ root: "./src/content/news" }),
  schema: newsEntrySchema,
});

export const collections = {
  home,
  artists,
  works,
  exhibitions,
  journal,
  news,
  newsThreeFile,
};
