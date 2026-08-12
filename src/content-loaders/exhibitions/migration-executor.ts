import { promises as fs } from "node:fs";
import path from "node:path";
import { loadExhibitionUnit } from "./repository.ts";
import { evaluateExhibitionLocale } from "./facade.ts";
import {
  EXHIBITION_MIGRATION_INVENTORY,
  exhibitionMigrationSha256,
  serializeExhibitionMigrationManifest,
  type ExhibitionMigrationEntry,
  type ExhibitionMigrationManifest,
} from "./migration-manifest.ts";

export const FROZEN_EXHIBITIONS_MIGRATION_MANIFEST_SHA256 =
  "246edf641a799c4dc46624700653d0e50250168a729e33f0ca5933b458989725";
const FILES = [
  ["shared", "index.yaml"],
  ["ja", "ja.md"],
  ["en", "en.md"],
] as const;
const RECOVERY = ".exhibitions-migration-recovery.json";
export type ExhibitionMigrationHooks = {
  beforeStagedWrite?: (id: string, file: string) => void | Promise<void>;
  afterDirectoryInstalled?: (id: string) => void | Promise<void>;
  beforeSourceRemoval?: (id: string) => void | Promise<void>;
  beforeRollbackDirectoryRemoval?: (
    id: string,
    directory: string,
  ) => void | Promise<void>;
  beforeRollbackSourceRestore?: (
    id: string,
    source: string,
  ) => void | Promise<void>;
};
export type ExhibitionMigrationOptions = {
  dryRun?: boolean;
  rootOverride?: string;
  hooks?: ExhibitionMigrationHooks;
  allowUnfrozenFixtureManifest?: boolean;
};
const stat = async (file: string) => fs.lstat(file).catch(() => undefined);
function assertManifest(
  manifest: ExhibitionMigrationManifest,
  allowFixture = false,
) {
  if (
    manifest.collection !== "exhibitions" ||
    manifest.count !== 5 ||
    JSON.stringify(manifest.expectedInventory) !==
      JSON.stringify(EXHIBITION_MIGRATION_INVENTORY)
  )
    throw new Error("Invalid Exhibitions migration manifest");
  if (
    !allowFixture &&
    exhibitionMigrationSha256(
      serializeExhibitionMigrationManifest(manifest),
    ) !== FROZEN_EXHIBITIONS_MIGRATION_MANIFEST_SHA256
  )
    throw new Error("Exhibitions migration input is not frozen");
}
async function preflight(
  manifest: ExhibitionMigrationManifest,
  root: string,
  allowFixture: boolean,
) {
  assertManifest(manifest, allowFixture);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Unsafe Exhibitions root");
  const inventory = await fs.readdir(root, { withFileTypes: true });
  if (
    inventory.some(
      (item) =>
        item.isSymbolicLink() || !item.isFile() || !item.name.endsWith(".md"),
    )
  )
    throw new Error("Unexpected, mixed, or unsafe Exhibitions inventory");
  const ids = inventory.map((item) => item.name.slice(0, -3)).sort();
  if (JSON.stringify(ids) !== JSON.stringify(EXHIBITION_MIGRATION_INVENTORY))
    throw new Error("Exhibitions inventory drift");
  if (await stat(path.join(root, RECOVERY)))
    throw new Error("Unresolved Exhibitions migration recovery evidence");
  for (const entry of manifest.entries) {
    const source = path.join(root, `${entry.contentId}.md`);
    const target = path.join(root, entry.contentId);
    const s = await fs.lstat(source);
    if (!s.isFile() || s.isSymbolicLink())
      throw new Error(`${entry.contentId}: unsafe source`);
    const bytes = await fs.readFile(source);
    if (
      bytes.length !== entry.source.byteLength ||
      exhibitionMigrationSha256(bytes) !== entry.source.sha256 ||
      !bytes.equals(Buffer.from(entry.rollback.originalBase64, "base64"))
    )
      throw new Error(`${entry.contentId}: source drift`);
    if (await stat(target))
      throw new Error(`${entry.contentId}: target collision`);
    for (const [key, filename] of FILES) {
      const generated = entry.generated[key];
      if (
        generated.path !==
          path.posix.join(manifest.sourceRoot, entry.contentId, filename) ||
        Buffer.byteLength(generated.content) !== generated.byteLength ||
        exhibitionMigrationSha256(generated.content) !== generated.sha256
      )
        throw new Error(`${entry.contentId}: invalid generated evidence`);
    }
  }
}
async function rollback(
  entries: ExhibitionMigrationEntry[],
  root: string,
  installed: string[],
  removed: string[],
  hooks: ExhibitionMigrationHooks,
  staging: string,
  originalError: unknown,
) {
  const errors: string[] = [];
  for (const id of [...installed].reverse())
    try {
      await hooks.beforeRollbackDirectoryRemoval?.(id, path.join(root, id));
      await fs.rm(path.join(root, id), { recursive: true });
    } catch (error) {
      errors.push(String(error));
    }
  for (const id of [...removed].reverse()) {
    const entry = entries.find((item) => item.contentId === id)!;
    const source = path.join(root, `${id}.md`);
    try {
      await hooks.beforeRollbackSourceRestore?.(id, source);
      if (await stat(source)) throw new Error("rollback source occupied");
      await fs.writeFile(
        source,
        Buffer.from(entry.rollback.originalBase64, "base64"),
        { flag: "wx" },
      );
    } catch (error) {
      errors.push(String(error));
    }
  }
  if (errors.length) {
    const evidence = path.join(root, RECOVERY);
    await fs.writeFile(
      evidence,
      `${JSON.stringify({ version: 1, collection: "exhibitions", status: "manual-recovery-required", originalError: String(originalError), rollbackErrors: errors, staging, entries: entries.map((entry) => entry.rollback) }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error(
      `Exhibitions migration rollback failed; recovery: ${evidence}`,
    );
  }
}
export async function executeExhibitionMigration(
  manifest: ExhibitionMigrationManifest,
  options: ExhibitionMigrationOptions = {},
) {
  const root = path.resolve(options.rootOverride ?? manifest.sourceRoot);
  await preflight(
    manifest,
    root,
    options.allowUnfrozenFixtureManifest ?? false,
  );
  if (options.dryRun !== false)
    return {
      migrationVersion: 1 as const,
      transaction: "all-five-global-rollback" as const,
      mode: "dry-run" as const,
      contentIds: manifest.entries.map((entry) => entry.contentId),
      createdDirectories: [],
      removedSources: [],
    };
  const staging = path.join(
    root,
    `.exhibitions-migration-${process.pid}-${Date.now()}`,
  );
  const installed: string[] = [];
  const removed: string[] = [];
  try {
    await fs.mkdir(staging, { mode: 0o700 });
    for (const entry of manifest.entries) {
      const directory = path.join(staging, entry.contentId);
      await fs.mkdir(directory);
      for (const [key, filename] of FILES) {
        await options.hooks?.beforeStagedWrite?.(entry.contentId, filename);
        await fs.writeFile(
          path.join(directory, filename),
          entry.generated[key].content,
          { flag: "wx" },
        );
      }
    }
    for (const entry of manifest.entries) {
      await fs.rename(
        path.join(staging, entry.contentId),
        path.join(root, entry.contentId),
      );
      installed.push(entry.contentId);
      await options.hooks?.afterDirectoryInstalled?.(entry.contentId);
      const unit = await loadExhibitionUnit(path.join(root, entry.contentId));
      if (
        unit.shared.state !== "valid" ||
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid" ||
        !evaluateExhibitionLocale(unit, "ja", () => true).allowed ||
        evaluateExhibitionLocale(unit, "en", () => true).allowed
      )
        throw new Error(`${entry.contentId}: post-install verification failed`);
    }
    for (const entry of manifest.entries) {
      await options.hooks?.beforeSourceRemoval?.(entry.contentId);
      await fs.rm(path.join(root, `${entry.contentId}.md`));
      removed.push(entry.contentId);
    }
    await fs.rm(staging, { recursive: true, force: true });
    return {
      migrationVersion: 1 as const,
      transaction: "all-five-global-rollback" as const,
      mode: "executed" as const,
      contentIds: manifest.entries.map((entry) => entry.contentId),
      createdDirectories: [...installed],
      removedSources: [...removed],
    };
  } catch (error) {
    await rollback(
      manifest.entries,
      root,
      installed,
      removed,
      options.hooks ?? {},
      staging,
      error,
    );
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}
