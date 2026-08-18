import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { AboutEditorDraftState } from "../about-draft-state.ts";
import { AboutPublishError, publishSavedAboutEntry } from "../about-publish.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft: AboutEditorDraftState;
      baseline: AboutEditorDraftState;
      dirty: boolean;
    };
    const result = await publishSavedAboutEntry(
      body.draft,
      body.baseline,
      body.dirty,
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Publish failed",
        code:
          error instanceof AboutPublishError ? error.code : "publish-failed",
      },
      { status: 400 },
    );
  }
};
export const POST = contentWriterRoute("publish", unlockedPOST);
