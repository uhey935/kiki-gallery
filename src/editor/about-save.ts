import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createAboutEditorDraft,
  validateAboutEditorDraft,
  type AboutEditorDraftState,
} from "./about-draft-state.ts";
import {
  serializeAboutEditorDraft,
  type AboutSerializedFiles,
} from "./about-serializer.ts";
import { readAboutEditorEntry } from "./about-state.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/about");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class AboutSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "recovery-required"
    | "about-save-rollback-failed"
    | "save-failed";
  constructor(
    message: string,
    code: AboutSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type AboutSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "readdir" | "rm" | "writeFile"
>;

export async function writeAboutSerializedFiles(
  files: AboutSerializedFiles,
  baseline: AboutSerializedFiles,
  root = canonicalRoot,
  io: AboutSaveFileSystem = fs,
  verify?: () => Promise<void>,
) {
  const resolvedRoot = path.resolve(root),
    directory = path.join(resolvedRoot, "about");
  const rootEntries = await io.readdir(resolvedRoot);
  if (
    rootEntries.some(
      (name) =>
        name.startsWith(".about-save-") && name.endsWith("-recovery.json"),
    )
  )
    throw new AboutSaveError(
      "About recovery evidence must be resolved before mutation",
      "recovery-required",
    );
  const stat = await io.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new AboutSaveError("Unsafe About unit", "invalid-content-id");
  const actual = (await io.readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...names].sort()))
    throw new AboutSaveError(
      "About must contain exactly three canonical files",
      "canonical-mismatch",
    );
  const token = `.about-save-${randomUUID()}`,
    stage = path.join(resolvedRoot, `${token}-stage`),
    backup = path.join(resolvedRoot, `${token}-backup`),
    recovery = path.join(resolvedRoot, `${token}-recovery.json`);
  const replaced: string[] = [];
  let preserveBackup = false;
  try {
    await io.mkdir(stage);
    await io.mkdir(backup);
    for (const name of names) {
      const target = path.join(directory, name),
        sourceStat = await io.lstat(target);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
        throw new Error("unsafe source");
      const current = await io.readFile(target, "utf8");
      if (current !== baseline[name])
        throw new AboutSaveError(
          `Canonical ${name} changed`,
          "canonical-mismatch",
        );
      await io.writeFile(path.join(stage, name), files[name], { flag: "wx" });
      await io.writeFile(path.join(backup, name), current, { flag: "wx" });
    }
    for (const name of names) {
      await io.rename(path.join(stage, name), path.join(directory, name));
      replaced.push(name);
    }
    await verify?.();
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of [...replaced].reverse())
      try {
        await io.rename(path.join(backup, name), path.join(directory, name));
      } catch (e) {
        failures.push(e);
      }
    if (failures.length) {
      preserveBackup = true;
      const affected = await Promise.all(
        names.map(async (name) => {
          const observed = await io
            .readFile(path.join(directory, name), "utf8")
            .catch(() => "");
          return {
            path: path.join(directory, name),
            expected: {
              sha256: hash(baseline[name]),
              length: Buffer.byteLength(baseline[name]),
            },
            observed: {
              sha256: hash(observed),
              length: Buffer.byteLength(observed),
            },
          };
        }),
      );
      await io.writeFile(
        recovery,
        JSON.stringify(
          {
            kind: "about-three-file-recovery",
            manualRecoveryRequired: true,
            backup,
            affected,
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      throw new AboutSaveError(
        `About Save rollback failed; manual recovery required (${recovery})`,
        "about-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof AboutSaveError) throw error;
    throw new AboutSaveError(
      `Failed to save About: ${error instanceof Error ? error.message : String(error)}`,
      "save-failed",
      { cause: error },
    );
  } finally {
    await io.rm(stage, { recursive: true, force: true }).catch(() => {});
    if (!preserveBackup)
      await io.rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}
export async function saveAboutEditorDraft(
  draft: AboutEditorDraftState,
  baseline: AboutEditorDraftState,
  root = canonicalRoot,
  io: AboutSaveFileSystem = fs,
) {
  if (draft.contentId !== "about" || baseline.contentId !== "about")
    throw new AboutSaveError("Invalid About Content ID", "invalid-content-id");
  if (!validateAboutEditorDraft(draft).capabilities.save)
    throw new AboutSaveError(
      "About draft has blocking issues",
      "invalid-draft",
    );
  const entry = await readAboutEditorEntry(root);
  if (entry.structuralStatus !== "valid")
    throw new AboutSaveError(
      "Canonical About unavailable",
      "canonical-mismatch",
    );
  const current = {
    "index.yaml": entry.shared.state === "valid" ? entry.shared.raw : "",
    "ja.md": entry.locales.ja.state === "valid" ? entry.locales.ja.raw : "",
    "en.md": entry.locales.en.state === "valid" ? entry.locales.en.raw : "",
  };
  if (names.some((name) => current[name] !== baseline.preimages[name]))
    throw new AboutSaveError(
      "Canonical About changed after load",
      "canonical-mismatch",
    );
  const serialized = serializeAboutEditorDraft(draft);
  let saved: AboutEditorDraftState | undefined;
  await writeAboutSerializedFiles(serialized, current, root, io, async () => {
    saved = createAboutEditorDraft(await readAboutEditorEntry(root));
    const reread = serializeAboutEditorDraft(saved);
    if (names.some((name) => reread[name] !== serialized[name]))
      throw new Error("Saved About failed reread validation");
  });
  if (!saved)
    throw new AboutSaveError("Saved About was not verified", "save-failed");
  return saved;
}
