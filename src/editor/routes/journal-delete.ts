import type { APIRoute } from "astro";

import {
  executeJournalDelete,
  JournalDeleteError,
  planJournalDelete,
  publishJournalDelete,
  type JournalDeletePlan,
} from "../journal-delete.ts";
import {
  JournalManualRecoveryError,
  journalManualRecoveryResponse,
} from "../journal-manual-recovery.ts";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as {
      action?: "plan" | "execute" | "publish";
      contentId?: string;
      backupRoot?: string;
      plan?: JournalDeletePlan;
      operationId?: string;
      confirmed?: boolean;
    };
    if (body.action === "plan" && body.contentId)
      return Response.json({
        plan: await planJournalDelete({
          contentId: body.contentId,
          backupRoot: body.backupRoot ?? "",
        }),
      });
    if (body.action === "execute" && body.plan && body.confirmed === true)
      return Response.json(await executeJournalDelete(body.plan));
    if (body.action === "publish" && body.operationId)
      return Response.json({
        ...(await publishJournalDelete(body.operationId)),
        workspaceUrl: "/editor/journal/workspace/",
      });
    return Response.json(
      {
        error:
          "A reviewed Journal Delete plan and explicit confirmation are required.",
        code: "state-mismatch",
      },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof JournalManualRecoveryError)
      return journalManualRecoveryResponse(error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Journal Delete failed",
        code:
          error instanceof JournalDeleteError ? error.code : "delete-failed",
      },
      {
        status:
          error instanceof SyntaxError
            ? 400
            : error instanceof JournalDeleteError
              ? 409
              : 500,
      },
    );
  }
};
