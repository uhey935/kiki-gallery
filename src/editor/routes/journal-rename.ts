import type { APIRoute } from "astro";

import {
  executeJournalRename,
  JournalRenameError,
  planJournalRename,
  type JournalRenamePlan,
} from "../journal-rename.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute";
      sourceContentId?: string;
      destinationContentId?: string;
      plan?: JournalRenamePlan;
    };
    if (
      body.action === "plan" &&
      body.sourceContentId &&
      body.destinationContentId
    )
      return Response.json({
        plan: await planJournalRename({
          sourceContentId: body.sourceContentId,
          destinationContentId: body.destinationContentId,
        }),
      });
    if (body.action === "execute" && body.plan) {
      const result = await executeJournalRename(body.plan);
      return Response.json({
        ...result,
        workspaceUrl: `/editor/journal/workspace/${encodeURIComponent(result.draft.contentId)}/`,
      });
    }
    return Response.json(
      {
        error: "A valid Journal Rename plan or execution request is required",
        code: "invalid-request",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Journal Rename failed",
        code:
          error instanceof JournalRenameError ? error.code : "rename-failed",
      },
      {
        status:
          error instanceof JournalRenameError || error instanceof SyntaxError
            ? 400
            : 500,
      },
    );
  }
};
