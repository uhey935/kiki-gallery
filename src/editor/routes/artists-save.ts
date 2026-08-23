import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { ArtistsEditorDraftState } from "../artists-draft-state.ts";
import type { ArtistsHeroAssetDraft } from "../artists-hero-assets.ts";
import { saveArtistsEditorDraftWithHero, ArtistsSaveError } from "../artists-save.ts";
const unlockedPOST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ArtistsEditorDraftState;
      baseline?: ArtistsEditorDraftState;
      hero?: ArtistsHeroAssetDraft;
    };
    if (
      !params.contentId ||
      !body.draft ||
      !body.baseline ||
      body.draft.contentId !== params.contentId ||
      body.baseline.contentId !== params.contentId
    )
      return Response.json({ error: "Content ID mismatch" }, { status: 400 });
    return Response.json({
      draft: await saveArtistsEditorDraftWithHero(
        body.draft,
        body.baseline,
        body.hero ?? { kind: "existing", src: body.draft.data.hero.image },
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Artist Save failed",
        code: error instanceof ArtistsSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          (error instanceof ArtistsSaveError && error.code !== "save-failed")
            ? 400
            : 500,
      },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
