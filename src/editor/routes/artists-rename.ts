import type { APIRoute } from "astro";
import {
  executeArtistsRename,
  ArtistsRenameError,
  planArtistsRename,
  type ArtistsRenamePlan,
} from "../artists-rename.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute";
      sourceContentId?: string;
      destinationContentId?: string;
      plan?: ArtistsRenamePlan;
    };
    if (
      body.action === "plan" &&
      body.sourceContentId &&
      body.destinationContentId
    )
      return Response.json({
        plan: await planArtistsRename({
          sourceContentId: body.sourceContentId,
          destinationContentId: body.destinationContentId,
        }),
      });
    if (body.action === "execute" && body.plan) {
      const result = await executeArtistsRename(body.plan);
      return Response.json({
        ...result,
        workspaceUrl: `/editor/artists/workspace/${encodeURIComponent(result.draft.contentId)}/`,
      });
    }
    return Response.json(
      {
        error: "A valid Artists Rename plan or execution request is required",
        code: "invalid-request",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Artists Rename failed",
        code:
          error instanceof ArtistsRenameError ? error.code : "rename-failed",
      },
      {
        status:
          error instanceof ArtistsRenameError || error instanceof SyntaxError
            ? 400
            : 500,
      },
    );
  }
};
