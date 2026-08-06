import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import { entriesFromUnits, loadJournalRepository } from "./repository.ts";
import type { ContentIssue } from "./contracts.ts";

export const productionJournalFixturesRoot = path.resolve(
  "src/content-loaders/journal/fixtures",
);
let lastIssues: ContentIssue[] = [];

export function getJournalLoaderIssues(): ContentIssue[] {
  return lastIssues;
}

export async function synchronizeJournalStore(
  context: LoaderContext,
  root: string,
): Promise<void> {
  const units = await loadJournalRepository(root);
  const entries = entriesFromUnits(units);
  const adapterIssues: ContentIssue[] = [];
  const nextIds = new Set(entries.map((entry) => entry.id));
  for (const oldId of context.store.keys()) {
    if (!nextIds.has(oldId)) context.store.delete(oldId);
  }
  for (const entry of entries) {
    try {
      const data = await context.parseData({
        id: entry.id,
        data: entry.data,
        filePath: entry.filePath,
      });
      const rendered = await context.renderMarkdown(entry.body, {
        fileURL: new URL(`file://${entry.filePath}`),
      });
      context.store.set({
        id: entry.id,
        data,
        body: entry.body,
        filePath: path.relative(
          context.config.root.pathname,
          entry.filePath ?? "",
        ),
        digest: context.generateDigest(
          JSON.stringify({ id: entry.id, data, body: entry.body }),
        ),
        rendered,
        assetImports: rendered.metadata?.imagePaths,
      });
    } catch (error) {
      adapterIssues.push({
        ruleId: "content.astro.parseData",
        severity: "error",
        category: "structure",
        collection: "journal",
        contentId: entry.data.contentId,
        locale: entry.data.locale,
        file: entry.filePath,
        messageKey: "content.astro.parseDataFailed",
        params: {
          detail: error instanceof Error ? error.message : String(error),
        },
        recovery: { kind: "edit-source" },
      });
      context.store.delete(entry.id);
    }
  }
  lastIssues = [...units.flatMap((unit) => unit.issues), ...adapterIssues];
}

export function journalThreeFileLoader(options: {
  root: string;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "journal-three-file-loader",
    async load(context) {
      await synchronizeJournalStore(context, root);
      if (!context.watcher) return;
      context.watcher.add(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let running = false;
      let requested = false;
      const rescan = async () => {
        if (running) {
          requested = true;
          return;
        }
        running = true;
        do {
          requested = false;
          await synchronizeJournalStore(context, root);
        } while (requested);
        running = false;
      };
      const schedule = (changedPath: string) => {
        if (!changedPath.startsWith(root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void rescan(), 40);
      };
      context.watcher.on("add", schedule);
      context.watcher.on("change", schedule);
      context.watcher.on("unlink", schedule);
      context.watcher.on("addDir", schedule);
      context.watcher.on("unlinkDir", schedule);
    },
  };
}
