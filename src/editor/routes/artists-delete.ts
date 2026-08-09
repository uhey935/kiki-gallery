import type { APIRoute } from "astro";

import {
  executeArtistsDelete,
  ArtistsDeleteError,
  planArtistsDelete,
  publishArtistsDelete,
  type ArtistsDeletePlan,
} from "../artists-delete.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute" | "publish";
      contentId?: string;
      backupRoot?: string;
      plan?: ArtistsDeletePlan;
      operationId?: string;
      confirmed?: boolean;
    };
    if (body.action === "plan" && body.contentId)
      return Response.json({
        plan: await planArtistsDelete({
          contentId: body.contentId,
          backupRoot: body.backupRoot ?? "",
        }),
      });
    if (body.action === "execute" && body.plan && body.confirmed === true)
      return Response.json(await executeArtistsDelete(body.plan));
    if (body.action === "publish" && body.operationId)
      return Response.json({
        ...(await publishArtistsDelete(body.operationId)),
        workspaceUrl: "/editor/artists/workspace/",
      });
    return Response.json(
      {
        error:
          "A reviewed Artists Delete plan and explicit confirmation are required.",
        code: "state-mismatch",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Artists Delete failed",
        code:
          error instanceof ArtistsDeleteError ? error.code : "delete-failed",
      },
      {
        status:
          error instanceof SyntaxError
            ? 400
            : error instanceof ArtistsDeleteError
              ? 409
              : 500,
      },
    );
  }
};
