import type { APIRoute } from "astro";
import {
  executeWorksRename,
  planWorksRename,
  WorksRenameError,
  type WorksRenamePlan,
} from "../works-rename.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute";
      sourceContentId?: string;
      destinationContentId?: string;
      pendingAssetState?: boolean;
      unpublishedAssetCount?: number;
      plan?: WorksRenamePlan;
    };
    if (
      body.action === "plan" &&
      body.sourceContentId &&
      body.destinationContentId
    )
      return Response.json({
        plan: await planWorksRename({
          sourceContentId: body.sourceContentId,
          destinationContentId: body.destinationContentId,
          pendingAssetState: body.pendingAssetState,
          unpublishedAssetCount: body.unpublishedAssetCount,
        }),
      });
    if (body.action === "execute" && body.plan) {
      const result = await executeWorksRename(body.plan);
      return Response.json({
        ...result,
        workspaceUrl: `/editor/works/workspace/${encodeURIComponent(result.draft.contentId)}/`,
      });
    }
    return Response.json(
      {
        error: "A valid Works Rename plan or execution request is required",
        code: "invalid-request",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Works Rename failed",
        code: error instanceof WorksRenameError ? error.code : "rename-failed",
      },
      {
        status:
          error instanceof WorksRenameError || error instanceof SyntaxError
            ? 400
            : 500,
      },
    );
  }
};
