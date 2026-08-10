import { getCollection } from "astro:content";
import path from "node:path";
import { getNewsAdapterIssues } from "../content-loaders/news/astro-loader.ts";
import { loadNewsRepository } from "../content-loaders/news/repository.ts";
import { createNewsReadModel } from "../content-services/news-read-model.ts";
import {
  createNewsProductionFacade,
  type NewsProductionFacade,
} from "./news.ts";

type NewsCollectionEntry = Awaited<
  ReturnType<typeof getCollection<"newsThreeFile">>
>[number];

const newsRoot = path.resolve("src/content/news");

export async function getNewsProductionFacade(): Promise<
  NewsProductionFacade<NewsCollectionEntry>
> {
  const [entries, units] = await Promise.all([
    getCollection("newsThreeFile"),
    loadNewsRepository(newsRoot),
  ]);
  return createNewsProductionFacade(
    createNewsReadModel(entries, units, getNewsAdapterIssues(newsRoot)),
  );
}
