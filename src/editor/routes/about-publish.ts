import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { AboutEditorDraftState } from "../about-draft-state.ts";
import {
  AboutPublishError,
  inspectAboutPublishRecovery,
  publishSavedAboutEntry,
  retryAboutPublish,
} from "../about-publish.ts";
export const GET: APIRoute = async () => {
  try {
    return Response.json(await inspectAboutPublishRecovery());
  } catch (error) {
    return Response.json(
      {
        active: true,
        state: "invalid-evidence",
        error:
          error instanceof Error
            ? error.message
            : "Recovery evidence is invalid",
      },
      { status: 409 },
    );
  }
};
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "publish" | "retry";
      draft?: AboutEditorDraftState;
      baseline?: AboutEditorDraftState;
      dirty?: boolean;
    };
    const result =
      body.action === "retry"
        ? await retryAboutPublish()
        : body.draft && body.baseline
          ? await publishSavedAboutEntry(
              body.draft,
              body.baseline,
              Boolean(body.dirty),
            )
          : (() => {
              throw new AboutPublishError(
                "Draft and baseline required",
                "publish-blocked",
              );
            })();
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
