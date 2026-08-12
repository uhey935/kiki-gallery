import { promises as fs } from "node:fs";
import path from "node:path";
import { loadWorkUnit } from "./repository.ts";
import {
  serializeWorkMigrationManifest,
  snapshotWorkAssets,
  worksSha256,
  type WorkMigrationManifest,
} from "./migration-manifest.ts";

export const FROZEN_WORKS_MIGRATION_MANIFEST_SHA256 =
  "5eddbe7015aa14c5bc6741cf84a5c14ea4d93cc75cebf9a6812c691daca10498";

const files = [
  ["shared", "index.yaml"],
  ["ja", "ja.md"],
  ["en", "en.md"],
] as const;
async function optional(file: string) {
  try {
    return await fs.lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
async function verifyAssets(
  manifest: WorkMigrationManifest,
  projectRoot: string,
) {
  const refs = manifest.assetInvariance.before.flatMap((a) =>
    a.references.map((r) => ({
      contentId: r.contentId,
      src: a.url,
      order: r.order,
    })),
  );
  const now = await snapshotWorkAssets(projectRoot, refs);
  if (JSON.stringify(now) !== JSON.stringify(manifest.assetInvariance.before))
    throw new Error("Works asset invariance violation");
}
async function preflight(
  manifest: WorkMigrationManifest,
  root: string,
  projectRoot: string,
) {
  if (
    manifest.collection !== "works" ||
    manifest.count !== 7 ||
    manifest.entries.length !== 7
  )
    throw new Error("Invalid frozen Works manifest");
  if (
    worksSha256(serializeWorkMigrationManifest(manifest)) !==
    FROZEN_WORKS_MIGRATION_MANIFEST_SHA256
  )
    throw new Error("Works migration input is not the frozen manifest");
  const names = (await fs.readdir(root)).sort();
  const expected = manifest.expectedInventory.map((id) => `${id}.md`);
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error("Exact source inventory drift");
  for (const entry of manifest.entries) {
    const source = path.join(root, `${entry.contentId}.md`);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`${entry.contentId}: unsafe source`);
    const bytes = await fs.readFile(source);
    if (
      bytes.length !== entry.source.byteLength ||
      worksSha256(bytes) !== entry.source.sha256
    )
      throw new Error(`${entry.contentId}: source hash drift`);
    if (await optional(path.join(root, entry.contentId)))
      throw new Error(`${entry.contentId}: target collision`);
    for (const [key] of files) {
      const g = entry.generated[key];
      if (
        Buffer.byteLength(g.content) !== g.byteLength ||
        worksSha256(g.content) !== g.sha256
      )
        throw new Error(`${entry.contentId}: target evidence drift`);
    }
  }
  await verifyAssets(manifest, projectRoot);
}
export type WorkMigrationHooks = {
  afterInstall?: (contentId: string) => void | Promise<void>;
  beforeSourceRemoval?: (contentId: string) => void | Promise<void>;
  beforeRollback?: (contentId: string) => void | Promise<void>;
};
export async function executeWorkMigration(
  manifest: WorkMigrationManifest,
  options: {
    dryRun?: boolean;
    rootOverride?: string;
    projectRoot?: string;
    hooks?: WorkMigrationHooks;
  } = {},
) {
  const root = path.resolve(options.rootOverride ?? manifest.sourceRoot),
    projectRoot = path.resolve(
      options.projectRoot ?? path.join(root, "../../.."),
    );
  await preflight(manifest, root, projectRoot);
  if (options.dryRun)
    return {
      mode: "dry-run",
      transaction: "all-seven-global-rollback",
      contentIds: manifest.entries.map((e) => e.contentId),
    };
  const stage = await fs.mkdtemp(path.join(root, ".works-migration-stage-")),
    removed = path.join(stage, "removed");
  const installed: string[] = [];
  await fs.mkdir(removed);
  try {
    for (const entry of manifest.entries) {
      const dir = path.join(stage, entry.contentId);
      await fs.mkdir(dir);
      for (const [key, name] of files)
        await fs.writeFile(path.join(dir, name), entry.generated[key].content, {
          flag: "wx",
        });
      const unit = await loadWorkUnit(dir);
      if (
        unit.shared.state !== "valid" ||
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid"
      )
        throw new Error(`${entry.contentId}: staged validation failure`);
    }
    await verifyAssets(manifest, projectRoot);
    for (const entry of manifest.entries) {
      await fs.rename(
        path.join(stage, entry.contentId),
        path.join(root, entry.contentId),
      );
      installed.push(entry.contentId);
      await options.hooks?.afterInstall?.(entry.contentId);
    }
    for (const entry of manifest.entries) {
      const unit = await loadWorkUnit(path.join(root, entry.contentId));
      if (
        unit.shared.state !== "valid" ||
        unit.locales.ja.state !== "valid" ||
        unit.locales.en.state !== "valid"
      )
        throw new Error(
          `${entry.contentId}: post-install verification failure`,
        );
    }
    await verifyAssets(manifest, projectRoot);
    for (const entry of manifest.entries) {
      await options.hooks?.beforeSourceRemoval?.(entry.contentId);
      await fs.rename(
        path.join(root, `${entry.contentId}.md`),
        path.join(removed, `${entry.contentId}.md`),
      );
    }
    await verifyAssets(manifest, projectRoot);
    await fs.rm(stage, { recursive: true });
    return {
      mode: "executed",
      transaction: "all-seven-global-rollback",
      contentIds: manifest.entries.map((e) => e.contentId),
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const id of [...installed].reverse())
      try {
        await options.hooks?.beforeRollback?.(id);
        await fs.rm(path.join(root, id), { recursive: true });
      } catch (e) {
        rollbackErrors.push(String(e));
      }
    for (const entry of manifest.entries)
      try {
        const source = path.join(root, `${entry.contentId}.md`);
        if (!(await optional(source))) {
          const bytes = Buffer.from(entry.rollback.originalBase64, "base64");
          await fs.writeFile(source, bytes, { flag: "wx" });
        }
      } catch (e) {
        rollbackErrors.push(String(e));
      }
    if (rollbackErrors.length) {
      const evidence = path.join(root, ".works-migration-recovery.json");
      await fs.writeFile(
        evidence,
        JSON.stringify(
          {
            status: "manual-recovery-required",
            error: String(error),
            rollbackErrors,
            stage,
            manifestEntries: manifest.entries.map((e) => ({
              contentId: e.contentId,
              rollback: e.rollback,
            })),
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      throw new Error(`Works rollback failed; durable evidence: ${evidence}`);
    }
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}
