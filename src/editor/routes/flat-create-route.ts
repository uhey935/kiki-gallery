import type { APIRoute } from "astro";

import {
  createArtistsEditorEntry,
  createExhibitionsEditorEntry,
  createNewsEditorEntry,
  createWorksEditorEntry,
} from "../collection-create.ts";
import { FlatCreateError } from "../flat-create.ts";
import { contentWriterRoute } from "./content-writer-route.ts";

const create = {
  works: createWorksEditorEntry,
  artists: createArtistsEditorEntry,
  exhibitions: createExhibitionsEditorEntry,
  news: createNewsEditorEntry,
};

export function flatCreateRoute(collection: keyof typeof create): APIRoute {
  return contentWriterRoute("create", async ({ request }) => {
    try {
      const body = (await request.json()) as {
        draft?: { contentId?: unknown };
      };
      if (
        !body?.draft ||
        typeof body.draft !== "object" ||
        typeof body.draft.contentId !== "string"
      )
        return Response.json(
          {
            error: `A ${collection} draft is required`,
            code: "invalid-request",
          },
          { status: 400 },
        );
      const draft = await create[collection](body.draft as never);
      return Response.json({
        draft,
        workspaceUrl: `/editor/${collection}/workspace/${encodeURIComponent(draft.contentId)}/`,
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : `${collection} create failed`,
          code: error instanceof FlatCreateError ? error.code : "create-failed",
        },
        {
          status:
            error instanceof SyntaxError || error instanceof FlatCreateError
              ? 400
              : 500,
        },
      );
    }
  });
}
