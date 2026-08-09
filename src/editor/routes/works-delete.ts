import type { APIRoute } from "astro";
import {
  executeWorksDelete,
  planWorksDelete,
  publishWorksDelete,
  WorksDeleteError,
  type WorksDeletePlan,
} from "../works-delete.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute" | "publish";
      contentId?: string;
      backupRoot?: string;
      pendingAssetState?: boolean;
      unpublishedAssetCount?: number;
      plan?: WorksDeletePlan;
      operationId?: string;
      confirmed?: boolean;
    };
    if (body.action === "plan" && body.contentId)
      return Response.json({
        plan: await planWorksDelete({
          contentId: body.contentId,
          backupRoot: body.backupRoot ?? "",
          pendingAssetState: body.pendingAssetState,
          unpublishedAssetCount: body.unpublishedAssetCount,
        }),
      });
    if (body.action === "execute" && body.plan && body.confirmed === true)
      return Response.json(await executeWorksDelete(body.plan));
    if (body.action === "publish" && body.operationId)
      return Response.json({
        ...(await publishWorksDelete(body.operationId)),
        workspaceUrl: "/editor/works/workspace/",
      });
    return Response.json(
      {
        error:
          "A reviewed Works Delete plan and explicit confirmation are required.",
        code: "state-mismatch",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Works Delete failed",
        code: error instanceof WorksDeleteError ? error.code : "delete-failed",
      },
      {
        status:
          error instanceof SyntaxError
            ? 400
            : error instanceof WorksDeleteError
              ? 409
              : 500,
      },
    );
  }
};
