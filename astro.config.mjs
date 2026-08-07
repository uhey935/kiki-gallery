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
            pattern: "/editor/api/journal/[contentId]",
            entrypoint: "./src/editor/routes/journal-save.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/editor/api/works/[contentId]",
            entrypoint: "./src/editor/routes/works-save.ts",
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
