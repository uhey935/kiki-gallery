import type { APIRoute } from "astro";
import type { HomeEditorDraftState } from "../home-draft-state.ts";
import {
  createHomePreviewModel,
  homePreviewStore,
  HomePreviewError,
} from "../home-preview.ts";
export const POST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as { draft?: HomeEditorDraftState };
    if (!input.draft)
      throw new HomePreviewError("Draft required", "invalid-request");
    const model = createHomePreviewModel(input.draft);
    const token = homePreviewStore.create(model);
    return Response.json({ url: `/editor/preview/home/${token}/home` });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Preview failed",
        code: error instanceof HomePreviewError ? error.code : "preview-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof HomePreviewError
            ? 400
            : 500,
      },
    );
  }
};
