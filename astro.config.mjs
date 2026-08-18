// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://your-domain.com",
  integrations: [
    {
      name: "local-editor-routes",
      hooks: {
        "astro:config:setup": ({ command, injectRoute }) => {
          if (command !== "dev") return;
          injectRoute({
            pattern: "/editor/api/about",
            entrypoint: "./src/editor/routes/about-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/about-preview/create",
            entrypoint: "./src/editor/routes/about-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/about-publish",
            entrypoint: "./src/editor/routes/about-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/about/[token]/[contentId]",
            entrypoint: "./src/editor/routes/about-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/home",
            entrypoint: "./src/editor/routes/home-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/home-preview/create",
            entrypoint: "./src/editor/routes/home-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/home-publish",
            entrypoint: "./src/editor/routes/home-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/home/[token]/[contentId]",
            entrypoint: "./src/editor/routes/home-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal/[contentId]",
            entrypoint: "./src/editor/routes/journal-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal-create",
            entrypoint: "./src/editor/routes/journal-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal-rename",
            entrypoint: "./src/editor/routes/journal-rename.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal-delete",
            entrypoint: "./src/editor/routes/journal-delete.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/news-delete",
            entrypoint: "./src/editor/routes/news-delete.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/news-rename",
            entrypoint: "./src/editor/routes/news-rename.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/exhibitions-rename",
            entrypoint: "./src/editor/routes/exhibitions-rename.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/exhibitions-delete",
            entrypoint: "./src/editor/routes/exhibitions-delete.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/artists-rename",
            entrypoint: "./src/editor/routes/artists-rename.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/artists-delete",
            entrypoint: "./src/editor/routes/artists-delete.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works-rename",
            entrypoint: "./src/editor/routes/works-rename.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works-delete",
            entrypoint: "./src/editor/routes/works-delete.ts",
            prerender: false,
          });
          for (const collection of ["works", "artists", "exhibitions", "news"])
            injectRoute({
              pattern: `/editor/api/${collection}-create`,
              entrypoint: `./src/editor/routes/${collection}-create.ts`,
              prerender: false,
            });
          injectRoute({
            pattern: "/editor/api/works/[contentId]",
            entrypoint: "./src/editor/routes/works-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/exhibitions/[contentId]",
            entrypoint: "./src/editor/routes/exhibitions-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/artists/[contentId]",
            entrypoint: "./src/editor/routes/artists-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/news/[contentId]",
            entrypoint: "./src/editor/routes/news-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/news-preview/create",
            entrypoint: "./src/editor/routes/news-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/news-publish/[contentId]",
            entrypoint: "./src/editor/routes/news-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/news/[token]/[contentId]",
            entrypoint: "./src/editor/routes/news-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/artists-preview/create",
            entrypoint: "./src/editor/routes/artists-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/artists-publish/[contentId]",
            entrypoint: "./src/editor/routes/artists-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/artists/[token]/[contentId]",
            entrypoint: "./src/editor/routes/artists-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/exhibitions-preview/create",
            entrypoint: "./src/editor/routes/exhibitions-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/exhibitions-publish/[contentId]",
            entrypoint: "./src/editor/routes/exhibitions-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/exhibitions/[token]/[contentId]",
            entrypoint: "./src/editor/routes/exhibitions-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works-assets/upload/[contentId]",
            entrypoint: "./src/editor/routes/works-asset-upload.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal-preview/create",
            entrypoint: "./src/editor/routes/journal-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works-preview/create",
            entrypoint: "./src/editor/routes/works-preview-create.ts",
            prerender: false,
          });
          injectRoute({
            pattern:
              "/editor/api/works-preview/assets/[contentId]/[workspaceId]/[token]",
            entrypoint: "./src/editor/routes/works-preview-asset.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/journal-publish/[contentId]",
            entrypoint: "./src/editor/routes/journal-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works-publish/[contentId]",
            entrypoint: "./src/editor/routes/works-publish.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/journal/[token]/[locale]",
            entrypoint: "./src/editor/routes/journal-preview.astro",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/preview/works/[token]/[contentId]",
            entrypoint: "./src/editor/routes/works-preview.astro",
            prerender: false,
          });
        },
      },
    },
  ],
});
