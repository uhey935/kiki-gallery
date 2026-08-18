import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { loadAboutUnit } from "./repository.ts";

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

export type AboutFixtureExecutionPlan = {
  migrationVersion: 1;
  fixtureOnly: true;
  source: { path: string; byteLength: number; sha256: string };
  targetDirectory: string;
  files: Record<
    "index.yaml" | "ja.md" | "en.md",
    { content: string; byteLength: number; sha256: string }
  >;
};

export type AboutExecutorHooks = {
  beforeStagedWrite?: (name: string) => void | Promise<void>;
  afterInstall?: () => void | Promise<void>;
  beforeRollbackRemoval?: () => void | Promise<void>;
};

async function exists(file: string) {
  return Boolean(await lstat(file).catch(() => undefined));
}

export async function executeAboutMigrationFixture(
  plan: AboutFixtureExecutionPlan,
  options: { dryRun?: boolean; hooks?: AboutExecutorHooks } = {},
) {
  if (plan.migrationVersion !== 1 || plan.fixtureOnly !== true)
    throw new Error("About executor accepts isolated fixture plans only");
  const source = path.resolve(plan.source.path);
  const target = path.resolve(plan.targetDirectory);
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    throw new Error("About source must be a regular file");
  const sourceBytes = await readFile(source);
  if (
    sourceBytes.byteLength !== plan.source.byteLength ||
    sha256(sourceBytes) !== plan.source.sha256
  )
    throw new Error("About source drift");
  if (await exists(target)) throw new Error("About target collision");
  for (const [name, evidence] of Object.entries(plan.files)) {
    if (
      Buffer.byteLength(evidence.content) !== evidence.byteLength ||
      sha256(evidence.content) !== evidence.sha256
    )
      throw new Error(`Generated About evidence mismatch: ${name}`);
  }
  if (options.dryRun !== false)
    return { mode: "dry-run" as const, sourcePreserved: true, created: [] };

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = path.join(
    parent,
    `.about-migration-${process.pid}-${Date.now()}`,
  );
  const recovery = path.join(parent, ".about-migration-recovery.json");
  let installed = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    for (const name of ["index.yaml", "ja.md", "en.md"] as const) {
      await options.hooks?.beforeStagedWrite?.(name);
      await writeFile(path.join(staging, name), plan.files[name].content, {
        flag: "wx",
      });
    }
    const staged = await loadAboutUnit(staging);
    if (
      staged.shared.state !== "valid" ||
      staged.locales.ja.state !== "valid" ||
      staged.locales.en.state !== "valid" ||
      staged.issues.some(({ category }) =>
        ["structure", "unit-integrity"].includes(category),
      )
    )
      throw new Error("Generated About unit failed validation");
    await rename(staging, target);
    installed = true;
    await options.hooks?.afterInstall?.();
    const reread = await loadAboutUnit(target);
    if (
      reread.shared.state !== "valid" ||
      reread.locales.ja.state !== "valid" ||
      reread.locales.en.state !== "valid" ||
      reread.issues.some(({ category }) =>
        ["structure", "unit-integrity"].includes(category),
      )
    )
      throw new Error("Installed About unit failed validation");
    const postSource = await readFile(source);
    if (!postSource.equals(sourceBytes))
      throw new Error("About source changed during fixture execution");
    return {
      mode: "executed" as const,
      sourcePreserved: true,
      created: [target],
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (installed)
      try {
        await options.hooks?.beforeRollbackRemoval?.();
        await rm(target, { recursive: true });
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    if (rollbackErrors.length) {
      await writeFile(
        recovery,
        `${JSON.stringify(
          {
            version: 1,
            collection: "about",
            status: "manual-recovery-required",
            originalError: String(error),
            rollbackErrors,
            source: plan.source,
            sourcePreserved:
              sha256(await readFile(source)) === plan.source.sha256,
            target,
            staging,
          },
          null,
          2,
        )}\n`,
        { flag: "wx" },
      );
      throw new Error(`About migration rollback failed; recovery: ${recovery}`);
    }
    throw error;
  } finally {
    if (!installed) await rm(staging, { recursive: true, force: true });
  }
}
