import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newsEntriesFromUnits } from "./entry-adapter.ts";
import type {
  GeneratedNewsMigrationFile,
  LegacyNewsMigrationManifest,
} from "./migration-manifest.ts";
import { loadNewsUnit } from "./repository.ts";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertExactPath(actual: string, expected: string, label: string) {
  if (path.resolve(actual) !== path.resolve(expected)) {
    throw new Error(`${label} path does not match the manifest source root`);
  }
}

function verifyGeneratedEvidence(
  contentId: string,
  generated: GeneratedNewsMigrationFile,
) {
  if (
    Buffer.byteLength(generated.content) !== generated.byteLength ||
    sha256(generated.content) !== generated.sha256
  ) {
    throw new Error(
      `${contentId}: generated content does not match manifest hash`,
    );
  }
}

async function verifyWrittenFile(
  contentId: string,
  file: string,
  expected: GeneratedNewsMigrationFile,
) {
  const bytes = await fs.readFile(file);
  if (
    bytes.byteLength !== expected.byteLength ||
    sha256(bytes) !== expected.sha256
  ) {
    throw new Error(`${contentId}: written file hash mismatch: ${file}`);
  }
}

export type NewsMigrationResult = {
  migrationVersion: 1;
  migratedContentIds: string[];
  createdDirectories: string[];
  legacySourcesRetained: string[];
};

export async function executeLegacyNewsMigration(
  manifest: LegacyNewsMigrationManifest,
  hooks: {
    afterDirectoryInstalled?: (contentId: string) => void | Promise<void>;
  } = {},
): Promise<NewsMigrationResult> {
  if (
    manifest.migrationVersion !== 1 ||
    manifest.collection !== "news" ||
    manifest.mode !== "dry-run" ||
    manifest.count !== manifest.entries.length
  ) {
    throw new Error("Unsupported or inconsistent News migration manifest");
  }

  const root = path.resolve(manifest.sourceRoot);
  const seenContentIds = new Set<string>();
  for (const entry of manifest.entries) {
    if (seenContentIds.has(entry.contentId)) {
      throw new Error(`${entry.contentId}: duplicate Content ID in manifest`);
    }
    seenContentIds.add(entry.contentId);
    const source = path.join(root, `${entry.contentId}.md`);
    const target = path.join(root, entry.contentId);
    assertExactPath(entry.source.path, source, `${entry.contentId}: source`);
    assertExactPath(
      entry.targetDirectory,
      target,
      `${entry.contentId}: target`,
    );
    assertExactPath(
      entry.rollback.sourcePath,
      source,
      `${entry.contentId}: rollback source`,
    );
    for (const [key, filename] of [
      ["shared", "index.yaml"],
      ["ja", "ja.md"],
      ["en", "en.md"],
    ] as const) {
      const generated = entry.generated[key];
      assertExactPath(
        generated.path,
        path.join(target, filename),
        `${entry.contentId}: generated ${key}`,
      );
      verifyGeneratedEvidence(entry.contentId, generated);
    }

    const sourceStat = await fs.lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`${entry.contentId}: source is not a regular file`);
    }
    const sourceBytes = await fs.readFile(source);
    if (
      sourceBytes.byteLength !== entry.source.byteLength ||
      sha256(sourceBytes) !== entry.source.sha256
    ) {
      throw new Error(`${entry.contentId}: source hash mismatch`);
    }
    if (await pathExists(target)) {
      throw new Error(`${entry.contentId}: target directory already exists`);
    }
  }

  const stagingRoot = await fs.mkdtemp(
    path.join(root, ".news-migration-stage-"),
  );
  const committed: string[] = [];
  try {
    for (const entry of manifest.entries) {
      const directory = path.join(stagingRoot, entry.contentId);
      await fs.mkdir(directory);
      await Promise.all([
        fs.writeFile(
          path.join(directory, "index.yaml"),
          entry.generated.shared.content,
          { flag: "wx" },
        ),
        fs.writeFile(
          path.join(directory, "ja.md"),
          entry.generated.ja.content,
          {
            flag: "wx",
          },
        ),
        fs.writeFile(
          path.join(directory, "en.md"),
          entry.generated.en.content,
          {
            flag: "wx",
          },
        ),
      ]);
      await Promise.all([
        verifyWrittenFile(
          entry.contentId,
          path.join(directory, "index.yaml"),
          entry.generated.shared,
        ),
        verifyWrittenFile(
          entry.contentId,
          path.join(directory, "ja.md"),
          entry.generated.ja,
        ),
        verifyWrittenFile(
          entry.contentId,
          path.join(directory, "en.md"),
          entry.generated.en,
        ),
      ]);
      const unit = await loadNewsUnit(directory);
      if (
        unit.shared.state !== "valid" ||
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid" ||
        newsEntriesFromUnits([unit]).length !== 2
      ) {
        throw new Error(
          `${entry.contentId}: generated unit failed loader validation`,
        );
      }
    }

    for (const entry of manifest.entries) {
      const staged = path.join(stagingRoot, entry.contentId);
      await fs.rename(staged, entry.targetDirectory);
      committed.push(entry.targetDirectory);
      await hooks.afterDirectoryInstalled?.(entry.contentId);
    }

    for (const entry of manifest.entries) {
      const unit = await loadNewsUnit(entry.targetDirectory);
      if (
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid" ||
        newsEntriesFromUnits([unit]).length !== 2
      ) {
        throw new Error(
          `${entry.contentId}: installed unit failed loader validation`,
        );
      }
      await Promise.all([
        verifyWrittenFile(
          entry.contentId,
          entry.generated.shared.path,
          entry.generated.shared,
        ),
        verifyWrittenFile(
          entry.contentId,
          entry.generated.ja.path,
          entry.generated.ja,
        ),
        verifyWrittenFile(
          entry.contentId,
          entry.generated.en.path,
          entry.generated.en,
        ),
      ]);
    }

    return {
      migrationVersion: 1,
      migratedContentIds: manifest.entries.map((entry) => entry.contentId),
      createdDirectories: [...committed],
      legacySourcesRetained: manifest.entries.map((entry) => entry.source.path),
    };
  } catch (error) {
    for (const directory of committed.reverse()) {
      await fs.rm(directory, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const manifestFile = process.argv[2];
  if (!manifestFile) {
    throw new Error("Usage: news:migration:execute <manifest.json>");
  }
  const manifest = JSON.parse(
    await fs.readFile(path.resolve(manifestFile), "utf8"),
  ) as LegacyNewsMigrationManifest;
  const result = await executeLegacyNewsMigration(manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
