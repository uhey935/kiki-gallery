import type { APIRoute } from "astro";
import {
  executeExhibitionsRename,
  ExhibitionsRenameError,
  planExhibitionsRename,
  type ExhibitionsRenamePlan,
} from "../exhibitions-rename.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute";
      sourceContentId?: string;
      destinationContentId?: string;
      plan?: ExhibitionsRenamePlan;
    };
    if (
      body.action === "plan" &&
      body.sourceContentId &&
      body.destinationContentId
    )
      return Response.json({
        plan: await planExhibitionsRename({
          sourceContentId: body.sourceContentId,
          destinationContentId: body.destinationContentId,
        }),
      });
    if (body.action === "execute" && body.plan) {
      const result = await executeExhibitionsRename(body.plan);
      return Response.json({
        ...result,
        workspaceUrl: `/editor/exhibitions/workspace/${encodeURIComponent(result.draft.contentId)}/`,
      });
    }
    return Response.json(
      {
        error:
          "A valid Exhibitions Rename plan or execution request is required",
        code: "invalid-request",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Exhibitions Rename failed",
        code:
          error instanceof ExhibitionsRenameError
            ? error.code
            : "rename-failed",
      },
      {
        status:
          error instanceof ExhibitionsRenameError ||
          error instanceof SyntaxError
            ? 400
            : 500,
      },
    );
  }
};
