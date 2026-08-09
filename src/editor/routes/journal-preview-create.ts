import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";

import type { Locale } from "../../content-loaders/journal/contracts.ts";
import type { JournalEditorDraftState } from "../journal-draft-state.ts";
import {
  createJournalPreviewModel,
  JournalPreviewError,
  journalPreviewStore,
} from "../journal-preview.ts";

const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const input = (await request.json()) as {
      draft?: JournalEditorDraftState;
      locale?: Locale;
    };
    if (!input?.draft || (input.locale !== "ja" && input.locale !== "en")) {
      throw new JournalPreviewError(
        "Draft and locale are required",
        "invalid-request",
      );
    }
    const model = createJournalPreviewModel(input.draft, input.locale);
    const token = journalPreviewStore.create(model);
    return Response.json({
      url: `/editor/preview/journal/${token}/${input.locale}`,
    });
  } catch (error) {
    const status =
      error instanceof SyntaxError || error instanceof JournalPreviewError
        ? 400
        : 500;
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Journal preview failed",
        code:
          error instanceof JournalPreviewError ? error.code : "preview-failed",
      },
      { status },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
