import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertLegacyExhibitionMarkdown,
  EXHIBITIONS_MIGRATION_VERSION,
  type ExhibitionMappingEvidence,
} from "./migration-converter.ts";
export const EXHIBITION_MIGRATION_INVENTORY = [
  "alana-wilson-2027-04",
  "group-exhibition-2026-03",
  "keisuke-matsuda-2024-07",
  "reiko-kinoshita-2023-12",
  "yuka-mori-2025-07",
] as const;
export const exhibitionMigrationSha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
export type GeneratedExhibitionFile = {
  path: string;
  content: string;
  byteLength: number;
  sha256: string;
};
export type ExhibitionMigrationEntry = {
  contentId: string;
  source: {
    path: string;
    byteLength: number;
    sha256: string;
    originalBase64: string;
    bodyBase64: string;
  };
  targetDirectory: string;
  generated: {
    shared: GeneratedExhibitionFile;
    ja: GeneratedExhibitionFile;
    en: GeneratedExhibitionFile;
  };
  fieldMapping: ExhibitionMappingEvidence[];
  referenceIdentity: {
    externalId: string;
    localizedEntryIdsAreExternal: false;
    referenceRewriteRequired: false;
  };
  rollback: {
    sourcePath: string;
    originalBase64: string;
    originalByteLength: number;
    originalSha256: string;
  };
};
export type ExhibitionMigrationManifest = {
  migrationVersion: 1;
  collection: "exhibitions";
  mode: "dry-run";
  sourceRoot: string;
  expectedInventory: readonly string[];
  count: 5;
  entries: ExhibitionMigrationEntry[];
};
const generated = (file: string, content: string): GeneratedExhibitionFile => ({
  path: file,
  content,
  byteLength: Buffer.byteLength(content),
  sha256: exhibitionMigrationSha256(content),
});
export async function createExhibitionMigrationManifest(
  sourceRoot: string,
): Promise<ExhibitionMigrationManifest> {
  const root = path.resolve(sourceRoot);
  const evidenceRoot =
    path.relative(process.cwd(), root).split(path.sep).join("/") || ".";
  const inventory = await fs.readdir(root, { withFileTypes: true });
  if (
    inventory.some(
      (item) =>
        item.isSymbolicLink() || !item.isFile() || !item.name.endsWith(".md"),
    )
  )
    throw new Error("Unsafe or mixed Exhibition migration inventory");
  const ids = inventory.map((item) => item.name.slice(0, -3)).sort();
  if (JSON.stringify(ids) !== JSON.stringify(EXHIBITION_MIGRATION_INVENTORY))
    throw new Error(`Exhibition inventory mismatch: ${ids.join(", ")}`);
  const entries: ExhibitionMigrationEntry[] = [];
  for (const contentId of ids) {
    const sourcePath = path.posix.join(evidenceRoot, `${contentId}.md`);
    const bytes = await fs.readFile(path.join(root, `${contentId}.md`));
    const converted = convertLegacyExhibitionMarkdown(bytes, sourcePath);
    const targetDirectory = path.posix.join(evidenceRoot, contentId);
    const originalBase64 = bytes.toString("base64");
    const sha256 = exhibitionMigrationSha256(bytes);
    entries.push({
      contentId,
      source: {
        path: sourcePath,
        byteLength: bytes.length,
        sha256,
        originalBase64,
        bodyBase64: converted.bodyBase64,
      },
      targetDirectory,
      generated: {
        shared: generated(
          path.posix.join(targetDirectory, "index.yaml"),
          converted.shared,
        ),
        ja: generated(path.posix.join(targetDirectory, "ja.md"), converted.ja),
        en: generated(path.posix.join(targetDirectory, "en.md"), converted.en),
      },
      fieldMapping: converted.fieldMapping,
      referenceIdentity: {
        externalId: contentId,
        localizedEntryIdsAreExternal: false,
        referenceRewriteRequired: false,
      },
      rollback: {
        sourcePath,
        originalBase64,
        originalByteLength: bytes.length,
        originalSha256: sha256,
      },
    });
  }
  return {
    migrationVersion: EXHIBITIONS_MIGRATION_VERSION,
    collection: "exhibitions",
    mode: "dry-run",
    sourceRoot: evidenceRoot,
    expectedInventory: EXHIBITION_MIGRATION_INVENTORY,
    count: 5,
    entries,
  };
}
export const serializeExhibitionMigrationManifest = (
  manifest: ExhibitionMigrationManifest,
) => `${JSON.stringify(manifest, null, 2)}\n`;
const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli)
  process.stdout.write(
    serializeExhibitionMigrationManifest(
      await createExhibitionMigrationManifest(
        process.argv[2] ?? "src/content/exhibitions",
      ),
    ),
  );
