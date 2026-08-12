import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type {
  ExhibitionIssue,
  LoadedExhibitionUnit,
  SourceState,
} from "./contracts.ts";
import {
  EXHIBITION_LOCALES,
  exhibitionLocalizedSchema,
  exhibitionSharedSchema,
  type ExhibitionLocalized,
  type ExhibitionShared,
} from "./schema.ts";

const placeholder = /__TODO_[A-Z0-9_]+__/;
const issue = (
  contentId: string,
  messageKey: string,
  locale?: "ja" | "en",
  category: ExhibitionIssue["category"] = "structure",
): ExhibitionIssue => ({
  ruleId:
    category === "content-quality"
      ? "content.placeholder.unresolved"
      : "content.exhibition.structure",
  severity: "error",
  category,
  collection: "exhibitions",
  contentId,
  locale,
  messageKey,
});
function yamlValue<T>(
  raw: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
) {
  const document = parseDocument(raw, { strict: true, uniqueKeys: true });
  if (document.errors.length) return;
  const parsed = schema.safeParse(document.toJS());
  return parsed.success ? parsed.data : undefined;
}
async function regular(file: string) {
  const stat = await lstat(file).catch(() => undefined);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}
export async function loadExhibitionUnit(
  directory: string,
): Promise<LoadedExhibitionUnit> {
  const contentId = path.basename(directory);
  const issues: ExhibitionIssue[] = [];
  let names: string[] = [];
  const directoryStat = await lstat(directory).catch(() => undefined);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink())
    return {
      contentId,
      directory,
      shared: { state: "missing" },
      locales: { ja: { state: "missing" }, en: { state: "missing" } },
      issues: [issue(contentId, "unsafe unit", undefined, "unit-integrity")],
    };
  names = (await readdir(directory)).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(["en.md", "index.yaml", "ja.md"])
  )
    issues.push(
      issue(
        contentId,
        "exact three-file inventory required",
        undefined,
        "unit-integrity",
      ),
    );
  const sharedFile = path.join(directory, "index.yaml");
  let shared: SourceState<ExhibitionShared> = { state: "missing" };
  if (await regular(sharedFile)) {
    const raw = await readFile(sharedFile, "utf8");
    const value = yamlValue(raw, exhibitionSharedSchema);
    shared = value ? { state: "valid", raw, value } : { state: "invalid", raw };
    if (!value) issues.push(issue(contentId, "invalid index.yaml"));
  } else
    issues.push(
      issue(
        contentId,
        "missing or unsafe index.yaml",
        undefined,
        "unit-integrity",
      ),
    );
  const locales = {} as LoadedExhibitionUnit["locales"];
  for (const locale of EXHIBITION_LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    if (!(await regular(file))) {
      locales[locale] = { state: "missing" };
      issues.push(
        issue(
          contentId,
          `missing or unsafe ${locale}.md`,
          locale,
          "unit-integrity",
        ),
      );
      continue;
    }
    const raw = await readFile(file, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
    const value = match
      ? yamlValue<ExhibitionLocalized>(match[1], exhibitionLocalizedSchema)
      : undefined;
    locales[locale] = value
      ? { state: "valid", raw, value, body: match?.[2] ?? "" }
      : { state: "invalid", raw };
    if (!value) issues.push(issue(contentId, `invalid ${locale}.md`, locale));
    if (value && placeholder.test(`${match?.[1]}\n${match?.[2]}`))
      issues.push(
        issue(contentId, "unresolved placeholder", locale, "content-quality"),
      );
  }
  return { contentId, directory, shared, locales, issues };
}
export async function loadExhibitionRepository(
  root: string,
): Promise<LoadedExhibitionUnit[]> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Unsafe Exhibitions root");
  const entries = await readdir(root, { withFileTypes: true });
  if (
    entries.some(
      (entry) =>
        entry.isSymbolicLink() ||
        (entry.isFile() && entry.name.endsWith(".md")),
    )
  )
    throw new Error("Legacy flat, mixed, or symlinked Exhibitions inventory");
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (directories.length !== entries.length)
    throw new Error("Unexpected Exhibitions inventory");
  return Promise.all(
    directories.map((name) => loadExhibitionUnit(path.join(root, name))),
  );
}
