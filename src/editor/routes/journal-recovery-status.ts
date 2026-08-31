import type { APIRoute } from "astro";

import { isContentId } from "../content-id.ts";
import { readJournalManualRecoveryStatus } from "../journal-manual-recovery.ts";

export const GET: APIRoute = async ({ params }) => {
  if (!params.contentId || !isContentId(params.contentId))
    return Response.json({ error: "Invalid Content ID" }, { status: 400 });

  try {
    return Response.json(
      await readJournalManualRecoveryStatus(params.contentId),
    );
  } catch {
    return Response.json(
      { error: "Journal recovery status could not be read" },
      { status: 500 },
    );
  }
};
