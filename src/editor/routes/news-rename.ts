import type { APIRoute } from "astro";
import {
  executeNewsRename,
  NewsRenameError,
  planNewsRename,
  type NewsRenamePlan,
} from "../news-rename.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute";
      sourceContentId?: string;
      destinationContentId?: string;
      plan?: NewsRenamePlan;
    };
    if (
      body.action === "plan" &&
      body.sourceContentId &&
      body.destinationContentId
    )
      return Response.json({
        plan: await planNewsRename(
          body as Required<
            Pick<typeof body, "sourceContentId" | "destinationContentId">
          >,
        ),
      });
    if (body.action === "execute" && body.plan) {
      const result = await executeNewsRename(body.plan);
      return Response.json({
        ...result,
        workspaceUrl: `/editor/news/workspace/${encodeURIComponent(result.draft.contentId)}/`,
      });
    }
    return Response.json(
      {
        error: "A valid News Rename plan or execution request is required",
        code: "invalid-request",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "News Rename failed",
        code: error instanceof NewsRenameError ? error.code : "rename-failed",
      },
      {
        status:
          error instanceof NewsRenameError || error instanceof SyntaxError
            ? 400
            : 500,
      },
    );
  }
};
