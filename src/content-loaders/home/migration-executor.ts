import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { loadHomeUnit } from "./repository.ts";

const sha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

export type FinalizedHomeMigrationPlan = {
  migrationVersion: 1;
  source: { path: string; byteLength: number; sha256: string };
  targetDirectory: string;
  files: Record<
    "index.yaml" | "ja.md" | "en.md",
    { content: string; sha256: string }
  >;
};

async function exists(file: string) {
  return Boolean(await lstat(file).catch(() => undefined));
}

export async function executeHomeMigrationFixture(
  plan: FinalizedHomeMigrationPlan,
  hook?: () => void | Promise<void>,
) {
  if (plan.migrationVersion !== 1)
    throw new Error("Unsupported Home migration plan");
  const source = path.resolve(plan.source.path);
  const target = path.resolve(plan.targetDirectory);
  if (target !== path.join(path.dirname(source), "home"))
    throw new Error("Target collision or path mismatch");
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    throw new Error("Home source must be a regular file");
  const sourceBytes = await readFile(source);
  if (
    sourceBytes.byteLength !== plan.source.byteLength ||
    sha256(sourceBytes) !== plan.source.sha256
  )
    throw new Error("Home source drift");
  if (await exists(target)) throw new Error("Home target collision");
  for (const evidence of Object.values(plan.files))
    if (sha256(evidence.content) !== evidence.sha256)
      throw new Error("Generated Home evidence mismatch");

  const staging = await mkdtemp(
    path.join(path.dirname(source), ".home-migration-stage-"),
  );
  const stagedUnit = path.join(staging, "home");
  const stagedSource = path.join(staging, "home.md");
  let installed = false;
  let sourceMoved = false;
  try {
    await mkdir(stagedUnit);
    for (const name of ["index.yaml", "ja.md", "en.md"] as const)
      await writeFile(path.join(stagedUnit, name), plan.files[name].content, {
        flag: "wx",
      });
    const staged = await loadHomeUnit(stagedUnit);
    if (
      staged.shared.state !== "valid" ||
      staged.locales.ja.state !== "valid" ||
      staged.locales.en.state !== "valid" ||
      staged.issues.some(({ category }) => category !== "content-quality")
    )
      throw new Error("Generated Home unit failed validation");
    await rename(source, stagedSource);
    sourceMoved = true;
    await rename(stagedUnit, target);
    installed = true;
    await hook?.();
    const reread = await loadHomeUnit(target);
    if (
      reread.shared.state !== "valid" ||
      reread.locales.ja.state !== "valid" ||
      reread.locales.en.state !== "valid" ||
      reread.issues.some(({ category }) => category !== "content-quality")
    )
      throw new Error("Installed Home unit failed validation");
    return { created: target, legacySourceRemoved: source };
  } catch (error) {
    if (installed) await rm(target, { recursive: true, force: true });
    if (sourceMoved) await rename(stagedSource, source);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
