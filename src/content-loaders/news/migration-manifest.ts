import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertLegacyNewsMarkdown,
  NEWS_MIGRATION_VERSION,
} from "./migration-converter.ts";

const LEGACY_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type GeneratedNewsMigrationFile = {
  path: string;
  content: string;
  byteLength: number;
  sha256: string;
};

export type LegacyNewsMigrationItem = {
  contentId: string;
  source: {
    path: string;
    byteLength: number;
    sha256: string;
  };
  targetDirectory: string;
  generated: {
    shared: GeneratedNewsMigrationFile;
    ja: GeneratedNewsMigrationFile;
    en: GeneratedNewsMigrationFile;
  };
  rollback: {
    action: "restore-source-bytes";
    sourcePath: string;
    originalBase64: string;
    originalByteLength: number;
    originalSha256: string;
  };
};

export type LegacyNewsMigrationManifest = {
  migrationVersion: typeof NEWS_MIGRATION_VERSION;
  collection: "news";
  mode: "dry-run";
  sourceRoot: string;
  count: number;
  entries: LegacyNewsMigrationItem[];
};

function generatedFile(
  file: string,
  content: string,
): GeneratedNewsMigrationFile {
  return {
    path: file,
    content,
    byteLength: Buffer.byteLength(content),
    sha256: sha256(content),
  };
}

export async function createLegacyNewsMigrationManifest(
  sourceRoot: string,
): Promise<LegacyNewsMigrationManifest> {
  const root = path.resolve(sourceRoot);
  const names = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && LEGACY_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const entries: LegacyNewsMigrationItem[] = [];

  for (const name of names) {
    const sourcePath = path.join(root, name);
    const contentId = name.slice(0, -3);
    const sourceBytes = await fs.readFile(sourcePath);
    const converted = convertLegacyNewsMarkdown(sourceBytes, sourcePath);
    const targetDirectory = path.join(root, contentId);
    const originalSha256 = sha256(sourceBytes);
    entries.push({
      contentId,
      source: {
        path: sourcePath,
        byteLength: sourceBytes.byteLength,
        sha256: originalSha256,
      },
      targetDirectory,
      generated: {
        shared: generatedFile(
          path.join(targetDirectory, "index.yaml"),
          converted.shared,
        ),
        ja: generatedFile(path.join(targetDirectory, "ja.md"), converted.ja),
        en: generatedFile(path.join(targetDirectory, "en.md"), converted.en),
      },
      rollback: {
        action: "restore-source-bytes",
        sourcePath,
        originalBase64: sourceBytes.toString("base64"),
        originalByteLength: sourceBytes.byteLength,
        originalSha256,
      },
    });
  }

  return {
    migrationVersion: NEWS_MIGRATION_VERSION,
    collection: "news",
    mode: "dry-run",
    sourceRoot: root,
    count: entries.length,
    entries,
  };
}

export function restoreLegacyNewsBytes(
  manifest: LegacyNewsMigrationManifest,
): Map<string, Buffer> {
  return new Map(
    manifest.entries.map((entry) => {
      const bytes = Buffer.from(entry.rollback.originalBase64, "base64");
      if (
        bytes.byteLength !== entry.rollback.originalByteLength ||
        sha256(bytes) !== entry.rollback.originalSha256
      ) {
        throw new Error(`${entry.contentId}: invalid rollback evidence`);
      }
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
    args.find((argument) => !argument.startsWith("--")) ?? "src/content/news",
  );
  const manifest = await createLegacyNewsMigrationManifest(sourceRoot);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const freezeArgument = args.find((argument) =>
    argument.startsWith("--freeze="),
  );
  if (freezeArgument) {
    const output = path.resolve(freezeArgument.slice("--freeze=".length));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, serialized, { flag: "wx" });
  } else {
    process.stdout.write(serialized);
  }
}
