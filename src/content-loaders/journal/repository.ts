import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import type {
  ContentIssue,
  JournalLocalized,
  JournalShared,
  LoadedJournalUnit,
  Locale,
  SourceState,
} from "./contracts.ts";
import { journalLocalizedSchema, journalSharedSchema } from "./schema.ts";

const LOCALES = ["ja", "en"] as const;
const EXACT_UNIT_INVENTORY = ["en.md", "index.yaml", "ja.md"] as const;
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function issue(
  contentId: string,
  partial: Omit<ContentIssue, "collection" | "contentId">,
): ContentIssue {
  return { collection: "journal", contentId, ...partial };
}

function parseYaml(raw: string, contentId: string, file: string) {
  const document = parseDocument(raw, { strict: true });
  if (document.errors.length) {
    return {
      error: issue(contentId, {
        ruleId: "content.shared.parse",
        severity: "error",
        category: "parse",
        file,
        messageKey: "content.source.parseFailed",
        params: { detail: document.errors[0].message },
        recovery: { kind: "edit-source" },
      }),
    };
  }
  return { value: document.toJS() as unknown };
}

function parseShared(
  raw: string,
  contentId: string,
  file: string,
): { value?: JournalShared; issues: ContentIssue[] } {
  const parsed = parseYaml(raw, contentId, file);
  if (parsed.error) return { issues: [parsed.error] };
  const result = journalSharedSchema.safeParse(parsed.value);
  if (result.success) return { value: result.data, issues: [] };
  return {
    issues: [
      issue(contentId, {
        ruleId: "content.shared.structure",
        severity: "error",
        category: "structure",
        file,
        messageKey: "content.shared.invalid",
        params: {
          fields: result.error.issues
            .map((item) => item.path.join("."))
            .filter(Boolean)
            .join(","),
        },
        recovery: { kind: "edit-source" },
      }),
    ],
  };
}

function parseMarkdown(
  raw: string,
  contentId: string,
  locale: Locale,
  file: string,
): { value?: JournalLocalized & { body: string }; issues: ContentIssue[] } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return {
      issues: [
        issue(contentId, {
          ruleId: "content.locale.frontmatter",
          severity: "error",
          category: "parse",
          locale,
          file,
          messageKey: "content.locale.frontmatterInvalid",
          recovery: { kind: "edit-source" },
        }),
      ],
    };
  }
  const parsed = parseYaml(match[1], contentId, file);
  if (parsed.error) return { issues: [{ ...parsed.error, locale }] };
  const localized = journalLocalizedSchema.safeParse(parsed.value);
  if (!localized.success) {
    return {
      issues: [
        issue(contentId, {
          ruleId: "content.locale.structure",
          severity: "error",
          category: "structure",
          locale,
          file,
          messageKey: "content.locale.invalid",
          recovery: { kind: "edit-source" },
        }),
      ],
    };
  }
  const value = { ...localized.data, body: match[2] };
  const issues: ContentIssue[] = [];
  for (const [fieldPath, candidate] of Object.entries(value)) {
    if (typeof candidate === "string" && candidate.includes("__TODO_")) {
      issues.push(
        issue(contentId, {
          ruleId: "content.placeholder.unresolved",
          severity: "error",
          category: "content-quality",
          locale,
          file,
          fieldPath,
          messageKey: "content.placeholder.unresolved",
          recovery: {
            kind: fieldPath === "body" ? "edit-source" : "edit-field",
            fieldPath,
          },
        }),
      );
    }
  }
  return { value, issues };
}

type SourceRead =
  | { state: "present"; raw: string }
  | { state: "missing" }
  | { state: "unsafe" };

async function readSource(file: string): Promise<SourceRead> {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { state: "unsafe" };
    return { state: "present", raw: await fs.readFile(file, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { state: "missing" };
    throw error;
  }
}

async function inspectUnitTopology(
  directory: string,
  contentId: string,
): Promise<ContentIssue[]> {
  try {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Content unit is not a regular non-symlink directory");
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names = entries.map((entry) => entry.name).sort();
    const unexpected = names.filter(
      (name) =>
        !EXACT_UNIT_INVENTORY.includes(
          name as (typeof EXACT_UNIT_INVENTORY)[number],
        ),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Exact three-file inventory required; got ${names.join(", ")}`,
      );
    }
    const unsafe = entries.find(
      (entry) => entry.isSymbolicLink() || !entry.isFile(),
    );
    if (unsafe) throw new Error(`${unsafe.name} is not a regular file`);
    return [];
  } catch (error) {
    return [
      issue(contentId, {
        ruleId: "content.repository.inventory",
        severity: "error",
        category: "repository-integrity",
        file: directory,
        messageKey: "content.repository.inventoryInvalid",
        params: { detail: String((error as Error).message) },
        recovery: { kind: "manual-review" },
      }),
    ];
  }
}

export async function loadJournalUnit(
  directory: string,
): Promise<LoadedJournalUnit> {
  const contentId = path.basename(directory);
  const issues: ContentIssue[] = await inspectUnitTopology(
    directory,
    contentId,
  );
  if (!CONTENT_ID.test(contentId)) {
    issues.push(
      issue(contentId, {
        ruleId: "content.id.invalid",
        severity: "error",
        category: "structure",
        file: directory,
        messageKey: "content.id.invalid",
        recovery: { kind: "manual-review" },
      }),
    );
  }
  const sharedFile = path.join(directory, "index.yaml");
  const sharedSource = await readSource(sharedFile);
  let shared: SourceState<JournalShared>;
  if (sharedSource.state !== "present") {
    shared = { state: "missing" };
    issues.push(
      issue(contentId, {
        ruleId:
          sharedSource.state === "missing"
            ? "content.file.missing"
            : "content.file.unsafe",
        severity: "error",
        category: "unit-integrity",
        file: sharedFile,
        messageKey:
          sharedSource.state === "missing"
            ? "content.file.missing"
            : "content.file.unsafe",
        params: { expected: "index.yaml" },
        recovery: {
          kind:
            sharedSource.state === "missing" ? "edit-source" : "manual-review",
        },
      }),
    );
  } else {
    const sharedRaw = sharedSource.raw;
    const result = parseShared(sharedRaw, contentId, sharedFile);
    issues.push(...result.issues);
    shared = result.value
      ? { state: "valid", raw: sharedRaw, value: result.value }
      : { state: "invalid", raw: sharedRaw };
  }
  const locales = {} as LoadedJournalUnit["locales"];
  for (const locale of LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    const source = await readSource(file);
    if (source.state !== "present") {
      locales[locale] = { state: "missing" };
      issues.push(
        issue(contentId, {
          ruleId:
            source.state === "missing"
              ? "content.locale.missing"
              : "content.locale.unsafe",
          severity: "error",
          category: "unit-integrity",
          locale,
          file,
          messageKey:
            source.state === "missing"
              ? "content.locale.missing"
              : "content.locale.unsafe",
          recovery: {
            kind: source.state === "missing" ? "edit-source" : "manual-review",
          },
        }),
      );
      continue;
    }
    const raw = source.raw;
    const result = parseMarkdown(raw, contentId, locale, file);
    issues.push(...result.issues);
    locales[locale] = result.value
      ? { state: "valid", raw, value: result.value }
      : { state: "invalid", raw };
  }
  return { contentId, directory, shared, locales, issues };
}

export async function loadJournalRepository(
  root: string,
): Promise<LoadedJournalUnit[]> {
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Journal repository root is unsafe");
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink() || !entry.isDirectory())) {
    throw new Error(
      "Journal repository contains an extra, symlinked, or non-directory entry",
    );
  }
  const directories = entries
    .map((entry) => path.join(root, entry.name))
    .sort();
  return Promise.all(directories.map(loadJournalUnit));
}
