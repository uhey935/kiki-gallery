import type { APIRoute } from "astro";
import type { NewsEditorDraftState } from "../news-draft-state.ts";
import { saveNewsEditorDraft, NewsSaveError } from "../news-save.ts";
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: NewsEditorDraftState;
      baseline?: NewsEditorDraftState;
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
      draft: await saveNewsEditorDraft(body.draft, body.baseline),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "News Save failed",
        code: error instanceof NewsSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          (error instanceof NewsSaveError && error.code !== "save-failed")
            ? 400
            : 500,
      },
    );
  }
};
