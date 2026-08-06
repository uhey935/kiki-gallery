import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  decideJournalSurface,
  findJournalEntry,
  journalRouteRegistry,
  queryJournalEntries,
  type JournalSurface,
} from "../../content-boundaries/journal.ts";
import type {
  ContentCapabilities,
  ContentIssue,
  JournalEntry,
  JournalEntryData,
  JournalLocalized,
  JournalShared,
  LoadedJournalUnit,
  Locale,
  SourceState,
} from "./contracts.ts";

const LOCALES = ["ja", "en"] as const;
const CATEGORIES = new Set(["interview", "essay", "report"]);
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function issue(
  contentId: string,
  partial: Omit<ContentIssue, "collection" | "contentId">,
): ContentIssue {
  return { collection: "journal", contentId, ...partial };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
  const value = parsed.value as Record<string, unknown>;
  const issues: ContentIssue[] = [];
  const allowed = new Set([
    "date",
    "categories",
    "hero",
    "author",
    "credits",
    "visibility",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(
      issue(contentId, {
        ruleId: "content.shared.structure",
        severity: "error",
        category: "structure",
        file,
        messageKey: "content.shared.objectRequired",
      }),
    );
    return { issues };
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const hero = value.hero as Record<string, unknown> | undefined;
  const categories = value.categories;
  const dateValid =
    nonEmpty(value.date) &&
    ISO_DATE.test(value.date) &&
    !Number.isNaN(Date.parse(`${value.date}T00:00:00Z`));
  const categoryValid =
    Array.isArray(categories) &&
    categories.length > 0 &&
    categories.every(
      (item) => typeof item === "string" && CATEGORIES.has(item),
    );
  const heroValid =
    hero &&
    nonEmpty(hero.image) &&
    Object.keys(hero).every(
      (key) => key === "image" || key === "hero_caption",
    ) &&
    (hero.hero_caption === undefined || nonEmpty(hero.hero_caption));
  const visibilityValid =
    value.visibility === "public" || value.visibility === "hidden";
  const creditValid =
    value.credits === undefined ||
    (Array.isArray(value.credits) &&
      value.credits.every((credit) => {
        if (!credit || typeof credit !== "object" || Array.isArray(credit))
          return false;
        const item = credit as Record<string, unknown>;
        return (
          nonEmpty(item.role) &&
          ((nonEmpty(item.person) && item.member === undefined) ||
            (nonEmpty(item.member) && item.person === undefined))
        );
      }));
  if (
    unknown.length ||
    !dateValid ||
    !categoryValid ||
    !heroValid ||
    !visibilityValid ||
    !creditValid ||
    (value.author !== undefined && value.credits !== undefined) ||
    (value.author !== undefined && !nonEmpty(value.author))
  ) {
    issues.push(
      issue(contentId, {
        ruleId: "content.shared.structure",
        severity: "error",
        category: "structure",
        file,
        messageKey: "content.shared.invalid",
        params: { unknownFields: unknown.join(",") },
        recovery: { kind: "edit-source" },
      }),
    );
    return { issues };
  }
  return { value: value as JournalShared, issues };
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
  const data = parsed.value as Record<string, unknown>;
  const allowed = new Set(["title", "summary", "hero_alt"]);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some((key) => !allowed.has(key)) ||
    !nonEmpty(data.title) ||
    !nonEmpty(data.summary) ||
    !nonEmpty(data.hero_alt)
  ) {
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
  const value = { ...(data as JournalLocalized), body: match[2] };
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

export function journalEntryId(contentId: string, locale: Locale): string {
  return `${locale}::${contentId}`;
}

export function entriesFromUnits(units: LoadedJournalUnit[]): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const unit of units) {
    if (unit.shared.state !== "valid") continue;
    for (const locale of LOCALES) {
      const localized = unit.locales[locale];
      if (localized.state !== "valid") continue;
      const { body, ...data } = localized.value;
      entries.push({
        id: journalEntryId(unit.contentId, locale),
        data: {
          ...unit.shared.value,
          ...data,
          contentId: unit.contentId,
          locale,
        },
        body,
        filePath: path.join(unit.directory, `${locale}.md`),
      });
    }
  }
  return entries;
}

export function synchronizeEntryMap(
  store: Map<string, JournalEntry>,
  units: LoadedJournalUnit[],
): void {
  const entries = entriesFromUnits(units);
  const nextIds = new Set(entries.map((entry) => entry.id));
  for (const id of store.keys()) {
    if (!nextIds.has(id)) store.delete(id);
  }
  for (const entry of entries) store.set(entry.id, entry);
}

function result(blockers: ContentIssue[], all: ContentIssue[]) {
  return {
    allowed: blockers.length === 0,
    blockers,
    warnings: all.filter((item) => item.severity === "warning"),
  };
}

export function evaluateJournalCapabilities(
  unit: LoadedJournalUnit,
): ContentCapabilities {
  const saveBlockers = unit.issues.filter(
    (item) =>
      item.category === "parse" ||
      item.category === "structure" ||
      item.category === "conflict" ||
      item.category === "infrastructure",
  );
  const preview = (locale: Locale) =>
    unit.issues.filter(
      (item) =>
        item.severity === "error" &&
        (item.locale === locale || item.locale === undefined) &&
        (item.category === "parse" ||
          item.category === "structure" ||
          item.category === "unit-integrity" ||
          item.ruleId === "content.placeholder.unresolved"),
    );
  const publishBlockers = unit.issues.filter(
    (item) => item.severity === "error",
  );
  return {
    save: result(saveBlockers, unit.issues),
    preview: {
      ja: result(preview("ja"), unit.issues),
      en: result(preview("en"), unit.issues),
    },
    publish: result(publishBlockers, unit.issues),
  };
}

export function selectJournalForSurface(
  entries: JournalEntry[],
  units: LoadedJournalUnit[],
  locale: Locale,
  surface: Exclude<JournalSurface, "detail">,
): JournalEntry[] {
  const issuesById = new Map(
    units.map((unit) => [unit.contentId, unit.issues]),
  );
  return queryJournalEntries(entries, locale).filter(
    (entry) =>
      decideJournalSurface(
        entry,
        issuesById.get(entry.data.contentId) ?? [],
        surface,
      ).kind === "render",
  );
}

export function flattenForAstro(entry: JournalEntry): JournalEntryData {
  return entry.data;
}

export {
  decideJournalSurface,
  findJournalEntry,
  journalRouteRegistry,
  queryJournalEntries,
};
