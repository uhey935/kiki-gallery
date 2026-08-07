import type { APIRoute } from "astro";

import type { WorksEditorDraftState } from "../works-draft-state.ts";
import {
  createWorksPreviewModel,
  WorksPreviewError,
  worksPreviewStore,
} from "../works-preview.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as { draft?: WorksEditorDraftState };
    if (!input?.draft) {
      throw new WorksPreviewError("Draft is required", "invalid-request");
    }
    const model = createWorksPreviewModel(input.draft);
    const token = worksPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/works/${token}/${encodeURIComponent(model.contentId)}`,
    });
  } catch (error) {
    const status =
      error instanceof SyntaxError || error instanceof WorksPreviewError
        ? 400
        : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Works preview failed",
        code:
          error instanceof WorksPreviewError ? error.code : "preview-failed",
      },
      { status },
    );
  }
};
