import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import { createHomeFacade } from "./facade.ts";
import { assertHomeTopology, loadHomeUnit } from "./repository.ts";

const destinations = {
  ja: { artists: true, about: true },
  en: { artists: true, about: false },
} as const;

export async function synchronizeHomeStore(
  context: LoaderContext,
  root: string,
) {
  const directory = await assertHomeTopology(root);
  const unit = await loadHomeUnit(directory);
  if (
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid" ||
    unit.issues.some(({ category }) => category !== "content-quality")
  )
    throw new Error("Home exact three-file unit is structurally invalid");
  const facade = createHomeFacade(unit, destinations, true);
  const entries = (["ja", "en"] as const).map((locale) =>
    facade.sourceEntry(locale),
  );
  context.store.clear();
  for (const entry of entries) {
    if (!entry) continue;
    const filePath = path.join(directory, `${entry.locale}.md`);
    const data = await context.parseData({
      id: entry.id,
      data: {
        contentId: entry.contentId,
        locale: entry.locale,
        ...entry.data,
      },
      filePath,
    });
    context.store.set({
      id: entry.id,
      data,
      filePath: path.relative(context.config.root.pathname, filePath),
      digest: context.generateDigest(JSON.stringify({ id: entry.id, data })),
    });
  }
}

export function homeThreeFileLoader(options: {
  root: string;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "home-three-file-loader",
    async load(context) {
      await synchronizeHomeStore(context, root);
      if (!context.watcher) return;
      context.watcher.add(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (changedPath: string) => {
        if (!changedPath.startsWith(root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void synchronizeHomeStore(context, root), 40);
      };
      context.watcher.on("add", schedule);
      context.watcher.on("change", schedule);
      context.watcher.on("unlink", schedule);
      context.watcher.on("addDir", schedule);
      context.watcher.on("unlinkDir", schedule);
    },
  };
}
