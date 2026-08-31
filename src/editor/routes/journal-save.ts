import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";

import type { JournalEditorDraftState } from "../journal-draft-state.ts";
import type { JournalHeroAssetDraft } from "../journal-hero-assets.ts";
import {
  JournalManualRecoveryError,
  journalManualRecoveryResponse,
} from "../journal-manual-recovery.ts";
import {
  JournalSaveError,
  saveJournalEditorDraftWithHero,
} from "../journal-save.ts";

const unlockedPOST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: JournalEditorDraftState;
      baseline?: JournalEditorDraftState;
      hero?: JournalHeroAssetDraft;
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
    const savedDraft = await saveJournalEditorDraftWithHero(
      draft,
      baseline,
      body.hero ?? {
        kind: "existing",
        src:
          draft.shared.state === "editable"
            ? draft.shared.value.hero.image
            : "",
      },
    );
    return Response.json({ draft: savedDraft });
  } catch (error) {
    if (error instanceof JournalManualRecoveryError)
      return journalManualRecoveryResponse(error);
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

export const POST = contentWriterRoute("save", unlockedPOST);
