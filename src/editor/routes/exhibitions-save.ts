import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import type { ExhibitionsEditorDraftState } from "../exhibitions-draft-state.ts";
import type { ExhibitionsHeroAssetDraft } from "../exhibitions-hero-assets.ts";
import { saveExhibitionsEditorDraftWithHero, ExhibitionsSaveError } from "../exhibitions-save.ts";
const unlockedPOST: APIRoute = async ({ params, request }) => {
  try {
    const body = (await request.json()) as {
      draft?: ExhibitionsEditorDraftState;
      baseline?: ExhibitionsEditorDraftState;
      hero?: ExhibitionsHeroAssetDraft;
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
      draft: await saveExhibitionsEditorDraftWithHero(
        body.draft,
        body.baseline,
        body.hero ?? { kind: "existing", src: body.draft.shared.state === "editable" ? body.draft.shared.value.hero.image : "" },
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Exhibition Save failed",
        code: error instanceof ExhibitionsSaveError ? error.code : "save-failed",
      },
      {
        status:
          error instanceof SyntaxError ||
          (error instanceof ExhibitionsSaveError && error.code !== "save-failed")
            ? 400
            : 500,
      },
    );
  }
};

export const POST = contentWriterRoute("save", unlockedPOST);
