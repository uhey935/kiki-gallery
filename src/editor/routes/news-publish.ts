import type { APIRoute } from "astro";
import type { NewsEditorDraftState } from "../news-draft-state.ts";
import { publishSavedNewsEntry, NewsPublishError } from "../news-publish.ts";
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: NewsEditorDraftState;
      baseline?: NewsEditorDraftState;
      dirty?: boolean;
    };
    if (
      !params.contentId ||
      !body.draft ||
      !body.baseline ||
      typeof body.dirty !== "boolean" ||
      body.draft.contentId !== params.contentId ||
      body.baseline.contentId !== params.contentId
    )
      return Response.json(
        { error: "Invalid publish request" },
        { status: 400 },
      );
    return Response.json(
      await publishSavedNewsEntry(body.draft, body.baseline, body.dirty),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Publish failed",
        code: error instanceof NewsPublishError ? error.code : "publish-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof NewsPublishError
            ? 400
            : 500,
      },
    );
  }
};
