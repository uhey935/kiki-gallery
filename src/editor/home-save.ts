import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createHomeEditorDraft,
  validateHomeEditorDraft,
  type HomeEditorDraftState,
} from "./home-draft-state.ts";
import {
  serializeHomeEditorDraft,
  type HomeSerializedFiles,
} from "./home-serializer.ts";
import { readHomeEditorEntry } from "./home-state.ts";
const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/home");
export class HomeSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "home-save-rollback-failed"
    | "save-failed";
  constructor(
    message: string,
    code: HomeSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
  }
}
export type HomeSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

export async function writeHomeSerializedFiles(
  files: HomeSerializedFiles,
  baseline: HomeSerializedFiles,
  root = canonicalRoot,
  io: HomeSaveFileSystem = fs,
  verify?: () => Promise<void>,
) {
  const directory = path.resolve(root, "home");
  const stat = await io.lstat(directory).catch(() => undefined);
  if (
    path.dirname(directory) !== path.resolve(root) ||
    !stat?.isDirectory() ||
    stat.isSymbolicLink()
  )
    throw new HomeSaveError("Unsafe Home unit", "invalid-content-id");
  const token = `.home-save-${randomUUID()}`;
  const stage = path.join(path.resolve(root), `${token}-stage`);
  const backup = path.join(path.resolve(root), `${token}-backup`);
  const replaced: string[] = [];
  let recoveryRequired = false;
  try {
    await io.mkdir(stage);
    await io.mkdir(backup);
    for (const name of names) {
      const target = path.join(directory, name);
      const sourceStat = await io.lstat(target);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
        throw new Error("unsafe source");
      const current = await io.readFile(target, "utf8");
      if (current !== baseline[name])
        throw new HomeSaveError(
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
    for (const name of replaced.reverse())
      try {
        await io.rename(path.join(backup, name), path.join(directory, name));
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    if (failures.length) {
      recoveryRequired = true;
      throw new HomeSaveError(
        `Home Save rollback failed; manual recovery required from ${backup}`,
        "home-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof HomeSaveError) throw error;
    throw new HomeSaveError(
      `Failed to save Home: ${error instanceof Error ? error.message : String(error)}`,
      "save-failed",
      { cause: error },
    );
  } finally {
    await Promise.all([
      io.rm(stage, { recursive: true, force: true }).catch(() => {}),
      recoveryRequired
        ? Promise.resolve()
        : io.rm(backup, { recursive: true, force: true }).catch(() => {}),
    ]);
  }
}

export async function saveHomeEditorDraft(
  draft: HomeEditorDraftState,
  baseline: HomeEditorDraftState,
  root = canonicalRoot,
  io: HomeSaveFileSystem = fs,
) {
  if (draft.contentId !== "home" || baseline.contentId !== "home")
    throw new HomeSaveError("Invalid Home Content ID", "invalid-content-id");
  if (!validateHomeEditorDraft(draft).capabilities.save)
    throw new HomeSaveError("Home draft has blocking issues", "invalid-draft");
  const entry = await readHomeEditorEntry(root);
  if (
    entry.shared.state !== "valid" ||
    entry.locales.ja.state !== "valid" ||
    entry.locales.en.state !== "valid"
  )
    throw new HomeSaveError("Canonical Home unavailable", "canonical-mismatch");
  const currentPreimages = {
    "index.yaml": entry.shared.raw,
    "ja.md": entry.locales.ja.raw,
    "en.md": entry.locales.en.raw,
  };
  if (names.some((name) => currentPreimages[name] !== baseline.preimages[name]))
    throw new HomeSaveError(
      "Canonical Home changed after load",
      "canonical-mismatch",
    );
  let saved: HomeEditorDraftState | undefined;
  const serializedDraft = serializeHomeEditorDraft(draft);
  await writeHomeSerializedFiles(
    serializedDraft,
    currentPreimages,
    root,
    io,
    async () => {
      saved = createHomeEditorDraft(await readHomeEditorEntry(root));
      const reread = serializeHomeEditorDraft(saved);
      const mismatches: string[] = names.filter(
        (name) => reread[name] !== serializedDraft[name],
      );
      if (JSON.stringify(saved.copyStatus) !== JSON.stringify(draft.copyStatus))
        mismatches.push("copy-status");
      if (mismatches.length)
        throw new Error(
          `Saved Home failed reread validation: ${mismatches.join(", ")}`,
        );
    },
  );
  if (!saved)
    throw new HomeSaveError("Saved Home was not verified", "save-failed");
  return saved;
}
