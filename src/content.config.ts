import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { journalThreeFileLoader } from "./content-loaders/journal/astro-loader";
import { journalSchema } from "./content-loaders/journal/schema";
import { newsThreeFileLoader } from "./content-loaders/news/astro-loader";
import { newsEntrySchema } from "./content-loaders/news/schema";
import { artistIdentityThreeFileLoader } from "./content-loaders/artists/astro-loader";
import { artistIdentitySchema } from "./content-loaders/artists/schema";
import { worksThreeFileLoader } from "./content-loaders/works/astro-loader";
import { workAstroEntrySchema } from "./content-loaders/works/schema";
import { exhibitionThreeFileLoader } from "./content-loaders/exhibitions/astro-loader";
import { exhibitionAstroEntrySchema } from "./content-loaders/exhibitions/schema";
import { homeSchema } from "./content-schemas/home";

const home = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/home" }),
  schema: homeSchema,
});

const artists = defineCollection({
  loader: artistIdentityThreeFileLoader({ root: "./src/content/artists" }),
  schema: artistIdentitySchema,
});

const worksLocalized = defineCollection({
  loader: worksThreeFileLoader({ root: "./src/content/works" }),
  schema: workAstroEntrySchema,
});

const exhibitionsThreeFile = defineCollection({
  loader: exhibitionThreeFileLoader({
    root: "./src/content/exhibitions",
    artistsRoot: "./src/content/artists",
  }),
  schema: exhibitionAstroEntrySchema,
});

const journal = defineCollection({
  loader: journalThreeFileLoader({ root: "./src/content/journal" }),
  schema: journalSchema,
});

const newsThreeFile = defineCollection({
  loader: newsThreeFileLoader({ root: "./src/content/news" }),
  schema: newsEntrySchema,
});

export const collections = {
  home,
  artists,
  worksLocalized,
  exhibitionsThreeFile,
  journal,
  newsThreeFile,
};
