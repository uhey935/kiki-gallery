import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExhibitionRepository } from "./repository.ts";
import { EXHIBITION_MIGRATION_INVENTORY } from "./migration-manifest.ts";
import {
  createScheduleNormalizationManifest,
  exhibitionScheduleSha256,
  type ScheduleNormalizationManifest,
} from "./schedule-normalization-manifest.ts";

export type ScheduleNormalizationHooks = {
  beforeInstall?: (contentId: string, name: string) => void | Promise<void>;
  beforeRollback?: (target: string, backup: string) => void | Promise<void>;
};

export async function executeScheduleNormalization(
  manifest: ScheduleNormalizationManifest,
  root: string,
  options: { dryRun?: boolean; hooks?: ScheduleNormalizationHooks } = {},
) {
  const absolute = path.resolve(root);
  const inventory = await fs.readdir(absolute, { withFileTypes: true });
  const ids = inventory
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (
    manifest.version !== 2 ||
    manifest.collection !== "exhibitions" ||
    inventory.length !== ids.length ||
    JSON.stringify(ids) !== JSON.stringify(EXHIBITION_MIGRATION_INVENTORY) ||
    JSON.stringify(manifest.entries.map((entry) => entry.contentId)) !==
      JSON.stringify(EXHIBITION_MIGRATION_INVENTORY)
  )
    throw new Error("Schedule normalization inventory drift");
  for (const entry of manifest.entries)
    for (const file of entry.files) {
      const actual = await fs.readFile(path.join(absolute, entry.contentId, file.name));
      if (
        exhibitionScheduleSha256(actual) !== file.preimageSha256 ||
        !actual.equals(file.preimage)
      )
        throw new Error(`${entry.contentId}/${file.name}: manifest drift`);
    }
  if (options.dryRun !== false)
    return { mode: "dry-run" as const, contentIds: manifest.entries.map((e) => e.contentId) };

  const transaction = await fs.mkdtemp(
    path.join(os.tmpdir(), "exhibitions-schedule-normalization-"),
  );
  const staged = path.join(transaction, "staged");
  const backups = path.join(transaction, "backups");
  const installed: Array<{ target: string; backup: string }> = [];
  try {
    await fs.mkdir(staged);
    await fs.mkdir(backups);
    for (const entry of manifest.entries) {
      await fs.mkdir(path.join(staged, entry.contentId));
      await fs.mkdir(path.join(backups, entry.contentId));
      for (const file of entry.files)
        await fs.writeFile(
          path.join(staged, entry.contentId, file.name),
          file.postimage,
          { flag: "wx" },
        );
    }
    for (const entry of manifest.entries)
      for (const file of entry.files) {
        await options.hooks?.beforeInstall?.(entry.contentId, file.name);
        const target = path.join(absolute, entry.contentId, file.name);
        const backup = path.join(backups, entry.contentId, file.name);
        const current = await fs.readFile(target);
        if (exhibitionScheduleSha256(current) !== file.preimageSha256)
          throw new Error(`${entry.contentId}/${file.name}: install drift`);
        await fs.rename(target, backup);
        try {
          await fs.rename(path.join(staged, entry.contentId, file.name), target);
        } catch (error) {
          await fs.rename(backup, target);
          throw error;
        }
        installed.push({ target, backup });
      }
    const units = await loadExhibitionRepository(absolute);
    if (
      units.length !== manifest.entries.length ||
      units.some(
        (unit) =>
          unit.shared.state !== "valid" ||
          unit.locales.ja.state !== "valid" ||
          unit.locales.en.state !== "valid",
      )
    )
      throw new Error("Schedule normalization post-install verification failed");
    for (const entry of manifest.entries)
      for (const file of entry.files) {
        const actual = await fs.readFile(
          path.join(absolute, entry.contentId, file.name),
        );
        if (exhibitionScheduleSha256(actual) !== file.postimageSha256)
          throw new Error(`${entry.contentId}/${file.name}: postimage drift`);
      }
    await fs.rm(transaction, { recursive: true });
    return { mode: "executed" as const, contentIds: manifest.entries.map((e) => e.contentId) };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const item of [...installed].reverse())
      try {
        await options.hooks?.beforeRollback?.(item.target, item.backup);
        await fs.rm(item.target);
        await fs.rename(item.backup, item.target);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    if (!rollbackErrors.length) await fs.rm(transaction, { recursive: true });
    if (rollbackErrors.length)
      throw new Error(
        `Schedule normalization rollback failed; recovery retained at ${transaction}: ${rollbackErrors.join("; ")}`,
        { cause: error },
      );
    throw error;
  }
}

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const root = process.argv[2] ?? "src/content/exhibitions";
  const manifest = await createScheduleNormalizationManifest(root);
  const result = await executeScheduleNormalization(manifest, root, {
    dryRun: !process.argv.includes("--execute"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
