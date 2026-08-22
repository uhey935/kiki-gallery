import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { AboutEditorDraftState } from "../about-draft-state.ts";
import {
  aboutPreviewStore,
  AboutPreviewError,
  createAboutPreviewModel,
} from "../about-preview.ts";
import { validateAboutDraftAssets } from "../about-assets.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as {
      draft?: AboutEditorDraftState;
      locale?: "ja" | "en";
    };
    if (!input.draft)
      throw new AboutPreviewError("Draft required", "invalid-request");
    if (!(await validateAboutDraftAssets(input.draft)).valid)
      throw new AboutPreviewError(
        "About preview requires valid image assets",
        "preview-blocked",
      );
    const model = createAboutPreviewModel(input.draft, input.locale ?? "ja"),
      token = aboutPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/about/${token}/${model.locale}`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Preview failed",
        code:
          error instanceof AboutPreviewError ? error.code : "preview-failed",
      },
      { status: 400 },
    );
  }
};
export const POST = contentWriterRoute("save", unlockedPOST);
