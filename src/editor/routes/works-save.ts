import type { APIRoute } from "astro";

import type { WorksEditorDraftState } from "../works-draft-state.ts";
import type { WorksAssetDraftState } from "../works-asset-draft.ts";
import { temporaryWorksAssetStore } from "../works-asset-store.ts";
import {
  saveWorksEditorDraft,
  saveWorksEditorDraftWithAssets,
  WorksSaveError,
} from "../works-save.ts";

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: WorksEditorDraftState;
      baseline?: WorksEditorDraftState;
      assetDraft?: WorksAssetDraftState;
    };
    const { draft, baseline } = body ?? {};
    if (
      !params.contentId ||
      !draft ||
      !baseline ||
      typeof draft !== "object" ||
      typeof baseline !== "object" ||
      draft.contentId !== params.contentId ||
      baseline.contentId !== params.contentId
    )
      return Response.json({ error: "Content ID mismatch" }, { status: 400 });
    if (body.assetDraft)
      return Response.json(
        await saveWorksEditorDraftWithAssets(draft, baseline, {
          assetDraft: body.assetDraft,
          store: await temporaryWorksAssetStore,
        }),
      );
    return Response.json({
      draft: await saveWorksEditorDraft(draft, baseline),
    });
  } catch (error) {
    const status =
      error instanceof SyntaxError ||
      (error instanceof WorksSaveError && error.code !== "save-failed")
        ? 400
        : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Works save failed",
        code: error instanceof WorksSaveError ? error.code : "save-failed",
      },
      { status },
    );
  }
};
