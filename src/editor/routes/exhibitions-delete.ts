import type { APIRoute } from "astro";

import {
  executeExhibitionsDelete,
  ExhibitionsDeleteError,
  planExhibitionsDelete,
  publishExhibitionsDelete,
  type ExhibitionsDeletePlan,
} from "../exhibitions-delete.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute" | "publish";
      contentId?: string;
      backupRoot?: string;
      plan?: ExhibitionsDeletePlan;
      operationId?: string;
      confirmed?: boolean;
    };
    if (body.action === "plan" && body.contentId)
      return Response.json({
        plan: await planExhibitionsDelete({
          contentId: body.contentId,
          backupRoot: body.backupRoot ?? "",
        }),
      });
    if (body.action === "execute" && body.plan && body.confirmed === true)
      return Response.json(await executeExhibitionsDelete(body.plan));
    if (body.action === "publish" && body.operationId)
      return Response.json({
        ...(await publishExhibitionsDelete(body.operationId)),
        workspaceUrl: "/editor/exhibitions/workspace/",
      });
    return Response.json(
      {
        error:
          "A reviewed Exhibitions Delete plan and explicit confirmation are required.",
        code: "state-mismatch",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Exhibitions Delete failed",
        code:
          error instanceof ExhibitionsDeleteError
            ? error.code
            : "delete-failed",
      },
      {
        status:
          error instanceof SyntaxError
            ? 400
            : error instanceof ExhibitionsDeleteError
              ? 409
              : 500,
      },
    );
  }
};
