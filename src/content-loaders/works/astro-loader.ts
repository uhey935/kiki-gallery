import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import { WORK_LOCALES } from "./schema.ts";
import { loadWorkRepository, localizedWorkEntryId } from "./repository.ts";

export async function synchronizeWorksStore(
  context: LoaderContext,
  root: string,
) {
  root = path.resolve(root);
  const units = await loadWorkRepository(root);
  const next = new Set<string>();
  for (const unit of units) {
    if (unit.shared.state !== "valid")
      throw new Error(`Work "${unit.contentId}" has invalid shared data.`);
    for (const locale of WORK_LOCALES) {
      const localized = unit.locales[locale];
      if (localized.state !== "valid") continue;
      const id = localizedWorkEntryId(unit.contentId, locale);
      next.add(id);
      const filePath = path.join(root, unit.contentId, `${locale}.md`);
      const data = await context.parseData({
        id,
        filePath,
        data: {
          contentId: unit.contentId,
          locale,
          ...unit.shared.value,
          ...localized.value,
          images: unit.shared.value.images.map((image, index) => ({
            src: image.src,
            alt: localized.value.images[index].alt,
          })),
        },
      });
      const body = localized.body ?? "";
      const rendered = await context.renderMarkdown(body, {
        fileURL: new URL(`file://${filePath}`),
      });
      context.store.set({
        id,
        data,
        body,
        rendered,
        assetImports: rendered.metadata?.imagePaths,
        filePath: path.relative(context.config.root.pathname, filePath),
        digest: context.generateDigest(JSON.stringify({ id, data, body })),
      });
    }
  }
  for (const oldId of context.store.keys())
    if (!next.has(oldId)) context.store.delete(oldId);
}

export function worksThreeFileLoader(options: {
  root: string;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "works-three-file-loader",
    async load(context) {
      await synchronizeWorksStore(context, root);
      if (!context.watcher) return;
      context.watcher.add(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (changedPath: string) => {
        if (!changedPath.startsWith(root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void synchronizeWorksStore(context, root), 40);
      };
      for (const event of [
        "add",
        "change",
        "unlink",
        "addDir",
        "unlinkDir",
      ] as const)
        context.watcher.on(event, schedule);
    },
  };
}
