import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";
import { evaluateArtistCapabilities } from "./capabilities.ts";
import { identityEntriesFromUnits } from "./entry-adapter.ts";
import { loadArtistRepository } from "./repository.ts";

export async function synchronizeArtistIdentityStore(
  context: LoaderContext,
  root: string,
) {
  root = path.resolve(root);
  const units = await loadArtistRepository(root);
  for (const unit of units) {
    if (!evaluateArtistCapabilities(unit).identity.allowed)
      throw new Error(
        `Artist "${unit.contentId}" has no valid canonical identity.`,
      );
  }
  const entries = identityEntriesFromUnits(units);
  const nextIds = new Set(entries.map((entry) => entry.id));
  for (const oldId of context.store.keys())
    if (!nextIds.has(oldId)) context.store.delete(oldId);
  for (const entry of entries) {
    const filePath = path.join(root, entry.contentId, "index.yaml");
    const data = await context.parseData({
      id: entry.id,
      data: entry.data,
      filePath,
    });
    context.store.set({
      id: entry.id,
      data,
      filePath: path.relative(context.config.root.pathname, filePath),
      digest: context.generateDigest(
        JSON.stringify({ id: entry.id, data: entry.data }),
      ),
    });
  }
  return units;
}

export function artistIdentityThreeFileLoader(options: {
  root: string;
  name?: string;
}): Loader {
  const root = path.resolve(options.root);
  return {
    name: options.name ?? "artist-identity-three-file-loader",
    async load(context) {
      await synchronizeArtistIdentityStore(context, root);
      if (!context.watcher) return;
      context.watcher.add(root);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = (changedPath: string) => {
        if (!changedPath.startsWith(root)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () => void synchronizeArtistIdentityStore(context, root),
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
