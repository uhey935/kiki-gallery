import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { ArtistsEditorDraftState } from "../artists-draft-state.ts";
import {
  createArtistsPreviewModel,
  artistsPreviewStore,
  ArtistsPreviewError,
} from "../artists-preview.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as { draft?: ArtistsEditorDraftState };
    if (!input.draft)
      throw new ArtistsPreviewError("Draft required", "invalid-request");
    const model = createArtistsPreviewModel(input.draft);
    const token = artistsPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/artists/${token}/${encodeURIComponent(model.contentId)}`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Preview failed",
        code:
          error instanceof ArtistsPreviewError ? error.code : "preview-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof ArtistsPreviewError
            ? 400
            : 500,
      },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
