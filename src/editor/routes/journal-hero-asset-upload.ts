import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";

import { contentWriterRoute } from "./content-writer-route.ts";
import { isContentId } from "../content-id.ts";
import {
  inspectJournalHeroCandidate,
  JournalHeroAssetError,
  JOURNAL_HERO_PREFIX,
  temporaryJournalHeroAssetStore,
} from "../journal-hero-assets.ts";
import { readJournalEditorEntry } from "../journal-state.ts";
import { WORKS_ASSET_POLICY } from "../works-asset-policy.ts";

const assetRoot = path.resolve("public/images/journal");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export async function handleJournalHeroUpload(
  contentId: string | undefined,
  request: Request,
  options: {
    root?: string;
    store?: Awaited<typeof temporaryJournalHeroAssetStore>;
    contentExists?: (contentId: string) => boolean | Promise<boolean>;
    create?: boolean;
  } = {},
) {
  try {
    const lengthHeader = request.headers.get("content-length");
    const length = Number(lengthHeader);
    if (
      (!options.create && (!contentId || !isContentId(contentId))) ||
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data") ||
      (lengthHeader !== null &&
        (!Number.isSafeInteger(length) ||
          length < 1 ||
          length > WORKS_ASSET_POLICY.maxBytes + 1024 * 1024))
    )
      throw new JournalHeroAssetError(
        "A multipart upload is required",
        "asset-invalid-request",
      );
    const form = await request.formData();
    const files = form.getAll("file");
    const workspaceField = options.create
      ? "createWorkspaceId"
      : "workspaceId";
    const workspaces = form.getAll(workspaceField);
    if (
      files.length !== 1 ||
      workspaces.length !== 1 ||
      [...form.keys()].some(
        (key) => key !== "file" && key !== workspaceField,
      ) ||
      !(files[0] instanceof File) ||
      typeof workspaces[0] !== "string"
    )
      throw new JournalHeroAssetError(
        "A file and workspace ID are required",
        "asset-invalid-request",
      );
    const file = files[0];
    const workspaceId = workspaces[0];
    const exists = options.create
      ? true
      : options.contentExists
        ? await options.contentExists(contentId!)
        : await readJournalEditorEntry(contentId!).then(
            () => true,
            () => false,
          );
    if (!exists)
      throw new JournalHeroAssetError(
        "Journal entry not found",
        "asset-invalid-request",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ownerContentId = options.create
      ? `create-${workspaceId}`
      : contentId!;
    const admitted = inspectJournalHeroCandidate({
      contentId: ownerContentId,
      declaredMime: file.type,
      bytes,
    });
    const store = options.store ?? (await temporaryJournalHeroAssetStore);
    if (options.create) {
      return Response.json({
        state: "temporary",
        asset: await store.register({
          contentId: ownerContentId,
          workspaceId,
          originalFilename: file.name,
          declaredMime: file.type,
          bytes,
        }),
      });
    }
    const root = path.resolve(options.root ?? assetRoot);
    const rootStat = await fs.lstat(root).catch(() => undefined);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
      throw new JournalHeroAssetError(
        "Unsafe canonical asset root",
        "asset-temp-unsafe",
      );
    const basename = admitted.proposedSrc.slice(JOURNAL_HERO_PREFIX.length);
    const target = path.resolve(root, basename);
    if (path.dirname(target) !== root || path.basename(target) !== basename)
      throw new JournalHeroAssetError(
        "Unsafe canonical target",
        "asset-invalid-request",
      );
    const stat = await fs.lstat(target).catch(() => undefined);
    let replaces: { src: string; sha256: string } | undefined;
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new JournalHeroAssetError(
          "Unsafe canonical target",
          "asset-temp-unsafe",
        );
      const existingHash = sha256(await fs.readFile(target));
      if (existingHash === admitted.sha256)
        return Response.json({
          state: "reuse",
          src: admitted.proposedSrc,
          sha256: existingHash,
        });
      replaces = { src: admitted.proposedSrc, sha256: existingHash };
    }
    const asset = await store.register({
      contentId: contentId!,
      workspaceId,
      originalFilename: file.name,
      declaredMime: file.type,
      bytes,
      replaces,
    });
    return Response.json({
      state: replaces ? "replace-confirmation" : "temporary",
      asset,
    });
  } catch (error) {
    const known = error instanceof JournalHeroAssetError;
    return Response.json(
      {
        error: known ? error.message : "Journal Hero upload failed",
        code: known ? error.code : "asset-upload-failed",
      },
      { status: known ? 400 : 500 },
    );
  }
}

const unlockedPOST: APIRoute = ({ params, request }) =>
  handleJournalHeroUpload(params.contentId, request);
export const POST = contentWriterRoute("save", unlockedPOST);
export const createPOST = contentWriterRoute("save", ({ request }) =>
  handleJournalHeroUpload(undefined, request, { create: true }),
);
