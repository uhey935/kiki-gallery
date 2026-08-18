import path from "node:path";
import type {
  AboutIssue,
  AboutLocalized,
  AboutSourceState,
} from "../content-loaders/about/contracts.ts";
import { evaluateAboutLocale } from "../content-loaders/about/facade.ts";
import {
  assertAboutTopology,
  loadAboutUnit,
} from "../content-loaders/about/repository.ts";
import type { AboutShared } from "../content-loaders/about/schema.ts";

export const ABOUT_CONTENT_ID = "about";
const canonicalRoot = path.resolve("src/content/about");
const assets = {
  hero: true,
  "gallery-1": true,
  "gallery-2": true,
  "gallery-3": true,
  "gallery-4": true,
} as const;

export type AboutEditorEntryState = {
  contentId: "about";
  shared: AboutSourceState<AboutShared>;
  locales: Record<"ja" | "en", AboutSourceState<AboutLocalized>>;
  issues: AboutIssue[];
  structuralStatus: "valid" | "issues";
  capabilities: {
    save: boolean;
    publish: boolean;
    preview: { ja: boolean; en: boolean };
    formal: { ja: boolean; en: boolean };
  };
};

export async function readAboutEditorEntry(root = canonicalRoot) {
  const unit = await loadAboutUnit(await assertAboutTopology(root));
  const structural =
    unit.shared.state === "valid" &&
    unit.locales.ja.state === "valid" &&
    unit.locales.en.state === "valid" &&
    !unit.issues.some(({ category }) =>
      ["structure", "unit-integrity"].includes(category),
    );
  const ja = evaluateAboutLocale(unit, "ja", assets, true);
  const en = evaluateAboutLocale(unit, "en", assets, true);
  return {
    contentId: "about" as const,
    shared: unit.shared,
    locales: unit.locales,
    issues: unit.issues,
    structuralStatus: structural ? ("valid" as const) : ("issues" as const),
    capabilities: {
      save: structural,
      publish: structural,
      preview: { ja: ja.previewable, en: en.previewable },
      formal: { ja: ja.formal, en: en.formal },
    },
  } satisfies AboutEditorEntryState;
}

export async function readAboutEditorState(root = canonicalRoot) {
  const entry = await readAboutEditorEntry(root);
  const status = (locale: "ja" | "en") =>
    entry.locales[locale].state === "valid"
      ? entry.locales[locale].value.content_status
      : entry.locales[locale].state;
  return {
    entries: [
      {
        contentId: "about",
        title: "About",
        detail: `Singleton · JA ${status("ja")} · EN ${status("en")}`,
        status: entry.structuralStatus,
        statusLabel:
          entry.structuralStatus === "valid" ? "Ready" : "Content issues",
      },
    ],
  };
}
