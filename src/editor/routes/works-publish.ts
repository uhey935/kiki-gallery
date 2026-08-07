import type { APIRoute } from "astro";

import type { WorksEditorDraftState } from "../works-draft-state.ts";
import { publishSavedWorksEntry, WorksPublishError } from "../works-publish.ts";

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: WorksEditorDraftState;
      baseline?: WorksEditorDraftState;
      dirty?: boolean;
    };
    if (
      !params.contentId ||
      !body?.draft ||
      !body.baseline ||
      body.draft.contentId !== params.contentId ||
      body.baseline.contentId !== params.contentId ||
      typeof body.dirty !== "boolean"
    )
      return Response.json(
        { error: "Invalid publish request" },
        { status: 400 },
      );
    return Response.json(
      await publishSavedWorksEntry(body.draft, body.baseline, body.dirty),
    );
  } catch (error) {
    const status =
      error instanceof SyntaxError || error instanceof WorksPublishError
        ? 400
        : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Works publish failed",
        code:
          error instanceof WorksPublishError ? error.code : "publish-failed",
      },
      { status },
    );
  }
};
