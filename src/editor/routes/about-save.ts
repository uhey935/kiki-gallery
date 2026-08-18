import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import { AboutSaveError, saveAboutEditorDraft } from "../about-save.ts";
import type { AboutEditorDraftState } from "../about-draft-state.ts";
const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: AboutEditorDraftState;
      baseline?: AboutEditorDraftState;
    };
    if (!body.draft || !body.baseline)
      return Response.json(
        { error: "Draft and baseline required" },
        { status: 400 },
      );
    return Response.json({
      draft: await saveAboutEditorDraft(body.draft, body.baseline),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "About Save failed",
        code: error instanceof AboutSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof AboutSaveError && error.code === "save-failed"
            ? 500
            : 400,
      },
    );
  }
};
export const POST = contentWriterRoute("save", unlockedPOST);
