import type { APIRoute } from "astro";
import {
  ContentLifecycleLockError,
  withContentLifecycleLock,
  type ContentWriter,
} from "../content-lifecycle-lock.ts";

export function contentWriterRoute(
  writer: Exclude<ContentWriter, "delete" | "restore">,
  route: APIRoute,
): APIRoute {
  return async (context) => {
    try {
      return await withContentLifecycleLock({
        writer,
        action: async () => route(context),
      });
    } catch (error) {
      if (error instanceof ContentLifecycleLockError)
        return Response.json(
          {
            error:
              "Another content lifecycle operation is active or requires reconciliation.",
            code: "lock-conflict",
          },
          { status: 409 },
        );
      throw error;
    }
  };
}
