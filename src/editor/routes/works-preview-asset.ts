import type { APIRoute } from "astro";

import {
  type TemporaryWorksAssetStore,
  temporaryWorksAssetStore,
} from "../works-asset-store.ts";

export async function serveTemporaryWorksPreviewAsset(
  params: Partial<Record<"token" | "contentId" | "workspaceId", string>>,
  store: TemporaryWorksAssetStore,
): Promise<Response> {
  const { token, contentId, workspaceId } = params;
  if (!token || !contentId || !workspaceId)
    return new Response("Not found", { status: 404 });
  try {
    const { metadata, bytes } = await store.read(token, contentId, workspaceId);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": metadata.mime,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }
}

export const GET: APIRoute = async ({ params }) =>
  serveTemporaryWorksPreviewAsset(params, await temporaryWorksAssetStore);
