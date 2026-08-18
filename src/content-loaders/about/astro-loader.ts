import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import type { AboutAssetAvailability } from "./contracts.ts";
import { createAboutFacade } from "./facade.ts";
import { assertAboutTopology, loadAboutUnit } from "./repository.ts";
import { ABOUT_ASSET_URLS, ABOUT_LOCALES } from "./schema.ts";

async function assertAssets(publicRoot: string) {
  const availability: AboutAssetAvailability = {
    hero: false,
    "gallery-1": false,
    "gallery-2": false,
    "gallery-3": false,
    "gallery-4": false,
  };
  const keys = [
    "hero",
    "gallery-1",
    "gallery-2",
    "gallery-3",
    "gallery-4",
  ] as const;
  for (const [index, url] of ABOUT_ASSET_URLS.entries()) {
    const file = path.join(publicRoot, url.slice(1));
    const stat = await lstat(file).catch(() => undefined);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new Error(`Missing or unsafe About asset: ${url}`);
    availability[keys[index]] = true;
  }
  return availability;
}

export async function synchronizeAboutStore(
  context: LoaderContext,
  root: string,
  publicRoot: string,
) {
  const directory = await assertAboutTopology(root);
  const unit = await loadAboutUnit(directory);
  if (
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid" ||
    unit.issues.some(({ category }) =>
      ["structure", "unit-integrity"].includes(category),
    )
  )
    throw new Error("About exact three-file unit is structurally invalid");
  const assets = await assertAssets(publicRoot);
  const facade = createAboutFacade(unit, assets);
  context.store.clear();
  for (const locale of ABOUT_LOCALES) {
    const capability = facade.capability(locale);
    const source = facade.source(locale);
    if (!source || !capability.previewable) continue;
    const localized = unit.locales[locale];
    if (localized.state !== "valid") continue;
    const filePath = path.join(directory, `${locale}.md`);
    const { body: _body, ...projectedData } = source.data;
    const data = await context.parseData({
      id: `${locale}::about`,
      data: {
        contentId: "about",
        locale,
        ...projectedData,
      },
      filePath,
    });
    const rendered = await context.renderMarkdown(localized.value.body, {
      fileURL: new URL(`file://${filePath}`),
    });
    context.store.set({
      id: `${locale}::about`,
      data,
      body: localized.value.body,
      filePath: path.relative(context.config.root.pathname, filePath),
      digest: context.generateDigest(
        JSON.stringify({
          id: `${locale}::about`,
          data,
          body: localized.value.body,
        }),
      ),
      rendered,
      assetImports: rendered.metadata?.imagePaths,
    });
  }
}

export function aboutThreeFileLoader(options: {
  root: string;
  publicRoot: string;
}): Loader {
  const root = path.resolve(options.root);
  const publicRoot = path.resolve(options.publicRoot);
  return {
    name: "about-three-file-loader",
    async load(context) {
      await synchronizeAboutStore(context, root, publicRoot);
      if (!context.watcher) return;
      context.watcher.add([
        root,
        ...ABOUT_ASSET_URLS.map((url) => path.join(publicRoot, url.slice(1))),
      ]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () => void synchronizeAboutStore(context, root, publicRoot),
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
