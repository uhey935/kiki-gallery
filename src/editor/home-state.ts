import path from "node:path";
import {
  assertHomeTopology,
  loadHomeUnit,
} from "../content-loaders/home/repository.ts";
import type {
  HomeIssue,
  HomeSourceState,
} from "../content-loaders/home/contracts.ts";
import type {
  HomeLocalized,
  HomeShared,
} from "../content-loaders/home/schema.ts";

export const HOME_CONTENT_ID = "home";
export type HomeEditorEntryState = {
  contentId: "home";
  shared: HomeSourceState<HomeShared>;
  locales: Record<"ja" | "en", HomeSourceState<HomeLocalized>>;
  issues: HomeIssue[];
  structuralStatus: "valid" | "issues";
  issueCount: number;
  capabilities: {
    save: boolean;
    preview: { ja: boolean; en: boolean };
    formal: { ja: boolean; en: boolean };
    publish: boolean;
  };
};
export class HomeEditorEntryNotFoundError extends Error {}
const canonicalRoot = path.resolve("src/content/home");

export async function readHomeEditorEntry(
  root = canonicalRoot,
): Promise<HomeEditorEntryState> {
  const unit = await loadHomeUnit(await assertHomeTopology(root));
  const structuralIssues = unit.issues.filter(
    ({ category }) => category !== "content-quality",
  );
  const valid =
    unit.shared.state === "valid" &&
    unit.locales.ja.state === "valid" &&
    unit.locales.en.state === "valid" &&
    structuralIssues.length === 0;
  if (
    !valid &&
    unit.shared.state === "missing" &&
    unit.locales.ja.state === "missing"
  )
    throw new HomeEditorEntryNotFoundError(
      "Home exact three-file unit is missing",
    );
  return {
    contentId: "home",
    shared: unit.shared,
    locales: unit.locales,
    issues: unit.issues,
    structuralStatus: valid ? "valid" : "issues",
    issueCount: unit.issues.length,
    capabilities: {
      save: valid,
      preview: { ja: valid, en: valid },
      formal: { ja: valid, en: valid },
      publish: valid,
    },
  };
}

export async function readHomeEditorState(root = canonicalRoot) {
  const entry = await readHomeEditorEntry(root);
  return {
    entries: [
      {
        contentId: "home",
        title: "Home",
        detail: "Shared · JA · EN",
        status: entry.structuralStatus,
        statusLabel: entry.issueCount
          ? `${entry.issueCount} content status item(s)`
          : "Ready",
      },
    ],
  };
}
