import { promises as fs } from "node:fs";
import path from "node:path";
import type { LegacyArtistMigrationManifest } from "../content-loaders/artists/migration-manifest.ts";

const frozenManifestPath = path.resolve(
  "docs/architecture/artists-migration-manifest-2026-08-11.json",
);

async function frozenManifest(): Promise<LegacyArtistMigrationManifest> {
  return JSON.parse(await fs.readFile(frozenManifestPath, "utf8"));
}

export async function materializeLegacyArtistsFixture(root: string) {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const manifest = await frozenManifest();
  await Promise.all(
    manifest.entries.map(async (entry) => {
      const directory = path.join(root, entry.contentId);
      await fs.mkdir(directory);
      await Promise.all([
        fs.writeFile(path.join(directory, "index.yaml"), entry.generated.shared.content),
        fs.writeFile(path.join(directory, "ja.md"), entry.generated.ja.content),
        fs.writeFile(path.join(directory, "en.md"), entry.generated.en.content),
      ]);
    }),
  );
  return manifest.entries.map((entry) => entry.contentId);
}
