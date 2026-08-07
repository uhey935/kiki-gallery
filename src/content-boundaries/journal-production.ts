import { getCollection } from "astro:content";
import path from "node:path";
import {
  createJournalProductionFacade,
  type JournalProductionFacade,
} from "./journal.ts";
import { loadJournalRepository } from "../content-loaders/journal/repository.ts";
import { createJournalReadModel } from "../content-services/journal-read-model.ts";
import { getJournalAdapterIssues } from "../content-loaders/journal/astro-loader.ts";

type JournalCollectionEntry = Awaited<
  ReturnType<typeof getCollection<"journal">>
>[number];

const journalRoot = path.resolve("src/content/journal");

export async function getJournalProductionFacade(): Promise<
  JournalProductionFacade<JournalCollectionEntry>
> {
  const [entries, units] = await Promise.all([
    getCollection("journal"),
    loadJournalRepository(journalRoot),
  ]);

  const adapterIssues = getJournalAdapterIssues(journalRoot);
  return createJournalProductionFacade(
    createJournalReadModel(entries, units, adapterIssues),
  );
}
