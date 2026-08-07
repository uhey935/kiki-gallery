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

async function readSource(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadJournalUnit(
  directory: string,
): Promise<LoadedJournalUnit> {
  const contentId = path.basename(directory);
  const issues: ContentIssue[] = [];
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
  const sharedRaw = await readSource(sharedFile);
  let shared: SourceState<JournalShared>;
  if (sharedRaw === undefined) {
    shared = { state: "missing" };
    issues.push(
      issue(contentId, {
        ruleId: "content.file.missing",
        severity: "error",
        category: "unit-integrity",
        file: sharedFile,
        messageKey: "content.file.missing",
        params: { expected: "index.yaml" },
        recovery: { kind: "edit-source" },
      }),
    );
  } else {
    const result = parseShared(sharedRaw, contentId, sharedFile);
    issues.push(...result.issues);
    shared = result.value
      ? { state: "valid", raw: sharedRaw, value: result.value }
      : { state: "invalid", raw: sharedRaw };
  }
  const locales = {} as LoadedJournalUnit["locales"];
  for (const locale of LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    const raw = await readSource(file);
    if (raw === undefined) {
      locales[locale] = { state: "missing" };
      issues.push(
        issue(contentId, {
          ruleId: "content.locale.missing",
          severity: "error",
          category: "unit-integrity",
          locale,
          file,
          messageKey: "content.locale.missing",
          recovery: { kind: "edit-source" },
        }),
      );
      continue;
    }
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
  const entries = await fs.readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
  return Promise.all(directories.map(loadJournalUnit));
}
