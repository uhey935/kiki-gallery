import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadJournalUnit } from "../content-loaders/journal/repository.ts";
import type { JournalLocalized } from "../content-loaders/journal/schema.ts";
import { isContentId } from "./content-id.ts";
import type { JournalEditorDraftState } from "./journal-draft-state.ts";
import {
  createJournalEditorDraft,
  type JournalEditorSharedDraft,
  validateJournalEditorDraft,
} from "./journal-draft-state.ts";
import { serializeJournalEditorDraft } from "./journal-serializer.ts";
import { readJournalEditorEntry } from "./journal-state.ts";

const fileNames = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalJournalRoot = path.resolve("src/content/journal");

export class JournalCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "unsafe-journal-root"
    | "canonical-mismatch"
    | "journal-create-rollback-failed"
    | "create-failed";

  constructor(
    message: string,
    code: JournalCreateError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalCreateError";
    this.code = code;
  }
}

export type JournalCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;

export function createNewJournalDraft(
  contentId: string,
): JournalEditorDraftState {
  const shared: JournalEditorSharedDraft = {
    visibility: "draft",
    date: "",
    category: "",
    hero: { image: "" },
  };
  const localized = (): JournalLocalized & { body: string } => ({
    title: "",
    summary: "",
    hero_alt: "",
    body: "",
  });
  return {
    contentId,
    shared: { state: "editable", value: shared },
    locales: {
      ja: { state: "editable", value: localized() },
      en: { state: "editable", value: localized() },
    },
  };
}

async function assertSafeAbsentDestination(
  contentId: string,
  root: string,
  fileSystem: JournalCreateFileSystem,
): Promise<string> {
  if (!isContentId(contentId))
    throw new JournalCreateError(
      `Invalid Journal Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const rootStat = await fileSystem.lstat(resolvedRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new JournalCreateError(
      "Canonical Journal root is not a safe directory",
      "unsafe-journal-root",
    );
  const destination = path.resolve(resolvedRoot, contentId);
  if (path.dirname(destination) !== resolvedRoot)
    throw new JournalCreateError(
      `Invalid Journal Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const entries = await fileSystem.readdir(resolvedRoot);
  if (
    entries.some(
      (entry) =>
        entry.toLocaleLowerCase("en-US") ===
        contentId.toLocaleLowerCase("en-US"),
    )
  )
    throw new JournalCreateError(
      `Journal Content ID or case-fold equivalent already exists: ${contentId}`,
      "content-id-collision",
    );
  return destination;
}

export async function createJournalEditorEntry(
  draft: JournalEditorDraftState,
  root = canonicalJournalRoot,
  fileSystem: JournalCreateFileSystem = fs,
): Promise<JournalEditorDraftState> {
  const validation = validateJournalEditorDraft(draft);
  if (!validation.capabilities.save)
    throw new JournalCreateError(
      "Journal draft has blocking validation issues",
      "invalid-draft",
    );
  const destination = await assertSafeAbsentDestination(
    draft.contentId,
    root,
    fileSystem,
  );
  const stageRoot = path.join(
    path.resolve(root),
    `.journal-create-${randomUUID()}`,
  );
  const stageDirectory = path.join(stageRoot, draft.contentId);
  const files = serializeJournalEditorDraft(draft);
  let committed = false;
  try {
    await fileSystem.mkdir(stageRoot);
    await fileSystem.mkdir(stageDirectory);
    for (const fileName of fileNames)
      await fileSystem.writeFile(
        path.join(stageDirectory, fileName),
        files[fileName],
        {
          encoding: "utf8",
          flag: "wx",
        },
      );

    const staged = await loadJournalUnit(stageDirectory);
    if (
      staged.issues.length > 0 ||
      staged.shared.state !== "valid" ||
      staged.locales.ja.state !== "valid" ||
      staged.locales.en.state !== "valid"
    )
      throw new JournalCreateError(
        "Serialized Journal Content Unit failed canonical validation",
        "canonical-mismatch",
      );

    await assertSafeAbsentDestination(draft.contentId, root, fileSystem);
    await fileSystem.rename(stageDirectory, destination);
    committed = true;
    const canonical = createJournalEditorDraft(
      await readJournalEditorEntry(draft.contentId, root),
    );
    const canonicalFiles = serializeJournalEditorDraft(canonical);
    if (
      fileNames.some((fileName) => canonicalFiles[fileName] !== files[fileName])
    )
      throw new JournalCreateError(
        "Created Journal Content Unit did not match the validated draft",
        "canonical-mismatch",
      );
    return canonical;
  } catch (error) {
    if (committed) {
      try {
        const currentFiles = await Promise.all(
          fileNames.map((fileName) =>
            fileSystem.readFile(path.join(destination, fileName), "utf8"),
          ),
        );
        if (
          fileNames.some(
            (fileName, index) => currentFiles[index] !== files[fileName],
          )
        )
          throw new Error("created bytes changed before rollback");
        await fileSystem.rm(destination, { recursive: true, force: false });
      } catch (rollbackError) {
        throw new JournalCreateError(
          `Failed to remove the exact created Journal unit after Create failed: ${draft.contentId}`,
          "journal-create-rollback-failed",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }
    if (error instanceof JournalCreateError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY")
      throw new JournalCreateError(
        `Journal Content ID already exists: ${draft.contentId}`,
        "content-id-collision",
        { cause: error },
      );
    throw new JournalCreateError(
      `Failed to create Journal entry: ${draft.contentId}`,
      "create-failed",
      { cause: error },
    );
  } finally {
    await fileSystem
      .rm(stageRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
