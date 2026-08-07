import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  WORKS_ASSET_BASENAME,
  WORKS_ASSET_POLICY,
} from "./works-asset-policy.ts";
import {
  TemporaryWorksAssetStoreError,
  type TemporaryWorksAssetStore,
} from "./works-asset-store.ts";
import { admitWorksAssetUpload } from "./works-assets.ts";

export type MaterializedWorksAsset = {
  token: string;
  src: string;
  sha256: string;
  byteSize: number;
  format: "avif" | "jpg" | "png" | "webp";
  width: number;
  height: number;
};

export class WorksAssetMaterializationError extends Error {
  readonly code = "asset-materialization-failed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorksAssetMaterializationError";
  }
}

export type WorksAssetMaterializationFileSystem = Pick<
  typeof fs,
  "lstat" | "realpath" | "open" | "link" | "rm" | "readFile"
>;

export type WorksAssetMaterializationTransaction = {
  assets: MaterializedWorksAsset[];
  promote(): Promise<void>;
  rollback(): Promise<void>;
};

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function stageWorksAssetMaterializations(
  tokens: readonly string[],
  existingUrls: readonly string[],
  contentId: string,
  workspaceId: string,
  store: TemporaryWorksAssetStore,
  assetRoot = path.resolve("public/images/works"),
  fileSystem: WorksAssetMaterializationFileSystem = fs,
): Promise<WorksAssetMaterializationTransaction> {
  if (new Set(tokens).size !== tokens.length)
    throw new WorksAssetMaterializationError(
      "A temporary asset token may appear only once in a Save",
    );

  const requestedRoot = path.resolve(assetRoot);
  const rootStat = await fileSystem.lstat(requestedRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new WorksAssetMaterializationError("Canonical asset root is unsafe");
  const root = await fileSystem.realpath(requestedRoot);
  const verifyExistingReferences = async () => {
    for (const url of existingUrls) {
      if (!url.startsWith(WORKS_ASSET_POLICY.publicPrefix))
        throw new WorksAssetMaterializationError(
          "Existing asset URL is unsafe",
        );
      const basename = url.slice(WORKS_ASSET_POLICY.publicPrefix.length);
      const target = path.resolve(root, basename);
      const stat = await fileSystem.lstat(target).catch(() => undefined);
      if (
        !basename ||
        path.basename(basename) !== basename ||
        path.dirname(target) !== root ||
        !stat?.isFile() ||
        stat.isSymbolicLink()
      )
        throw new WorksAssetMaterializationError(
          "Existing asset reference is unsafe or missing",
        );
    }
  };
  await verifyExistingReferences();

  const staged: {
    file: string;
    target: string;
    asset: MaterializedWorksAsset;
  }[] = [];
  const created = new Set<string>();
  let promoted = false;
  const rollback = async () => {
    for (const item of staged) {
      await fileSystem.rm(item.file, { force: true }).catch(() => undefined);
      if (created.has(item.target))
        await fileSystem
          .rm(item.target, { force: true })
          .catch(() => undefined);
    }
    created.clear();
  };

  try {
    for (const token of tokens) {
      const { metadata, bytes } = await store.read(
        token,
        contentId,
        workspaceId,
      );
      const admission = admitWorksAssetUpload({
        filename: metadata.originalFilename,
        declaredMime: metadata.mime,
        bytes,
      });
      if (
        !admission.accepted ||
        admission.proposedUrl !== metadata.proposedUrl ||
        admission.sha256 !== metadata.sha256 ||
        admission.byteSize !== metadata.byteSize ||
        JSON.stringify(admission.media) !==
          JSON.stringify({
            format: metadata.format,
            mime: metadata.mime,
            width: metadata.width,
            height: metadata.height,
            frameCount: metadata.frameCount,
            animated: metadata.animated,
          })
      )
        throw new WorksAssetMaterializationError(
          "Temporary asset no longer satisfies admission policy",
        );
      if (!metadata.proposedUrl.startsWith(WORKS_ASSET_POLICY.publicPrefix))
        throw new WorksAssetMaterializationError(
          "Temporary asset URL is unsafe",
        );
      const basename = metadata.proposedUrl.slice(
        WORKS_ASSET_POLICY.publicPrefix.length,
      );
      const target = path.resolve(root, basename);
      if (
        !WORKS_ASSET_BASENAME.test(basename) ||
        basename.length > WORKS_ASSET_POLICY.maxBasenameLength ||
        path.dirname(target) !== root ||
        (await fileSystem.lstat(target).catch(() => undefined))
      )
        throw new WorksAssetMaterializationError(
          "Canonical asset target is unsafe or already exists",
        );
      const file = path.join(root, `.works-asset-${randomUUID()}.tmp`);
      const handle = await fileSystem.open(
        file,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const stagedStat = await fileSystem.lstat(file);
      const reread = await fileSystem.readFile(file);
      if (
        !stagedStat.isFile() ||
        stagedStat.isSymbolicLink() ||
        reread.byteLength !== metadata.byteSize ||
        digest(reread) !== metadata.sha256
      )
        throw new WorksAssetMaterializationError(
          "Staged canonical asset failed integrity verification",
        );
      staged.push({
        file,
        target,
        asset: {
          token,
          src: metadata.proposedUrl,
          sha256: metadata.sha256,
          byteSize: metadata.byteSize,
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
        },
      });
    }
  } catch (error) {
    await rollback();
    if (error instanceof TemporaryWorksAssetStoreError) throw error;
    if (error instanceof WorksAssetMaterializationError) throw error;
    throw new WorksAssetMaterializationError("Failed to stage Works assets", {
      cause: error,
    });
  }

  return {
    assets: staged.map(({ asset }) => structuredClone(asset)),
    async promote() {
      if (promoted) return;
      try {
        // Narrow the check-to-use window before canonical mutation. Existing
        // compatibility assets are checked for identity/safety, not subjected
        // retroactively to strict new-upload admission.
        await verifyExistingReferences();
        for (const item of staged) {
          await fileSystem.link(item.file, item.target);
          created.add(item.target);
          const targetStat = await fileSystem.lstat(item.target);
          const bytes = await fileSystem.readFile(item.target);
          if (
            !targetStat.isFile() ||
            targetStat.isSymbolicLink() ||
            bytes.byteLength !== item.asset.byteSize ||
            digest(bytes) !== item.asset.sha256
          )
            throw new Error("Promoted asset failed integrity verification");
        }
        promoted = true;
        for (const item of staged)
          await fileSystem.rm(item.file, { force: true });
      } catch (error) {
        await rollback();
        throw new WorksAssetMaterializationError(
          "Failed to promote Works assets without overwrite",
          { cause: error },
        );
      }
    },
    rollback,
  };
}
