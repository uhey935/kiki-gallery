import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type {
  HomeIssue,
  HomeSourceState,
  LoadedHomeUnit,
} from "./contracts.ts";
import {
  HOME_EN_ABOUT_INTRO_PLACEHOLDER,
  HOME_LOCALES,
  homeLocalizedSchema,
  homeSharedSchema,
  type HomeLocalized,
  type HomeShared,
} from "./schema.ts";

const exactInventory = ["en.md", "index.yaml", "ja.md"];
const reservedPlaceholder = /__TODO_[A-Z0-9_]+__/;

function issue(
  message: string,
  category: HomeIssue["category"] = "structure",
  locale?: "ja" | "en",
): HomeIssue {
  return { message, category, locale };
}

function yamlValue<T>(
  raw: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
) {
  const document = parseDocument(raw, { strict: true, uniqueKeys: true });
  if (document.errors.length) return;
  const result = schema.safeParse(document.toJS());
  return result.success ? result.data : undefined;
}

async function isRegular(file: string) {
  const stat = await lstat(file).catch(() => undefined);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

export async function assertHomeTopology(root: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const flat = path.join(resolvedRoot, "home.md");
  const directory = path.join(resolvedRoot, "home");
  const flatStat = await lstat(flat).catch(() => undefined);
  const unitStat = await lstat(directory).catch(() => undefined);
  if (flatStat && unitStat)
    throw new Error("Mixed flat and three-file Home state");
  if (flatStat)
    throw new Error("Legacy flat Home state is not target topology");
  if (!unitStat?.isDirectory() || unitStat.isSymbolicLink())
    throw new Error("Missing or unsafe Home unit directory");
  return directory;
}

export async function loadHomeUnit(directory: string): Promise<LoadedHomeUnit> {
  const issues: HomeIssue[] = [];
  const stat = await lstat(directory).catch(() => undefined);
  const empty: LoadedHomeUnit = {
    contentId: "home",
    directory,
    shared: { state: "missing" },
    locales: { ja: { state: "missing" }, en: { state: "missing" } },
    issues,
  };
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    issues.push(issue("unsafe Home unit", "unit-integrity"));
    return empty;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(exactInventory))
    issues.push(issue("exact three-file inventory required", "unit-integrity"));
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile()))
    issues.push(issue("regular files only", "unit-integrity"));

  const sharedFile = path.join(directory, "index.yaml");
  let shared: HomeSourceState<HomeShared> = { state: "missing" };
  if (await isRegular(sharedFile)) {
    const raw = await readFile(sharedFile, "utf8");
    const value = yamlValue(raw, homeSharedSchema);
    shared = value ? { state: "valid", raw, value } : { state: "invalid", raw };
    if (!value) issues.push(issue("invalid index.yaml"));
  } else issues.push(issue("missing or unsafe index.yaml", "unit-integrity"));

  const locales = {} as LoadedHomeUnit["locales"];
  for (const locale of HOME_LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    if (!(await isRegular(file))) {
      locales[locale] = { state: "missing" };
      issues.push(
        issue(`missing or unsafe ${locale}.md`, "unit-integrity", locale),
      );
      continue;
    }
    const raw = await readFile(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?$/.exec(raw);
    const value = match
      ? yamlValue<HomeLocalized>(match[1], homeLocalizedSchema)
      : undefined;
    locales[locale] = value
      ? { state: "valid", raw, value }
      : { state: "invalid", raw };
    if (!value) issues.push(issue(`invalid ${locale}.md`, "structure", locale));
    if (reservedPlaceholder.test(raw))
      issues.push(issue("unresolved placeholder", "content-quality", locale));
    if (
      locale === "en" &&
      value?.about_intro === HOME_EN_ABOUT_INTRO_PLACEHOLDER
    )
      continue;
  }
  return { ...empty, shared, locales, issues };
}
