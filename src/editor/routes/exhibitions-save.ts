import type { APIRoute } from "astro";
import type { ExhibitionsEditorDraftState } from "../exhibitions-draft-state.ts";
import {
  saveExhibitionsEditorDraft,
  ExhibitionsSaveError,
} from "../exhibitions-save.ts";
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ExhibitionsEditorDraftState;
      baseline?: ExhibitionsEditorDraftState;
    };
    if (
      !params.contentId ||
      !body.draft ||
      !body.baseline ||
      body.draft.contentId !== params.contentId ||
      body.baseline.contentId !== params.contentId
    )
      return Response.json({ error: "Content ID mismatch" }, { status: 400 });
    return Response.json({
      draft: await saveExhibitionsEditorDraft(body.draft, body.baseline),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Exhibition Save failed",
        code:
          error instanceof ExhibitionsSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          (error instanceof ExhibitionsSaveError &&
            error.code !== "save-failed")
            ? 400
            : 500,
      },
    );
  }
};
