import { promises as fs } from "node:fs";
import path from "node:path";

import {
  inspectArtistsHeroCandidate,
  ARTISTS_HERO_PREFIX,
} from "./artists-hero-assets.ts";
import {
  HeroAssetPublishEvidenceError,
  heroPublishSha256,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";

export const artistsContentPaths = (contentId: string) =>
  (["index.yaml", "ja.md", "en.md"] as const).map((name) =>
    path.posix.join("src/content/artists", contentId, name),
  ) as [string, string, string];

export async function artistsContentEvidence(
  repositoryRoot: string,
  contentId: string,
  contentRoot = path.join(repositoryRoot, "src/content/artists"),
) {
  return Promise.all(
    (["index.yaml", "ja.md", "en.md"] as const).map(async (name) => {
      const absolute = path.join(contentRoot, contentId, name);
      const file = path
        .relative(repositoryRoot, absolute)
        .split(path.sep)
        .join("/");
      const stat = await fs.lstat(absolute).catch(() => undefined);
      if (!stat?.isFile() || stat.isSymbolicLink())
        throw new HeroAssetPublishEvidenceError(
          "Canonical Artist content is unsafe",
          "publish-evidence-invalid",
        );
      const bytes = await fs.readFile(absolute);
      return {
        path: file,
        sha256: heroPublishSha256(bytes),
        byteSize: bytes.byteLength,
      };
    }),
  );
}

export function resolveArtistsHeroAssetPath(
  repositoryRoot: string,
  src: string,
) {
  if (!src.startsWith(ARTISTS_HERO_PREFIX))
    throw new HeroAssetPublishEvidenceError(
      "Artists Hero asset URL is outside its adapter prefix",
      "publish-evidence-invalid",
    );
  const basename = src.slice(ARTISTS_HERO_PREFIX.length);
  if (!basename || path.posix.basename(basename) !== basename)
    throw new HeroAssetPublishEvidenceError(
      "Artists Hero asset URL is unsafe",
      "publish-evidence-invalid",
    );
  const relative = path.posix.join("public/images/artists", basename);
  const root = path.resolve(repositoryRoot, "public/images/artists");
  const absolute = path.resolve(repositoryRoot, relative);
  if (path.dirname(absolute) !== root)
    throw new HeroAssetPublishEvidenceError(
      "Artists Hero asset path is unsafe",
      "publish-evidence-invalid",
    );
  return { relative, absolute, root };
}

export async function artistsAssetEvidence(
  repositoryRoot: string,
  contentId: string,
  src: string,
  declaredMime: string,
  assetRoot = path.join(repositoryRoot, "public/images/artists"),
) {
  const basename = src.startsWith(ARTISTS_HERO_PREFIX)
    ? src.slice(ARTISTS_HERO_PREFIX.length)
    : "";
  if (!basename || path.posix.basename(basename) !== basename)
    throw new HeroAssetPublishEvidenceError(
      "Artists Hero asset URL is unsafe",
      "publish-evidence-invalid",
    );
  const resolved = {
    root: path.resolve(assetRoot),
    absolute: path.resolve(assetRoot, basename),
    relative: path
      .relative(repositoryRoot, path.resolve(assetRoot, basename))
      .split(path.sep)
      .join("/"),
  };
  if (path.dirname(resolved.absolute) !== resolved.root)
    throw new HeroAssetPublishEvidenceError(
      "Artists Hero asset path is unsafe",
      "publish-evidence-invalid",
    );
  const rootStat = await fs.lstat(resolved.root).catch(() => undefined);
  const stat = await fs.lstat(resolved.absolute).catch(() => undefined);
  const parent = await fs
    .realpath(path.dirname(resolved.absolute))
    .catch(() => undefined);
  if (
    !rootStat?.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !stat?.isFile() ||
    stat.isSymbolicLink() ||
    parent !== (await fs.realpath(resolved.root))
  )
    throw new HeroAssetPublishEvidenceError(
      "Canonical Artists Hero asset is unsafe",
      "publish-evidence-invalid",
    );
  const bytes = await fs.readFile(resolved.absolute);
  const inspected = await inspectArtistsHeroCandidate({
    contentId,
    declaredMime,
    bytes,
  });
  if (inspected.proposedSrc !== src)
    throw new HeroAssetPublishEvidenceError(
      "Canonical Artists Hero asset does not match its decoded target",
      "publish-evidence-invalid",
    );
  return {
    src,
    path: resolved.relative,
    sha256: inspected.sha256,
    byteSize: inspected.byteSize,
    format: inspected.media.format,
    mime: inspected.media
      .mime as HeroAssetPublishEvidenceV1["assets"][number]["mime"],
    width: inspected.media.width,
    height: inspected.media.height,
  } satisfies HeroAssetPublishEvidenceV1["assets"][number];
}

export async function createArtistsHeroPublishEvidence(input: {
  repositoryRoot: string;
  contentId: string;
  src: string;
  declaredMime: string;
  operation: "hero-asset-save" | "hero-asset-create";
  createdAt?: string;
  contentRoot?: string;
  assetRoot?: string;
}) {
  return {
    version: 1,
    state: "pending",
    operation: input.operation,
    collection: "artists",
    contentId: input.contentId,
    content: await artistsContentEvidence(
      input.repositoryRoot,
      input.contentId,
      input.contentRoot,
    ),
    assets: [
      await artistsAssetEvidence(
        input.repositoryRoot,
        input.contentId,
        input.src,
        input.declaredMime,
        input.assetRoot,
      ),
    ],
    createdAt: input.createdAt ?? new Date().toISOString(),
  } satisfies HeroAssetPublishEvidenceV1;
}
