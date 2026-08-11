import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTISTS_MIGRATION_VERSION,
  convertLegacyArtistMarkdown,
  type ArtistFieldMappingEvidence,
} from "./migration-converter.ts";

export const ARTIST_MIGRATION_INVENTORY = [
  "alana-wilson",
  "keisuke-matsuda",
  "reiko-kinoshita",
  "takeyoshi-mitsui",
  "yuka-mori",
] as const;

const LEGACY_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function artistMigrationSha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type GeneratedArtistMigrationFile = {
  path: string;
  content: string;
  byteLength: number;
  sha256: string;
};

export type LegacyArtistMigrationItem = {
  contentId: string;
  source: {
    path: string;
    byteLength: number;
    sha256: string;
    originalBase64: string;
    bodyByteLength: 0;
  };
  targetDirectory: string;
  generated: {
    shared: GeneratedArtistMigrationFile;
    ja: GeneratedArtistMigrationFile;
    en: GeneratedArtistMigrationFile;
  };
  fieldMapping: ArtistFieldMappingEvidence[];
  referenceIdentity: {
    externalId: string;
    localizedEntryIdsAreExternal: false;
    referenceRewriteRequired: false;
  };
  rollback: {
    action: "remove-target-directory-and-restore-source-bytes";
    sourcePath: string;
    originalBase64: string;
    originalByteLength: number;
    originalSha256: string;
  };
};

export type LegacyArtistMigrationManifest = {
  migrationVersion: typeof ARTISTS_MIGRATION_VERSION;
  collection: "artists";
  mode: "dry-run";
  sourceRoot: string;
  expectedInventory: readonly string[];
  count: 5;
  entries: LegacyArtistMigrationItem[];
};

function generatedFile(
  file: string,
  content: string,
): GeneratedArtistMigrationFile {
  return {
    path: file,
    content,
    byteLength: Buffer.byteLength(content),
    sha256: artistMigrationSha256(content),
  };
}

function assertInventory(names: string[], directories: string[]) {
  const invalid = names.filter((name) => !LEGACY_FILE.test(name));
  if (invalid.length)
    throw new Error(`Invalid Artist source filenames: ${invalid.join(", ")}`);
  const contentIds = names.map((name) => name.slice(0, -3));
  const caseFolded = new Set<string>();
  for (const contentId of contentIds) {
    const folded = contentId.toLocaleLowerCase("en-US");
    if (caseFolded.has(folded))
      throw new Error(`Case-folded Artist content ID collision: ${contentId}`);
    caseFolded.add(folded);
  }
  const expected = [...ARTIST_MIGRATION_INVENTORY];
  if (
    contentIds.length !== expected.length ||
    contentIds.some((contentId, index) => contentId !== expected[index])
  )
    throw new Error(
      `Artist inventory mismatch: expected ${expected.join(", ")}; got ${contentIds.join(", ")}`,
    );
  const collisions = directories.filter((name) =>
    expected.includes(name as never),
  );
  if (collisions.length)
    throw new Error(`Artist target collision: ${collisions.join(", ")}`);
}

export async function createLegacyArtistMigrationManifest(
  sourceRoot: string,
): Promise<LegacyArtistMigrationManifest> {
  const root = path.resolve(sourceRoot);
  const relativeRoot = path.relative(process.cwd(), root);
  const evidenceRoot =
    relativeRoot &&
    relativeRoot !== ".." &&
    !relativeRoot.startsWith(`..${path.sep}`)
      ? relativeRoot.split(path.sep).join("/")
      : root;
  const directoryEntries = await fs.readdir(root, { withFileTypes: true });
  const sourceNames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const directories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assertInventory(sourceNames, directories);

  const entries: LegacyArtistMigrationItem[] = [];
  for (const name of sourceNames) {
    const contentId = name.slice(0, -3);
    const sourceFile = path.join(root, name);
    const sourcePath = path.posix.join(evidenceRoot, name);
    const sourceBytes = await fs.readFile(sourceFile);
    const converted = convertLegacyArtistMarkdown(sourceBytes, sourcePath);
    const targetDirectory = path.posix.join(evidenceRoot, contentId);
    const originalSha256 = artistMigrationSha256(sourceBytes);
    const originalBase64 = sourceBytes.toString("base64");
    entries.push({
      contentId,
      source: {
        path: sourcePath,
        byteLength: sourceBytes.byteLength,
        sha256: originalSha256,
        originalBase64,
        bodyByteLength: 0,
      },
      targetDirectory,
      generated: {
        shared: generatedFile(
          path.posix.join(targetDirectory, "index.yaml"),
          converted.shared,
        ),
        ja: generatedFile(
          path.posix.join(targetDirectory, "ja.md"),
          converted.ja,
        ),
        en: generatedFile(
          path.posix.join(targetDirectory, "en.md"),
          converted.en,
        ),
      },
      fieldMapping: converted.fieldMapping,
      referenceIdentity: {
        externalId: contentId,
        localizedEntryIdsAreExternal: false,
        referenceRewriteRequired: false,
      },
      rollback: {
        action: "remove-target-directory-and-restore-source-bytes",
        sourcePath,
        originalBase64,
        originalByteLength: sourceBytes.byteLength,
        originalSha256,
      },
    });
  }
  return {
    migrationVersion: ARTISTS_MIGRATION_VERSION,
    collection: "artists",
    mode: "dry-run",
    sourceRoot: evidenceRoot,
    expectedInventory: ARTIST_MIGRATION_INVENTORY,
    count: 5,
    entries,
  };
}

export function serializeArtistMigrationManifest(
  manifest: LegacyArtistMigrationManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function restoreLegacyArtistBytes(
  manifest: LegacyArtistMigrationManifest,
): Map<string, Buffer> {
  return new Map(
    manifest.entries.map((entry) => {
      const bytes = Buffer.from(entry.rollback.originalBase64, "base64");
      if (
        bytes.byteLength !== entry.rollback.originalByteLength ||
        artistMigrationSha256(bytes) !== entry.rollback.originalSha256 ||
        entry.source.originalBase64 !== entry.rollback.originalBase64 ||
        entry.source.sha256 !== entry.rollback.originalSha256
      )
        throw new Error(`${entry.contentId}: invalid Artist rollback evidence`);
      return [entry.rollback.sourcePath, bytes];
    }),
  );
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);
  const sourceRoot = path.resolve(
    args.find((argument) => !argument.startsWith("--")) ??
      "src/content/artists",
  );
  const manifest = await createLegacyArtistMigrationManifest(sourceRoot);
  const serialized = serializeArtistMigrationManifest(manifest);
  const freezeArgument = args.find((argument) =>
    argument.startsWith("--freeze="),
  );
  if (freezeArgument) {
    const output = path.resolve(freezeArgument.slice("--freeze=".length));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, serialized, { flag: "wx" });
  } else process.stdout.write(serialized);
}
