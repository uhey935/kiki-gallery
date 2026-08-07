import type { APIRoute } from "astro";

import type { JournalEditorDraftState } from "../journal-draft-state.ts";
import { JournalSaveError, saveJournalEditorDraft } from "../journal-save.ts";

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: JournalEditorDraftState;
      baseline?: JournalEditorDraftState;
    };
    const { draft, baseline } = body ?? {};
    if (
      !params.contentId ||
      !draft ||
      !baseline ||
      typeof draft !== "object" ||
      typeof baseline !== "object" ||
      typeof draft.contentId !== "string" ||
      draft.contentId !== params.contentId ||
      baseline.contentId !== params.contentId
    ) {
      return Response.json({ error: "Content ID mismatch" }, { status: 400 });
    }
    const savedDraft = await saveJournalEditorDraft(draft, baseline);
    return Response.json({ draft: savedDraft });
  } catch (error) {
    const status =
      error instanceof SyntaxError ||
      (error instanceof JournalSaveError && error.code !== "save-failed")
        ? 400
        : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Journal save failed",
        code: error instanceof JournalSaveError ? error.code : "save-failed",
      },
      { status },
    );
  }
};
