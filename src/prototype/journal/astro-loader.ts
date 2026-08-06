import path from "node:path";
import {
  getJournalLoaderIssues,
  journalThreeFileLoader,
  productionJournalFixturesRoot,
} from "../../content-loaders/journal/astro-loader.ts";

export const prototypeJournalRoot = productionJournalFixturesRoot;
export const getPrototypeJournalIssues = getJournalLoaderIssues;

export function journalPrototypeLoader() {
  return journalThreeFileLoader({
    root: path.relative(process.cwd(), prototypeJournalRoot),
    name: "journal-read-only-prototype",
  });
}
