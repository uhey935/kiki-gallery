import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import type {
  LoadedNewsUnit,
  NewsContentIssue,
  NewsEntry,
  NewsLocale,
} from "./contracts.ts";
import { newsEntriesFromUnits } from "./entry-adapter.ts";
import { loadNewsRepository } from "./repository.ts";

type AdapterStage = "parseData" | "render";

const adapterIssuesByRoot = new Map<
  string,
  ReadonlyMap<string, readonly NewsContentIssue[]>
>();

function errorDiagnostic(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message };
  }
  return { name: typeof error, message: String(error) };
}

function isContentFailure(stage: AdapterStage, error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (stage === "parseData") {
    return error.name === "InvalidContentEntryDataError";
  }
  return (
    (error as Error & { type?: string }).type === "MarkdownError" ||
    error.name === "MarkdownError" ||
    error.name === "MarkdownFrontmatterParseError"
  );
}

function adapterIssue(
  entry: NewsEntry,
  stage: AdapterStage,
  error: unknown,
): NewsContentIssue {
  return {
    ruleId:
      stage === "parseData"
        ? "content.adapter.parse-data"
        : "content.adapter.markdown-render",
    severity: "error",
    category: "adapter",
    collection: "news",
    contentId: entry.data.contentId,
    locale: entry.data.locale,
    file: entry.filePath,
    stage,
    renderBlocking: true,
    messageKey:
      stage === "parseData"
        ? "content.adapter.parseDataFailed"
        : "content.adapter.markdownRenderFailed",
    diagnostic: errorDiagnostic(error),
    recovery: { kind: "edit-source" },
  };
}

export class NewsAdapterFailure extends Error {
  readonly contentId: string;
  readonly locale: NewsLocale;
  readonly stage: AdapterStage;

  constructor(
    contentId: string,
    locale: NewsLocale,
    stage: AdapterStage,
    cause: unknown,
  ) {
    const diagnostic = errorDiagnostic(cause);
    super(
      `Unexpected News adapter failure (${contentId}, ${locale}, ${stage}): ${diagnostic.name}: ${diagnostic.message}`,
      { cause },
    );
    this.name = "NewsAdapterFailure";
    this.contentId = contentId;
    this.locale = locale;
    this.stage = stage;
  }
}

function recordAdapterIssue(
  units: LoadedNewsUnit[],
  entry: NewsEntry,
  stage: AdapterStage,
  error: unknown,
): void {
  const unit = units.find(
    (candidate) => candidate.contentId === entry.data.contentId,
  );
  if (!unit) {
    throw new NewsAdapterFailure(
      entry.data.contentId,
      entry.data.locale,
      stage,
      new Error("Adapter entry has no repository Issue owner."),
    );
  }
  unit.issues.push(adapterIssue(entry, stage, error));
}

export function getNewsAdapterIssues(
  root: string,
): ReadonlyMap<string, readonly NewsContentIssue[]> {
  return adapterIssuesByRoot.get(path.resolve(root)) ?? new Map();
}

export async function synchronizeNewsStore(
  context: LoaderContext,
  root: string,
): Promise<LoadedNewsUnit[]> {
  root = path.resolve(root);
  const units = await loadNewsRepository(root);
  const entries = newsEntriesFromUnits(units);
  const nextIds = new Set(entries.map((entry) => entry.id));
  for (const oldId of context.store.keys()) {
    if (!nextIds.has(oldId)) context.store.delete(oldId);
  }
  for (const entry of entries) {
    let data;
    try {
      data = await context.parseData({
        id: entry.id,
        data: entry.data,
        filePath: entry.filePath,
      });
    } catch (error) {
      if (!isContentFailure("parseData", error)) {
        throw new NewsAdapterFailure(
          entry.data.contentId,
          entry.data.locale,
          "parseData",
          error,
        );
      }
      recordAdapterIssue(units, entry, "parseData", error);
      context.store.delete(entry.id);
      continue;
    }

    let rendered;
    try {
      rendered = await context.renderMarkdown(entry.body, {
        fileURL: new URL(`file://${entry.filePath}`),
      });
    } catch (error) {
      if (!isContentFailure("render", error)) {
        throw new NewsAdapterFailure(
          entry.data.contentId,
          entry.data.locale,
          "render",
          error,
        );
      }
      recordAdapterIssue(units, entry, "render", error);
      context.store.delete(entry.id);
      continue;
    }

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
  }
  adapterIssuesByRoot.set(
    root,
    new Map(
      units.map((unit) => [
        unit.contentId,
        unit.issues.filter((candidate) => candidate.category === "adapter"),
      ]),
    ),
  );
  return units;
}

export function newsThreeFileLoader(options: {
  root: string;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "news-three-file-loader",
    async load(context) {
      await synchronizeNewsStore(context, root);
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
          await synchronizeNewsStore(context, root);
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
