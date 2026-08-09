import type { APIRoute } from "astro";

import {
  executeNewsDelete,
  NewsDeleteError,
  planNewsDelete,
  publishNewsDelete,
  type NewsDeletePlan,
} from "../news-delete.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute" | "publish";
      contentId?: string;
      backupRoot?: string;
      plan?: NewsDeletePlan;
      operationId?: string;
      confirmed?: boolean;
    };
    if (body.action === "plan" && body.contentId)
      return Response.json({
        plan: await planNewsDelete({
          contentId: body.contentId,
          backupRoot: body.backupRoot ?? "",
        }),
      });
    if (body.action === "execute" && body.plan && body.confirmed === true)
      return Response.json(await executeNewsDelete(body.plan));
    if (body.action === "publish" && body.operationId)
      return Response.json({
        ...(await publishNewsDelete(body.operationId)),
        workspaceUrl: "/editor/news/workspace/",
      });
    return Response.json(
      {
        error:
          "A reviewed News Delete plan and explicit confirmation are required.",
        code: "state-mismatch",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "News Delete failed",
        code: error instanceof NewsDeleteError ? error.code : "delete-failed",
      },
      {
        status:
          error instanceof SyntaxError
            ? 400
            : error instanceof NewsDeleteError
              ? 409
              : 500,
      },
    );
  }
};
