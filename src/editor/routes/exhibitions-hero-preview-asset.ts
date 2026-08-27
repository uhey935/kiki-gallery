import type { APIRoute } from "astro";
import { temporaryExhibitionsHeroAssetStore } from "../exhibitions-hero-assets.ts";

export async function serveTemporaryExhibitionsHero(params: Partial<Record<"token" | "contentId" | "workspaceId", string>>) {
  const { token, contentId, workspaceId } = params;
  if (!token || !contentId || !workspaceId) return new Response("Not found", { status: 404 });
  try {
    const { metadata, bytes } = await (await temporaryExhibitionsHeroAssetStore).read(token, contentId, workspaceId);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, { headers: {
      "content-type": metadata.mime,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    }});
  } catch {
    return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  }
}
export const GET: APIRoute = ({ params }) => serveTemporaryExhibitionsHero(params);
