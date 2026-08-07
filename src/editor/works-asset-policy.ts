export const WORKS_ASSET_POLICY = Object.freeze({
  publicPrefix: "/images/works/",
  canonicalExtensions: ["avif", "jpg", "png", "webp"] as const,
  allowedMimeTypes: [
    "image/avif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ] as const,
  maxBasenameLength: 120,
  maxBytes: 20 * 1024 * 1024,
  maxDimension: 12_000,
  maxPixels: 40_000_000,
});

export type WorksAssetFormat =
  (typeof WORKS_ASSET_POLICY.canonicalExtensions)[number];

export const WORKS_ASSET_MIME: Record<WorksAssetFormat, string> = {
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const WORKS_ASSET_BASENAME =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\.(avif|jpg|png|webp)$/;
