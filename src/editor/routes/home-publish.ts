import type { APIRoute } from "astro";
import type { HomeEditorDraftState } from "../home-draft-state.ts";
import { publishSavedHomeEntry, HomePublishError } from "../home-publish.ts";
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: HomeEditorDraftState;
      baseline?: HomeEditorDraftState;
      dirty?: boolean;
    };
    if (
      !body.draft ||
      !body.baseline ||
      typeof body.dirty !== "boolean" ||
      body.draft.contentId !== "home" ||
      body.baseline.contentId !== "home"
    )
      return Response.json(
        { error: "Invalid publish request" },
        { status: 400 },
      );
    return Response.json(
      await publishSavedHomeEntry(body.draft, body.baseline, body.dirty),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Publish failed",
        code: error instanceof HomePublishError ? error.code : "publish-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof HomePublishError
            ? 400
            : 500,
      },
    );
  }
};
