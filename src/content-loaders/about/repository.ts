import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type {
  AboutIssue,
  AboutSourceState,
  LoadedAboutUnit,
} from "./contracts.ts";
import {
  ABOUT_LOCALES,
  aboutLocalizedFrontmatterSchema,
  aboutSharedSchema,
  containsAboutPlaceholder,
  type AboutLocalizedFrontmatter,
  type AboutShared,
} from "./schema.ts";

const exactInventory = ["en.md", "index.yaml", "ja.md"];

const issue = (
  message: string,
  category: AboutIssue["category"] = "structure",
  locale?: "ja" | "en",
): AboutIssue => ({ message, category, locale });

function yamlValue<T>(
  raw: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
) {
  const document = parseDocument(raw, { strict: true, uniqueKeys: true });
  if (document.errors.length) return;
  const result = schema.safeParse(document.toJS());
  return result.success ? result.data : undefined;
}

async function regular(file: string) {
  const stat = await lstat(file).catch(() => undefined);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

export async function assertAboutTopology(root: string) {
  const resolved = path.resolve(root);
  const flat = path.join(resolved, "about.md");
  const directory = path.join(resolved, "about");
  const flatStat = await lstat(flat).catch(() => undefined);
  const unitStat = await lstat(directory).catch(() => undefined);
  if (flatStat && unitStat)
    throw new Error("Mixed legacy and three-file About state");
  if (flatStat)
    throw new Error("Legacy flat About state is not target topology");
  if (!unitStat?.isDirectory() || unitStat.isSymbolicLink())
    throw new Error("Missing or unsafe About singleton directory");
  return directory;
}

export async function loadAboutUnit(
  directory: string,
): Promise<LoadedAboutUnit> {
  const issues: AboutIssue[] = [];
  const empty: LoadedAboutUnit = {
    contentId: "about",
    directory,
    shared: { state: "missing" },
    locales: { ja: { state: "missing" }, en: { state: "missing" } },
    issues,
  };
  const stat = await lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    issues.push(issue("unsafe About unit", "unit-integrity"));
    return empty;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(exactInventory))
    issues.push(issue("exact three-file inventory required", "unit-integrity"));
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isFile()))
    issues.push(issue("regular files only", "unit-integrity"));

  const sharedFile = path.join(directory, "index.yaml");
  let shared: AboutSourceState<AboutShared> = { state: "missing" };
  if (await regular(sharedFile)) {
    const raw = await readFile(sharedFile, "utf8");
    const value = yamlValue(raw, aboutSharedSchema);
    shared = value ? { state: "valid", raw, value } : { state: "invalid", raw };
    if (!value) issues.push(issue("invalid index.yaml"));
    if (value?.hours.status === "pending")
      issues.push(
        issue("About hours await human approval", "factual-approval"),
      );
  } else issues.push(issue("missing or unsafe index.yaml", "unit-integrity"));

  const locales = {} as LoadedAboutUnit["locales"];
  for (const locale of ABOUT_LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    if (!(await regular(file))) {
      locales[locale] = { state: "missing" };
      issues.push(
        issue(`missing or unsafe ${locale}.md`, "unit-integrity", locale),
      );
      continue;
    }
    const raw = await readFile(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
    const frontmatter = match
      ? yamlValue<AboutLocalizedFrontmatter>(
          match[1],
          aboutLocalizedFrontmatterSchema,
        )
      : undefined;
    const body = match?.[2].trim() ?? "";
    const bodyValid =
      frontmatter?.content_status === "placeholder"
        ? Boolean(body)
        : Boolean(body) && !containsAboutPlaceholder(body);
    const value =
      frontmatter && bodyValid ? { ...frontmatter, body } : undefined;
    locales[locale] = value
      ? { state: "valid", raw, value }
      : { state: "invalid", raw };
    if (!value) issues.push(issue(`invalid ${locale}.md`, "structure", locale));
    if (value?.content_status !== "approved" || containsAboutPlaceholder(raw))
      issues.push(
        issue(
          "localized About content is not approved",
          "content-quality",
          locale,
        ),
      );
  }
  return { ...empty, shared, locales, issues };
}
