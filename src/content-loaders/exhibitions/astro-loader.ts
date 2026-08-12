import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import {
  createExhibitionsFacade,
  type ArtistCapabilityResolver,
} from "./facade.ts";
import { loadExhibitionRepository } from "./repository.ts";

export async function synchronizeExhibitionPrototypeStore(
  context: LoaderContext,
  root: string,
  artistCapable: ArtistCapabilityResolver,
) {
  root = path.resolve(root);
  const units = await loadExhibitionRepository(root);
  const facade = createExhibitionsFacade(units, artistCapable);
  const entries = (["ja", "en"] as const).flatMap((locale) =>
    facade.forLocale(locale),
  );
  const nextIds = new Set(entries.map((entry) => entry.id));
  for (const oldId of context.store.keys())
    if (!nextIds.has(oldId)) context.store.delete(oldId);
  for (const entry of entries) {
    const filePath = path.join(root, entry.contentId, `${entry.locale}.md`);
    const data = await context.parseData({
      id: entry.id,
      data: {
        contentId: entry.contentId,
        locale: entry.locale,
        ...entry.data,
      },
      filePath,
    });
    const rendered = await context.renderMarkdown(entry.body, {
      fileURL: new URL(`file://${filePath}`),
    });
    context.store.set({
      id: entry.id,
      data,
      body: entry.body,
      filePath: path.relative(context.config.root.pathname, filePath),
      digest: context.generateDigest(
        JSON.stringify({ id: entry.id, data, body: entry.body }),
      ),
      rendered,
      assetImports: rendered.metadata?.imagePaths,
    });
  }
  return units;
}

export function exhibitionPrototypeThreeFileLoader(options: {
  root: string;
  artistCapable: ArtistCapabilityResolver;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "exhibition-prototype-three-file-loader",
    async load(context) {
      await synchronizeExhibitionPrototypeStore(
        context,
        root,
        options.artistCapable,
      );
      if (!context.watcher) return;
      context.watcher.add(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (changedPath: string) => {
        if (!changedPath.startsWith(root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () =>
            void synchronizeExhibitionPrototypeStore(
              context,
              root,
              options.artistCapable,
            ),
          40,
        );
      };
      context.watcher.on("add", schedule);
      context.watcher.on("change", schedule);
      context.watcher.on("unlink", schedule);
      context.watcher.on("addDir", schedule);
      context.watcher.on("unlinkDir", schedule);
    },
  };
}
