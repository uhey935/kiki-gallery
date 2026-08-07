import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { JournalEditorDraftState } from "./journal-draft-state.ts";
import {
  createJournalEditorDraft,
  validateJournalEditorDraft,
} from "./journal-draft-state.ts";
import {
  type JournalSerializedFiles,
  serializeJournalEditorDraft,
} from "./journal-serializer.ts";
import { readJournalEditorEntry } from "./journal-state.ts";

const contentIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fileNames = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalJournalRoot = path.resolve("src/content/journal");

export class JournalSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "save-failed";

  constructor(
    message: string,
    code:
      | "invalid-content-id"
      | "invalid-draft"
      | "canonical-mismatch"
      | "save-failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalSaveError";
    this.code = code;
  }
}

export type JournalSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function resolveEntryDirectory(contentId: string, root: string) {
  if (!contentIdPattern.test(contentId)) {
    throw new JournalSaveError(
      `Invalid Journal Content ID: ${contentId}`,
      "invalid-content-id",
    );
  }
  const resolvedRoot = path.resolve(root);
  const directory = path.resolve(resolvedRoot, contentId);
  if (path.dirname(directory) !== resolvedRoot) {
    throw new JournalSaveError(
      `Invalid Journal Content ID: ${contentId}`,
      "invalid-content-id",
    );
  }
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new JournalSaveError(
      `Invalid Journal entry directory: ${contentId}`,
      "invalid-content-id",
    );
  }
  return directory;
}

export async function writeJournalSerializedFiles(
  contentId: string,
  files: JournalSerializedFiles,
  baselineFiles: JournalSerializedFiles,
  root = canonicalJournalRoot,
  fileSystem: JournalSaveFileSystem = fs,
): Promise<void> {
  const directory = await resolveEntryDirectory(contentId, root);
  const transaction = `.journal-save-${randomUUID()}`;
  const stageDirectory = path.join(directory, `${transaction}-stage`);
  const backupDirectory = path.join(directory, `${transaction}-backup`);
  const replaced: (typeof fileNames)[number][] = [];

  try {
    await fileSystem.mkdir(stageDirectory);
    await fileSystem.mkdir(backupDirectory);
    for (const fileName of fileNames) {
      const target = path.join(directory, fileName);
      const stat = await fileSystem.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Journal source is not a regular file: ${fileName}`);
      }
      await fileSystem.writeFile(
        path.join(stageDirectory, fileName),
        files[fileName],
        { encoding: "utf8", flag: "wx" },
      );
      const canonical = await fileSystem.readFile(target, "utf8");
      if (canonical !== baselineFiles[fileName]) {
        throw new JournalSaveError(
          "Canonical Journal files changed while Save was preparing replacements",
          "canonical-mismatch",
        );
      }
      await fileSystem.writeFile(
        path.join(backupDirectory, fileName),
        canonical,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
    }

    for (const fileName of fileNames) {
      await fileSystem.rename(
        path.join(stageDirectory, fileName),
        path.join(directory, fileName),
      );
      replaced.push(fileName);
    }
  } catch (error) {
    for (const fileName of replaced.reverse()) {
      await fileSystem
        .rename(
          path.join(backupDirectory, fileName),
          path.join(directory, fileName),
        )
        .catch(() => undefined);
    }
    if (error instanceof JournalSaveError) throw error;
    throw new JournalSaveError(
      `Failed to save Journal entry: ${contentId}`,
      "save-failed",
      { cause: error },
    );
  } finally {
    await Promise.all([
      fileSystem.rm(stageDirectory, { recursive: true, force: true }),
      fileSystem.rm(backupDirectory, { recursive: true, force: true }),
    ]);
  }
}

export async function saveJournalEditorDraft(
  draft: JournalEditorDraftState,
  baseline: JournalEditorDraftState,
  root = canonicalJournalRoot,
  fileSystem: JournalSaveFileSystem = fs,
): Promise<JournalEditorDraftState> {
  if (!contentIdPattern.test(draft.contentId)) {
    throw new JournalSaveError(
      `Invalid Journal Content ID: ${draft.contentId}`,
      "invalid-content-id",
    );
  }
  const validation = validateJournalEditorDraft(draft);
  if (!validation.capabilities.save) {
    throw new JournalSaveError(
      "Journal draft has blocking validation issues",
      "invalid-draft",
    );
  }
  if (draft.contentId !== baseline.contentId) {
    throw new JournalSaveError(
      "Journal draft and baseline Content IDs do not match",
      "canonical-mismatch",
    );
  }
  const canonicalEntry = await readJournalEditorEntry(draft.contentId, root);
  const canonical = createJournalEditorDraft(canonicalEntry);
  if (JSON.stringify(baseline) !== JSON.stringify(canonical)) {
    throw new JournalSaveError(
      "Canonical Journal files changed after the Editor baseline was loaded",
      "canonical-mismatch",
    );
  }
  if (
    canonicalEntry.shared.state !== "valid" ||
    canonicalEntry.locales.ja.state !== "valid" ||
    canonicalEntry.locales.en.state !== "valid"
  ) {
    throw new JournalSaveError(
      "Canonical Journal sources are unavailable",
      "canonical-mismatch",
    );
  }
  const baselineFiles: JournalSerializedFiles = {
    "index.yaml": canonicalEntry.shared.raw,
    "ja.md": canonicalEntry.locales.ja.raw,
    "en.md": canonicalEntry.locales.en.raw,
  };
  const files = serializeJournalEditorDraft(draft);
  await writeJournalSerializedFiles(
    draft.contentId,
    files,
    baselineFiles,
    root,
    fileSystem,
  );
  return createJournalEditorDraft(
    await readJournalEditorEntry(draft.contentId, root),
  );
}
