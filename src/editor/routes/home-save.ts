import type { APIRoute } from "astro";
import type { HomeEditorDraftState } from "../home-draft-state.ts";
import { saveHomeEditorDraft, HomeSaveError } from "../home-save.ts";
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: HomeEditorDraftState;
      baseline?: HomeEditorDraftState;
    };
    if (
      !body.draft ||
      !body.baseline ||
      body.draft.contentId !== "home" ||
      body.baseline.contentId !== "home"
    )
      return Response.json({ error: "Content ID mismatch" }, { status: 400 });
    return Response.json({
      draft: await saveHomeEditorDraft(body.draft, body.baseline),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Home Save failed",
        code: error instanceof HomeSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          (error instanceof HomeSaveError && error.code !== "save-failed")
            ? 400
            : 500,
      },
    );
  }
};
