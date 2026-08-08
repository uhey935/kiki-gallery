import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";

export type FlatCreateErrorCode =
  | "invalid-content-id"
  | "invalid-draft"
  | "content-id-collision"
  | "unsafe-collection-root"
  | "canonical-mismatch"
  | "collection-create-rollback-failed"
  | "create-failed";

export class FlatCreateError extends Error {
  readonly code: FlatCreateErrorCode;

  constructor(
    message: string,
    code: FlatCreateErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FlatCreateError";
    this.code = code;
  }
}

export type FlatCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;

async function absentTarget(
  collectionLabel: string,
  contentId: string,
  root: string,
  fileSystem: FlatCreateFileSystem,
) {
  if (!isContentId(contentId))
    throw new FlatCreateError(
      `Invalid ${collectionLabel} Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const rootStat = await fileSystem.lstat(resolvedRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new FlatCreateError(
      `Canonical ${collectionLabel} root is not a safe directory`,
      "unsafe-collection-root",
    );
  const target = path.resolve(resolvedRoot, `${contentId}.md`);
  if (path.dirname(target) !== resolvedRoot)
    throw new FlatCreateError(
      `Invalid ${collectionLabel} Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const folded = `${contentId}.md`.toLocaleLowerCase("en-US");
  if (
    (await fileSystem.readdir(resolvedRoot)).some(
      (entry) => entry.toLocaleLowerCase("en-US") === folded,
    )
  )
    throw new FlatCreateError(
      `${collectionLabel} Content ID or case-fold equivalent already exists: ${contentId}`,
      "content-id-collision",
    );
  return target;
}

export async function createFlatEditorEntry<D>(input: {
  collectionId: string;
  collectionLabel: string;
  draft: D & { contentId: string };
  root: string;
  validate: (draft: D) => boolean;
  serialize: (draft: D) => string;
  reread: (contentId: string, root: string) => Promise<D | undefined>;
  fileSystem?: FlatCreateFileSystem;
}): Promise<D> {
  const fileSystem = input.fileSystem ?? fs;
  if (!input.validate(input.draft))
    throw new FlatCreateError(
      `${input.collectionLabel} draft has blocking validation issues`,
      "invalid-draft",
    );
  const target = await absentTarget(
    input.collectionLabel,
    input.draft.contentId,
    input.root,
    fileSystem,
  );
  const serialized = input.serialize(input.draft);
  const staged = path.join(
    path.resolve(input.root),
    `.${input.collectionId}-create-${input.draft.contentId}-${randomUUID()}.tmp`,
  );
  let committed = false;
  try {
    await fileSystem.writeFile(staged, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    const stagedStat = await fileSystem.lstat(staged);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink())
      throw new Error("Unsafe staged source");
    await absentTarget(
      input.collectionLabel,
      input.draft.contentId,
      input.root,
      fileSystem,
    );
    await fileSystem.rename(staged, target);
    committed = true;
    const canonical = await input.reread(input.draft.contentId, input.root);
    if (!canonical || input.serialize(canonical) !== serialized)
      throw new FlatCreateError(
        `Created ${input.collectionLabel} did not match the validated draft`,
        "canonical-mismatch",
      );
    return canonical;
  } catch (error) {
    if (committed) {
      try {
        if ((await fileSystem.readFile(target, "utf8")) !== serialized)
          throw new Error("created bytes changed before rollback");
        await fileSystem.rm(target, { force: false });
      } catch (rollbackError) {
        throw new FlatCreateError(
          `Failed to remove the exact created ${input.collectionLabel} after Create failed`,
          "collection-create-rollback-failed",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }
    if (error instanceof FlatCreateError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST")
      throw new FlatCreateError(
        `${input.collectionLabel} Content ID already exists: ${input.draft.contentId}`,
        "content-id-collision",
        { cause: error },
      );
    throw new FlatCreateError(
      `Failed to create ${input.collectionLabel}: ${input.draft.contentId}`,
      "create-failed",
      { cause: error },
    );
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
}
