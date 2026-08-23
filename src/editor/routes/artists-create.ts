import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import {
  ArtistsCreateError,
  createArtistsThreeFileEntryWithHero,
  type ArtistsCreateHeroInput,
} from "../artists-create.ts";
import type { ArtistsEditorDraftState } from "../artists-draft-state.ts";

const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ArtistsEditorDraftState;
      hero?: ArtistsCreateHeroInput;
    };
    if (!body.draft || !body.hero)
      return Response.json(
        {
          error: "An Artists draft and Hero are required",
          code: "invalid-request",
        },
        { status: 400 },
      );
    const draft = await createArtistsThreeFileEntryWithHero(
      body.draft,
      body.hero,
    );
    return Response.json({
      draft,
      workspaceUrl: `/editor/artists/workspace/${encodeURIComponent(draft.contentId)}/`,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Artists create failed",
        code:
          error instanceof ArtistsCreateError ? error.code : "create-failed",
      },
      {
        status:
          error instanceof SyntaxError || error instanceof ArtistsCreateError
            ? 400
            : 500,
      },
    );
  }
};
export const POST = contentWriterRoute("create", unlockedPOST);
