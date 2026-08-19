import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import type { AboutAssetAvailability } from "./contracts.ts";
import { createAboutFacade } from "./facade.ts";
import { assertAboutTopology, loadAboutUnit } from "./repository.ts";
import { ABOUT_LOCALES } from "./schema.ts";
import { validatePublicImages } from "../../content-boundaries/public-image-validation.ts";

export function isAboutWatchedPath(
  changedPath: string,
  root: string,
  publicRoot: string,
) {
  const aboutAssetsRoot = path.join(publicRoot, "images/about");
  return [root, aboutAssetsRoot].some(
    (watchedRoot) =>
      changedPath === watchedRoot ||
      changedPath.startsWith(`${watchedRoot}${path.sep}`),
  );
}

async function assertAssets(publicRoot: string, urls: readonly string[]) {
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
  const validation = await validatePublicImages(publicRoot, urls, ["jpeg"]);
  if (!validation.valid)
    throw new Error(
      `Invalid About assets: ${validation.issues.map(({ message }) => message).join("; ")}`,
    );
  for (const [index] of urls.entries()) {
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
  const assetUrls = [
    unit.shared.value.images.hero.src,
    ...unit.shared.value.images.gallery.map(({ src }) => src),
  ];
  const assets = await assertAssets(publicRoot, assetUrls);
  const facade = createAboutFacade(unit, assets);
  context.store.clear();
  for (const locale of ABOUT_LOCALES) {
    const source = facade.source(locale);
    if (!source) continue;
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
      context.watcher.add([root, path.join(publicRoot, "images/about")]);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (changedPath: string) => {
        if (!isAboutWatchedPath(changedPath, root, publicRoot)) return;
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
