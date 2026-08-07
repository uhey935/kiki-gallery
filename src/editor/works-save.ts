import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";
import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import { serializeWorksEditorDraft } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import type { WorksAssetDraftState } from "./works-asset-draft.ts";
import {
  stageWorksAssetMaterializations,
  WorksAssetMaterializationError,
  type WorksAssetMaterializationFileSystem,
} from "./works-asset-materialization.ts";
import {
  TemporaryWorksAssetStoreError,
  type TemporaryWorksAssetStore,
} from "./works-asset-store.ts";
import {
  createWorksAssetPublishManifest,
  type WorksAssetPublishManifest,
} from "./works-asset-publish-manifest.ts";

const canonicalWorksRoot = path.resolve("src/content/works");

export class WorksSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "asset-save-failed"
    | "asset-save-rollback-failed"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "save-failed";

  constructor(
    message: string,
    code:
      | "invalid-content-id"
      | "invalid-draft"
      | "canonical-mismatch"
      | "asset-save-failed"
      | "asset-save-rollback-failed"
      | "asset-temp-not-found"
      | "asset-temp-expired"
      | "asset-temp-unsafe"
      | "save-failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksSaveError";
    this.code = code;
  }
}

export type WorksSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function resolveTarget(
  contentId: string,
  root: string,
  fileSystem: WorksSaveFileSystem,
): Promise<string> {
  if (!isContentId(contentId))
    throw new WorksSaveError(
      `Invalid Works Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const rootStat = await fileSystem.lstat(resolvedRoot).catch(() => undefined);
  const target = path.resolve(resolvedRoot, `${contentId}.md`);
  const targetStat = await fileSystem.lstat(target).catch(() => undefined);
  if (
    path.dirname(target) !== resolvedRoot ||
    !rootStat?.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !targetStat?.isFile() ||
    targetStat.isSymbolicLink()
  )
    throw new WorksSaveError(
      `Unsafe Works source: ${contentId}`,
      "invalid-content-id",
    );
  return target;
}

export async function writeWorksSerializedFile(
  contentId: string,
  serialized: string,
  baselineRaw: string,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
): Promise<void> {
  const target = await resolveTarget(contentId, root, fileSystem);
  const staged = path.join(
    path.dirname(target),
    `.works-save-${contentId}-${randomUUID()}.tmp`,
  );
  try {
    await fileSystem.writeFile(staged, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    const stagedStat = await fileSystem.lstat(staged);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink())
      throw new Error("Staged Works source is not a regular file");
    if ((await fileSystem.readFile(target, "utf8")) !== baselineRaw)
      throw new WorksSaveError(
        "Canonical Works file changed while Save was preparing replacement",
        "canonical-mismatch",
      );
    await fileSystem.rename(staged, target);
  } catch (error) {
    if (error instanceof WorksSaveError) throw error;
    throw new WorksSaveError(
      `Failed to save Works entry: ${contentId}`,
      "save-failed",
      { cause: error },
    );
  } finally {
    await fileSystem.rm(staged, { force: true }).catch(() => undefined);
  }
}

export async function saveWorksEditorDraft(
  draft: WorksEditorDraftState,
  baseline: WorksEditorDraftState,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
): Promise<WorksEditorDraftState> {
  if (!isContentId(draft.contentId))
    throw new WorksSaveError(
      `Invalid Works Content ID: ${draft.contentId}`,
      "invalid-content-id",
    );
  if (!validateWorksEditorDraft(draft).capabilities.save)
    throw new WorksSaveError(
      "Works draft has blocking validation issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new WorksSaveError(
      "Works draft and baseline Content IDs do not match",
      "canonical-mismatch",
    );
  const canonicalEntry = await readWorksEditorEntry(draft.contentId, root);
  const canonical = createWorksEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(baseline) !== JSON.stringify(canonical))
    throw new WorksSaveError(
      "Canonical Works file changed after the Editor baseline was loaded",
      "canonical-mismatch",
    );
  await writeWorksSerializedFile(
    draft.contentId,
    serializeWorksEditorDraft(draft),
    canonicalEntry.raw,
    root,
    fileSystem,
  );
  const saved = createWorksEditorDraft(
    await readWorksEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new WorksSaveError("Saved Works source is invalid", "save-failed");
  return saved;
}

export type WorksAssetSaveOptions = {
  assetDraft: WorksAssetDraftState;
  store: TemporaryWorksAssetStore;
  assetRoot?: string;
  assetFileSystem?: WorksAssetMaterializationFileSystem;
};

export type WorksAssetSaveResult = {
  draft: WorksEditorDraftState;
  assetDraft: WorksAssetDraftState;
  publishManifest: WorksAssetPublishManifest;
};

export async function saveWorksEditorDraftWithAssets(
  draft: WorksEditorDraftState,
  baseline: WorksEditorDraftState,
  options: WorksAssetSaveOptions,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
): Promise<WorksAssetSaveResult> {
  const { assetDraft } = options;
  if (
    assetDraft.contentId !== draft.contentId ||
    !assetDraft.workspaceId ||
    !Array.isArray(assetDraft.images)
  )
    throw new WorksSaveError(
      "Asset Draft ownership is invalid",
      "invalid-draft",
    );

  // Keep the established Markdown baseline check ahead of every asset mutation.
  const canonicalEntry = await readWorksEditorEntry(draft.contentId, root);
  const canonical = createWorksEditorDraft(canonicalEntry);
  if (!canonical || JSON.stringify(baseline) !== JSON.stringify(canonical))
    throw new WorksSaveError(
      "Canonical Works file changed after the Editor baseline was loaded",
      "canonical-mismatch",
    );

  const tokens = assetDraft.images.flatMap((image) =>
    image.kind === "temporary" ? [image.token] : [],
  );
  let transaction;
  try {
    transaction = await stageWorksAssetMaterializations(
      tokens,
      assetDraft.images.flatMap((image) =>
        image.kind === "existing" ? [image.src] : [],
      ),
      draft.contentId,
      assetDraft.workspaceId,
      options.store,
      options.assetRoot,
      options.assetFileSystem,
    );
  } catch (error) {
    if (
      error instanceof TemporaryWorksAssetStoreError &&
      error.code !== "asset-temp-invalid"
    )
      throw new WorksSaveError(error.message, error.code, { cause: error });
    throw new WorksSaveError(
      "Works asset validation failed",
      "asset-save-failed",
      {
        cause: error,
      },
    );
  }
  const byToken = new Map(
    transaction.assets.map((asset) => [asset.token, asset]),
  );
  const normalizedAssetDraft: WorksAssetDraftState = {
    contentId: assetDraft.contentId,
    workspaceId: assetDraft.workspaceId,
    images: assetDraft.images.map((image) =>
      image.kind === "existing"
        ? structuredClone(image)
        : {
            kind: "existing" as const,
            src: byToken.get(image.token)!.src,
            alt: image.alt,
          },
    ),
  };
  const finalDraft = structuredClone(draft);
  finalDraft.data.images = normalizedAssetDraft.images.map((image) => {
    if (image.kind !== "existing")
      throw new WorksSaveError(
        "Asset Draft normalization failed",
        "invalid-draft",
      );
    return { src: image.src, alt: image.alt };
  });

  const serialized = serializeWorksEditorDraft(finalDraft);
  let markdownCommitted = false;
  let saved: WorksEditorDraftState;
  try {
    if (!validateWorksEditorDraft(finalDraft).capabilities.save)
      throw new WorksSaveError(
        "Works draft has blocking validation issues",
        "invalid-draft",
      );
    await transaction.promote();
    await writeWorksSerializedFile(
      draft.contentId,
      serialized,
      canonicalEntry.raw,
      root,
      fileSystem,
    );
    markdownCommitted = true;
    const reread = createWorksEditorDraft(
      await readWorksEditorEntry(draft.contentId, root),
    );
    if (!reread || reread.sourceRaw !== serialized)
      throw new WorksSaveError(
        "Saved Works source failed canonical verification",
        "asset-save-failed",
      );
    saved = reread;
  } catch (error) {
    if (markdownCommitted) {
      try {
        await writeWorksSerializedFile(
          draft.contentId,
          canonicalEntry.raw,
          serialized,
          root,
          fileSystem,
        );
      } catch (rollbackError) {
        throw new WorksSaveError(
          "Works asset Save rollback failed",
          "asset-save-rollback-failed",
          { cause: rollbackError },
        );
      }
    }
    await transaction.rollback();
    if (error instanceof WorksSaveError) throw error;
    throw new WorksSaveError("Works asset Save failed", "asset-save-failed", {
      cause:
        error instanceof WorksAssetMaterializationError ? error : undefined,
    });
  }
  // Cleanup occurs only after the canonical unit has been reread successfully.
  // A cleanup failure must not undo a now-visible Markdown reference.
  await Promise.allSettled(
    tokens.map((token) =>
      options.store.release(token, draft.contentId, assetDraft.workspaceId),
    ),
  );
  return {
    draft: saved,
    assetDraft: normalizedAssetDraft,
    publishManifest: createWorksAssetPublishManifest(
      saved.contentId,
      saved.sourceRaw,
      transaction.assets,
    ),
  };
}
