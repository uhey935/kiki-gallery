import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { HomeEditorDraftState } from "../home-draft-state.ts";
import {
  createHomePreviewModel,
  homePreviewStore,
  HomePreviewError,
} from "../home-preview.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as {
      draft?: HomeEditorDraftState;
      locale?: "ja" | "en";
    };
    if (!input.draft)
      throw new HomePreviewError("Draft required", "invalid-request");
    const model = createHomePreviewModel(input.draft, input.locale ?? "ja");
    const token = homePreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/home/${token}/${model.locale}`,
    });
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

export const POST = contentWriterRoute("save", unlockedPOST);
