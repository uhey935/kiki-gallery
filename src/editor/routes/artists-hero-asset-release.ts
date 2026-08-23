import type { APIRoute } from "astro";
import { contentWriterRoute } from "./content-writer-route.ts";
import { temporaryArtistsHeroAssetStore } from "../artists-hero-assets.ts";

const unlockedPOST: APIRoute = async ({ request }) => {
  try {
    const { token, contentId, workspaceId } = await request.json();
    if (typeof token !== "string" || typeof contentId !== "string" || typeof workspaceId !== "string")
      return Response.json({ error: "Invalid release request" }, { status: 400 });
    await (await temporaryArtistsHeroAssetStore).release(token, contentId, workspaceId);
    return Response.json({ released: true });
  } catch {
    return Response.json({ released: false }, { status: 404 });
  }
};
export const POST = contentWriterRoute("save", unlockedPOST);
