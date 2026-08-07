import type { APIRoute } from "astro";
import type { ArtistsEditorDraftState } from "../artists-draft-state.ts";
import {
  publishSavedArtistsEntry,
  ArtistsPublishError,
} from "../artists-publish.ts";
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ArtistsEditorDraftState;
      baseline?: ArtistsEditorDraftState;
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
      await publishSavedArtistsEntry(body.draft, body.baseline, body.dirty),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Publish failed",
        code:
          error instanceof ArtistsPublishError ? error.code : "publish-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof ArtistsPublishError
            ? 400
            : 500,
      },
    );
  }
};
