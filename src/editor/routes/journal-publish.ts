import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";

import type { JournalEditorDraftState } from "../journal-draft-state.ts";
import {
  JournalManualRecoveryError,
  journalManualRecoveryResponse,
} from "../journal-manual-recovery.ts";
import {
  JournalPublishError,
  publishSavedJournalEntry,
} from "../journal-publish.ts";

const unlockedPOST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: JournalEditorDraftState;
      dirty?: boolean;
    };
    if (
      !params.contentId ||
      !body?.draft ||
      body.draft.contentId !== params.contentId ||
      typeof body.dirty !== "boolean"
    ) {
      return Response.json(
        { error: "Invalid publish request" },
        { status: 400 },
      );
    }
    return Response.json(
      await publishSavedJournalEntry(body.draft, body.dirty),
    );
  } catch (error) {
    if (error instanceof JournalManualRecoveryError)
      return journalManualRecoveryResponse(error);
    const status =
      error instanceof SyntaxError || error instanceof JournalPublishError
        ? 400
        : 500;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Journal publish failed",
        code:
          error instanceof JournalPublishError ? error.code : "publish-failed",
      },
      { status },
    );
  }
};

export const POST = contentWriterRoute("publish", unlockedPOST);
