import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { ExhibitionsEditorDraftState } from "../exhibitions-draft-state.ts";
import {
  createExhibitionsPreviewModel,
  exhibitionsPreviewStore,
  ExhibitionsPreviewError,
} from "../exhibitions-preview.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as {
      draft?: ExhibitionsEditorDraftState;
    };
    if (!input.draft)
      throw new ExhibitionsPreviewError("Draft required", "invalid-request");
    const model = createExhibitionsPreviewModel(input.draft);
    const token = exhibitionsPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/exhibitions/${token}/${encodeURIComponent(model.contentId)}`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Preview failed",
        code:
          error instanceof ExhibitionsPreviewError
            ? error.code
            : "preview-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          error instanceof ExhibitionsPreviewError
            ? 400
            : 500,
      },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
