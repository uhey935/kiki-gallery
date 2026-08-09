import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";

import {
  temporaryWorksAssetStore,
  type TemporaryWorksAssetStore,
} from "../works-asset-store.ts";
import {
  readWorksAssetInventory,
  type ExistingWorksAsset,
} from "../works-assets.ts";
import {
  WorksAssetUploadError,
  uploadTemporaryWorksAsset,
} from "../works-asset-upload.ts";
import { readWorksEditorEntry } from "../works-state.ts";

type Dependencies = {
  store: TemporaryWorksAssetStore;
  contentExists: (contentId: string) => boolean | Promise<boolean>;
  existing: readonly ExistingWorksAsset[];
};

export async function handleWorksAssetUpload(
  contentId: string | undefined,
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  try {
    if (
      !contentId ||
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data")
    )
      throw new WorksAssetUploadError(
        "A multipart upload is required.",
        "asset-invalid-request",
      );
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new WorksAssetUploadError(
        "The multipart upload is malformed.",
        "asset-invalid-request",
      );
    }
    const file = form.get("file");
    const workspaceId = form.get("workspaceId");
    if (!(file instanceof File) || typeof workspaceId !== "string")
      throw new WorksAssetUploadError(
        "A file and workspace ID are required.",
        "asset-invalid-request",
      );
    const descriptor = await uploadTemporaryWorksAsset({
      contentId,
      workspaceId,
      candidate: {
        filename: file.name,
        declaredMime: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      existing: dependencies.existing,
      store: dependencies.store,
      contentExists: dependencies.contentExists,
    });
    return Response.json({ asset: descriptor }, { status: 200 });
  } catch (error) {
    const known = error instanceof WorksAssetUploadError;
    return Response.json(
      {
        error: known ? error.message : "Works asset upload failed.",
        code: known ? error.code : "asset-upload-failed",
      },
      { status: known ? 400 : 500 },
    );
  }
}

const unlockedPOST: APIRoute = async ({ params, request }) => {
  const inventory = await readWorksAssetInventory();
  return handleWorksAssetUpload(params.contentId, request, {
    store: await temporaryWorksAssetStore,
    contentExists: async (contentId) => {
      try {
        await readWorksEditorEntry(contentId);
        return true;
      } catch {
        return false;
      }
    },
    existing: inventory.assets.map(({ filename, sha256 }) => ({
      filename,
      sha256,
    })),
  });
};

export const POST = contentWriterRoute("save", unlockedPOST);
