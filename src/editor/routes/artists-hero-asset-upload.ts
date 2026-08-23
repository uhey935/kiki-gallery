import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";

import { contentWriterRoute } from "./content-writer-route.ts";
import {
  ArtistsHeroAssetError,
  temporaryArtistsHeroAssetStore,
} from "../artists-hero-assets.ts";
import { readArtistsEditorEntry } from "../artists-state.ts";
import { isContentId } from "../content-id.ts";
import { WORKS_ASSET_POLICY } from "../works-asset-policy.ts";

const assetRoot = path.resolve("public/images/artists");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function handleArtistsHeroUpload(
  contentId: string | undefined,
  request: Request,
  options: {
    root?: string;
    store?: Awaited<typeof temporaryArtistsHeroAssetStore>;
    contentExists?: (contentId: string) => boolean | Promise<boolean>;
    create?: boolean;
  } = {},
) {
  try {
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = Number(contentLengthHeader);
    if (
      (!options.create && (!contentId || !isContentId(contentId))) ||
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data") ||
      (contentLengthHeader !== null &&
        (!Number.isSafeInteger(contentLength) ||
          contentLength < 1 ||
          contentLength > WORKS_ASSET_POLICY.maxBytes + 1024 * 1024))
    )
      throw new ArtistsHeroAssetError("A multipart upload is required", "asset-invalid-request");
    const form = await request.formData();
    const files = form.getAll("file");
    const workspaceField = options.create ? "createWorkspaceId" : "workspaceId";
    const workspaces = form.getAll(workspaceField);
    const unknown = [...form.keys()].some(
      (key) => key !== "file" && key !== workspaceField,
    );
    const file = files[0];
    const workspaceId = workspaces[0];
    if (
      files.length !== 1 ||
      workspaces.length !== 1 ||
      unknown ||
      !(file instanceof File) ||
      typeof workspaceId !== "string"
    )
      throw new ArtistsHeroAssetError(
        "A file and workspace ID are required",
        "asset-invalid-request",
      );
    const exists = options.create
      ? true
      : options.contentExists
        ? await options.contentExists(contentId!)
        : await readArtistsEditorEntry(contentId!).then(
            () => true,
            () => false,
          );
    if (!exists)
      throw new ArtistsHeroAssetError(
        "Artist not found",
        "asset-invalid-request",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { inspectArtistsHeroCandidate } =
      await import("../artists-hero-assets.ts");
    const ownerContentId = options.create
      ? `create-${workspaceId}`
      : contentId!;
    const admitted = await inspectArtistsHeroCandidate({
      contentId: ownerContentId,
      declaredMime: file.type,
      bytes,
    });
    if (options.create) {
      const metadata = await (
        options.store ?? (await temporaryArtistsHeroAssetStore)
      ).register({
        contentId: ownerContentId,
        workspaceId,
        originalFilename: file.name,
        declaredMime: file.type,
        bytes,
      });
      return Response.json({ state: "temporary", asset: metadata });
    }
    const root = path.resolve(options.root ?? assetRoot);
    const rootStat = await fs.lstat(root).catch(() => undefined);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
      throw new ArtistsHeroAssetError("Unsafe canonical asset root", "asset-temp-unsafe");
    const basename = admitted.proposedSrc.slice("/images/artists/".length);
    const target = path.resolve(root, basename);
    if (path.dirname(target) !== root || path.basename(target) !== basename)
      throw new ArtistsHeroAssetError("Unsafe canonical target", "asset-invalid-request");
    const stat = await fs.lstat(target).catch(() => undefined);
    let replaces: { src: string; sha256: string } | undefined;
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new ArtistsHeroAssetError("Unsafe canonical target", "asset-temp-unsafe");
      const existingHash = sha256(await fs.readFile(target));
      if (existingHash === admitted.sha256)
        return Response.json({ state: "reuse", src: admitted.proposedSrc, sha256: existingHash });
      replaces = { src: admitted.proposedSrc, sha256: existingHash };
    }
    const metadata = await (
      options.store ?? (await temporaryArtistsHeroAssetStore)
    ).register({
      contentId: contentId!,
      workspaceId,
      originalFilename: file.name,
      declaredMime: file.type,
      bytes,
      replaces,
    });
    return Response.json({ state: replaces ? "replace-confirmation" : "temporary", asset: metadata });
  } catch (error) {
    const known = error instanceof ArtistsHeroAssetError;
    return Response.json(
      { error: known ? error.message : "Artists Hero upload failed", code: known ? error.code : "asset-upload-failed" },
      { status: known ? 400 : 500 },
    );
  }
}

const unlockedPOST: APIRoute = ({ params, request }) => handleArtistsHeroUpload(params.contentId, request);
export const POST = contentWriterRoute("save", unlockedPOST);

export const createPOST = contentWriterRoute("save", ({ request }) =>
  handleArtistsHeroUpload(undefined, request, { create: true }),
);
