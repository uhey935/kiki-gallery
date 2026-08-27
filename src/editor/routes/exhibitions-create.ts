import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import {
  ExhibitionsCreateError,
  createExhibitionsThreeFileEntryWithHero,
  type ExhibitionsCreateHeroInput,
} from "../exhibitions-create.ts";
import type { ExhibitionsEditorDraftState } from "../exhibitions-draft-state.ts";

const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ExhibitionsEditorDraftState;
      hero?: ExhibitionsCreateHeroInput;
    };
    if (!body.draft || !body.hero)
      return Response.json(
        {
          error: "An Exhibitions draft and Hero are required",
          code: "invalid-request",
        },
        { status: 400 },
      );
    const draft = await createExhibitionsThreeFileEntryWithHero(
      body.draft,
      body.hero,
    );
    return Response.json({
      draft,
      workspaceUrl: `/editor/exhibitions/workspace/${encodeURIComponent(draft.contentId)}/`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Exhibitions create failed",
        code:
          error instanceof ExhibitionsCreateError ? error.code : "create-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof ExhibitionsCreateError
            ? 400
            : 500,
      },
    );
  }
};
export const POST = contentWriterRoute("create", unlockedPOST);
