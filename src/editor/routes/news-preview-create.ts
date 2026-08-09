import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { NewsEditorDraftState } from "../news-draft-state.ts";
import {
  createNewsPreviewModel,
  newsPreviewStore,
  NewsPreviewError,
} from "../news-preview.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as { draft?: NewsEditorDraftState };
    if (!input.draft)
      throw new NewsPreviewError("Draft required", "invalid-request");
    const model = createNewsPreviewModel(input.draft);
    const token = newsPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/news/${token}/${encodeURIComponent(model.contentId)}`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Preview failed",
        code: error instanceof NewsPreviewError ? error.code : "preview-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof NewsPreviewError
            ? 400
            : 500,
      },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
