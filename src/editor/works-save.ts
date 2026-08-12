import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";
import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import {
  serializeWorksEditorUnit,
  type SerializedWorksUnit,
} from "./works-serializer.ts";
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
const contentHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function persistWorksSaveRecovery(
  root: string,
  contentId: string,
  evidence: Record<string, unknown>,
  evidenceKind?: "asset",
) {
  const file = path.join(
    root,
    `.works-save-recovery-${contentId}${evidenceKind ? `-${evidenceKind}` : ""}.json`,
  );
  await fs.writeFile(
    file,
    `${JSON.stringify({ version: 1, collection: "works", contentId, status: "manual-recovery-required", ...evidence }, null, 2)}\n`,
    { flag: "wx" },
  );
  return file;
}

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
    | "publish-evidence-invalid"
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
      | "publish-evidence-invalid"
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

async function resolveUnit(
  contentId: string,
  root: string,
  fileSystem: WorksSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new WorksSaveError(
      `Invalid Works Content ID: ${contentId}`,
      "invalid-content-id",
    );
  const directory = path.join(path.resolve(root), contentId);
  const stat = await fileSystem.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new WorksSaveError(
      `Unsafe Works unit: ${contentId}`,
      "invalid-content-id",
    );
  const paths = {
    shared: path.join(directory, "index.yaml"),
    ja: path.join(directory, "ja.md"),
    en: path.join(directory, "en.md"),
  };
  for (const file of Object.values(paths)) {
    const item = await fileSystem.lstat(file).catch(() => undefined);
    if (!item?.isFile() || item.isSymbolicLink())
      throw new WorksSaveError(
        `Unsafe Works unit: ${contentId}`,
        "invalid-content-id",
      );
  }
  return paths;
}

export async function writeWorksSerializedUnit(
  contentId: string,
  serialized: SerializedWorksUnit,
  baseline: SerializedWorksUnit,
  root = canonicalWorksRoot,
  fileSystem: WorksSaveFileSystem = fs,
) {
  const paths = await resolveUnit(contentId, root, fileSystem);
  for (const key of ["shared", "ja", "en"] as const)
    if ((await fileSystem.readFile(paths[key], "utf8")) !== baseline[key])
      throw new WorksSaveError(
        `Canonical Works ${key} changed`,
        "canonical-mismatch",
      );
  const staged = {} as Record<keyof SerializedWorksUnit, string>;
  const installed: (keyof SerializedWorksUnit)[] = [];
  try {
    for (const key of ["shared", "ja", "en"] as const) {
      staged[key] = `${paths[key]}.works-save-${randomUUID()}.tmp`;
      await fileSystem.writeFile(staged[key], serialized[key], {
        encoding: "utf8",
        flag: "wx",
      });
    }
    for (const key of ["shared", "ja", "en"] as const) {
      await fileSystem.rename(staged[key], paths[key]);
      installed.push(key);
    }
    for (const key of ["shared", "ja", "en"] as const)
      if ((await fileSystem.readFile(paths[key], "utf8")) !== serialized[key])
        throw new Error(`Works ${key} reread mismatch`);
  } catch (error) {
    const rollbackErrors = [];
    for (const key of [...installed].reverse())
      try {
        const restore = `${paths[key]}.works-rollback-${randomUUID()}.tmp`;
        await fileSystem.writeFile(restore, baseline[key], {
          encoding: "utf8",
          flag: "wx",
        });
        await fileSystem.rename(restore, paths[key]);
      } catch (e) {
        rollbackErrors.push(e);
      }
    if (rollbackErrors.length) {
      const observed = Object.fromEntries(
        await Promise.all(
          (["shared", "ja", "en"] as const).map(async (key) => {
            try {
              const value = await fileSystem.readFile(paths[key], "utf8");
              return [
                paths[key],
                {
                  sha256: contentHash(value),
                  byteLength: Buffer.byteLength(value),
                },
              ];
            } catch (readError) {
              return [paths[key], { readError: String(readError) }];
            }
          }),
        ),
      );
      const evidencePath = await persistWorksSaveRecovery(root, contentId, {
        failureCode: "content-rollback-failed",
        affectedPaths: Object.values(paths),
        installed,
        baseline: Object.fromEntries(
          (["shared", "ja", "en"] as const).map((key) => [
            paths[key],
            {
              sha256: contentHash(baseline[key]),
              byteLength: Buffer.byteLength(baseline[key]),
            },
          ]),
        ),
        observed,
        rollbackErrors: rollbackErrors.map(String),
      });
      throw new WorksSaveError(
        `Works three-file rollback failed; recovery evidence: ${evidencePath}`,
        "asset-save-rollback-failed",
        { cause: error },
      );
    }
    if (error instanceof WorksSaveError) throw error;
    throw new WorksSaveError("Works three-file Save failed", "save-failed", {
      cause: error,
    });
  } finally {
    for (const file of Object.values(staged))
      if (file)
        await fileSystem.rm(file, { force: true }).catch(() => undefined);
  }
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
  if (!canonicalEntry.rawFiles || !draft.sourceFiles)
    throw new WorksSaveError("Three-file baseline required", "invalid-draft");
  await writeWorksSerializedUnit(
    draft.contentId,
    serializeWorksEditorUnit(draft),
    canonicalEntry.rawFiles,
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
  createPublishManifest?: typeof createWorksAssetPublishManifest;
  rereadSavedEntry?: typeof readWorksEditorEntry;
  validateReread?: (draft: WorksEditorDraftState) => void;
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
  if (!finalDraft.localized || !canonicalEntry.rawFiles)
    throw new WorksSaveError(
      "Three-file localized baseline required",
      "invalid-draft",
    );
  const enAltBySource = new Map(
    baseline.data.images.map((image, index) => [
      image.src,
      baseline.localized?.en.images[index]?.alt,
    ]),
  );
  finalDraft.localized.ja.images = finalDraft.data.images.map((image) => ({
    alt: image.alt,
  }));
  finalDraft.localized.en.images = normalizedAssetDraft.images.map(
    (image, index) => {
      const originalDraftImage = assetDraft.images[index];
      const originalSrc =
        originalDraftImage.kind === "temporary" && originalDraftImage.replaced
          ? originalDraftImage.replaced.src
          : image.kind === "existing"
            ? image.src
            : undefined;
      return {
        alt:
          (originalSrc && enAltBySource.get(originalSrc)) ||
          `__TODO_WORK_IMAGE_ALT_${index + 1}__`,
      };
    },
  );

  const serializedUnit = serializeWorksEditorUnit(finalDraft);
  let markdownCommitted = false;
  let saved: WorksEditorDraftState;
  try {
    if (!validateWorksEditorDraft(finalDraft).capabilities.save)
      throw new WorksSaveError(
        "Works draft has blocking validation issues",
        "invalid-draft",
      );
    await transaction.promote();
    await writeWorksSerializedUnit(
      draft.contentId,
      serializedUnit,
      canonicalEntry.rawFiles,
      root,
      fileSystem,
    );
    markdownCommitted = true;
    const reread = createWorksEditorDraft(
      await (options.rereadSavedEntry ?? readWorksEditorEntry)(
        draft.contentId,
        root,
      ),
    );
    if (
      !reread ||
      JSON.stringify(reread.sourceFiles) !== JSON.stringify(serializedUnit)
    )
      throw new WorksSaveError(
        "Saved Works source failed canonical verification",
        "asset-save-failed",
      );
    options.validateReread?.(reread);
    saved = reread;
  } catch (error) {
    if (markdownCommitted) {
      try {
        await writeWorksSerializedUnit(
          draft.contentId,
          canonicalEntry.rawFiles,
          serializedUnit,
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
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      const assetRoot = path.resolve(
        options.assetRoot ?? "public/images/works",
      );
      const promotedAssets = await Promise.all(
        transaction.assets.map(async (asset) => {
          const target = path.join(assetRoot, path.basename(asset.src));
          try {
            const bytes = await fs.readFile(target);
            return {
              ...asset,
              path: target,
              expectedGeneration: asset.sha256,
              observedSha256: createHash("sha256").update(bytes).digest("hex"),
              observedByteSize: bytes.byteLength,
            };
          } catch (readError) {
            return { ...asset, path: target, readError: String(readError) };
          }
        }),
      );
      const tempTokenState = await Promise.all(
        tokens.map(async (token) => {
          try {
            await options.store.read(
              token,
              draft.contentId,
              assetDraft.workspaceId,
            );
            return { token, state: "retained" };
          } catch (readError) {
            return { token, state: "unavailable", readError: String(readError) };
          }
        }),
      );
      const evidencePath = await persistWorksSaveRecovery(
        root,
        draft.contentId,
        {
          failureCode: "asset-rollback-failed",
          contentRollbackSucceeded: !(
            error instanceof WorksSaveError &&
            error.code === "asset-save-rollback-failed"
          ),
          promotedAssets,
          tempTokenState,
          rollbackError: String(rollbackError),
        },
        "asset",
      );
      throw new WorksSaveError(
        `Works asset rollback failed; recovery evidence: ${evidencePath}`,
        "asset-save-rollback-failed",
        { cause: rollbackError },
      );
    }
    if (error instanceof WorksSaveError) throw error;
    throw new WorksSaveError("Works asset Save failed", "asset-save-failed", {
      cause:
        error instanceof WorksAssetMaterializationError ? error : undefined,
    });
  }
  // Publish evidence must exist before the temporary source is finalized.
  // If evidence generation fails, canonical Save remains authoritative and the
  // still-readable token permits an operator to retry evidence generation.
  let publishManifest: WorksAssetPublishManifest;
  try {
    publishManifest = (
      options.createPublishManifest ?? createWorksAssetPublishManifest
    )(saved.contentId, saved.sourceRaw, transaction.assets);
  } catch (error) {
    throw new WorksSaveError(
      "Works Save succeeded but Publish evidence generation failed",
      "publish-evidence-invalid",
      { cause: error },
    );
  }
  // Cleanup occurs only after canonical reread and Publish evidence generation.
  await Promise.allSettled(
    tokens.map((token) =>
      options.store.release(token, draft.contentId, assetDraft.workspaceId),
    ),
  );
  return {
    draft: saved,
    assetDraft: normalizedAssetDraft,
    publishManifest,
  };
}
