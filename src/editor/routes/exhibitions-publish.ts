import type { APIRoute } from "astro";
import type { ExhibitionsEditorDraftState } from "../exhibitions-draft-state.ts";
import {
  publishSavedExhibitionsEntry,
  ExhibitionsPublishError,
} from "../exhibitions-publish.ts";
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ExhibitionsEditorDraftState;
      baseline?: ExhibitionsEditorDraftState;
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
      await publishSavedExhibitionsEntry(body.draft, body.baseline, body.dirty),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Publish failed",
        code:
          error instanceof ExhibitionsPublishError
            ? error.code
            : "publish-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          error instanceof ExhibitionsPublishError
            ? 400
            : 500,
      },
    );
  }
};
