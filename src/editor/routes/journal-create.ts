import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";

import {
  createJournalThreeFileEntryWithHero,
  type JournalCreateHeroInput,
  JournalCreateError,
} from "../journal-create.ts";
import type { JournalEditorDraftState } from "../journal-draft-state.ts";

const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: JournalEditorDraftState;
      hero?: JournalCreateHeroInput;
    };
    if (
      !body?.draft ||
      typeof body.draft !== "object" ||
      typeof body.draft.contentId !== "string"
    )
      return Response.json(
        { error: "A Journal draft is required", code: "invalid-request" },
        { status: 400 },
      );
    if (!body.hero)
      throw new JournalCreateError(
        "Journal Create requires a validated Hero candidate",
        "invalid-draft",
      );
    const draft = await createJournalThreeFileEntryWithHero(
      body.draft,
      body.hero,
    );
    return Response.json({
      draft,
      workspaceUrl: `/editor/journal/workspace/${encodeURIComponent(draft.contentId)}/`,
    });
  } catch (error) {
    const status =
      error instanceof SyntaxError || error instanceof JournalCreateError
        ? 400
        : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Journal create failed",
        code:
          error instanceof JournalCreateError ? error.code : "create-failed",
      },
      { status },
    );
  }
};

export const POST = contentWriterRoute("create", unlockedPOST);
