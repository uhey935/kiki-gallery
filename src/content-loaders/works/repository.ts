import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  WORK_LOCALES,
  validateImageAlignment,
  workLocalizedSchema,
  workSharedSchema,
  type WorkLocale,
  type WorkLocalized,
  type WorkShared,
} from "./schema.ts";

export type WorkIssue = {
  contentId: string;
  locale?: WorkLocale;
  ruleId: string;
  file?: string;
  message: string;
};
export type WorkSource<T> =
  | { state: "valid"; raw: string; value: T; body?: string }
  | { state: "invalid" | "missing"; raw?: string };
export type LoadedWorkUnit = {
  contentId: string;
  directory: string;
  shared: WorkSource<WorkShared>;
  locales: Record<WorkLocale, WorkSource<WorkLocalized>>;
  issues: WorkIssue[];
};
const exact = ["en.md", "index.yaml", "ja.md"];
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseYaml(raw: string) {
  const doc = parseDocument(raw, { strict: true, uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  return doc.toJS();
}
function parseMarkdown(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("Malformed Markdown frontmatter");
  return { data: parseYaml(match[1]), body: match[2] };
}
async function regular(file: string) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error("Not a regular non-symlink file");
  return fs.readFile(file, "utf8");
}

export async function loadWorkUnit(directory: string): Promise<LoadedWorkUnit> {
  const contentId = path.basename(directory);
  const issues: WorkIssue[] = [];
  let shared: WorkSource<WorkShared> = { state: "missing" };
  const locales = {} as LoadedWorkUnit["locales"];
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Content unit is not a regular directory");
    if (!idPattern.test(contentId))
      throw new Error("Invalid canonical Content ID");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names = entries.map((e) => e.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(exact))
      throw new Error(`Exact inventory required; got ${names.join(", ")}`);
    for (const entry of entries)
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(`${entry.name} is not a regular file`);
  } catch (error) {
    issues.push({
      contentId,
      ruleId: "works.unit.inventory",
      file: directory,
      message: String((error as Error).message),
    });
  }
  try {
    const file = path.join(directory, "index.yaml");
    const raw = await regular(file);
    shared = {
      state: "valid",
      raw,
      value: workSharedSchema.parse(parseYaml(raw)),
    };
  } catch (error) {
    issues.push({
      contentId,
      ruleId: "works.shared.invalid",
      file: path.join(directory, "index.yaml"),
      message: String((error as Error).message),
    });
    shared = { state: "invalid" };
  }
  for (const locale of WORK_LOCALES)
    try {
      const file = path.join(directory, `${locale}.md`);
      const raw = await regular(file);
      const parsed = parseMarkdown(raw);
      const value = workLocalizedSchema.parse(parsed.data);
      if (shared.state === "valid") validateImageAlignment(shared.value, value);
      locales[locale] = { state: "valid", raw, value, body: parsed.body };
      if (/__TODO_WORK_[A-Z0-9_]*__/.test(raw))
        issues.push({
          contentId,
          locale,
          ruleId: "works.placeholder.unresolved",
          file,
          message: "Reserved placeholder is unresolved",
        });
    } catch (error) {
      issues.push({
        contentId,
        locale,
        ruleId: "works.locale.invalid",
        file: path.join(directory, `${locale}.md`),
        message: String((error as Error).message),
      });
      locales[locale] = { state: "invalid" };
    }
  return { contentId, directory, shared, locales, issues };
}

export async function loadWorkRepository(root: string) {
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory())
    throw new Error("Works root is unsafe");
  const entries = await fs.readdir(root, { withFileTypes: true });
  const flat = entries.filter((e) => e.name.endsWith(".md"));
  const dirs = entries.filter((e) => e.isDirectory());
  if (flat.length && dirs.length)
    throw new Error("Mixed flat and directory Works inventory");
  if (entries.some((e) => !e.isDirectory() || e.isSymbolicLink()))
    throw new Error(
      "Works repository contains an extra, flat, symlink, or non-directory entry",
    );
  return Promise.all(
    dirs
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => loadWorkUnit(path.join(root, e.name))),
  );
}

export const localizedWorkEntryId = (contentId: string, locale: WorkLocale) =>
  `${locale}::${contentId}`;
