import { createHash } from "node:crypto";

import type { MaterializedWorksAsset } from "./works-asset-materialization.ts";

export type WorksAssetPublishManifestEntry = Omit<
  MaterializedWorksAsset,
  "token"
> & {
  mime: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
};

export type WorksAssetPublishManifest = {
  contentId: string;
  baselineSha256: string;
  contentPaths: [string, string, string];
  assets: WorksAssetPublishManifestEntry[];
};

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const mimeByFormat = {
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export function createWorksAssetPublishManifest(
  contentId: string,
  sourceRaw: string,
  assets: readonly MaterializedWorksAsset[],
): WorksAssetPublishManifest {
  return {
    contentId,
    baselineSha256: sha256(sourceRaw),
    contentPaths: [
      `src/content/works/${contentId}/index.yaml`,
      `src/content/works/${contentId}/ja.md`,
      `src/content/works/${contentId}/en.md`,
    ],
    assets: assets.map(({ src, sha256, byteSize, format, width, height }) => ({
      src,
      sha256,
      byteSize,
      format,
      width,
      height,
      mime: mimeByFormat[format],
    })),
  };
}
