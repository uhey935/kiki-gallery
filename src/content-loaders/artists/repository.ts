import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import type {
  ArtistContentIssue,
  ArtistIdentity,
  ArtistLocale,
  ArtistSourceState,
  LoadedArtistUnit,
} from "./contracts.ts";
import {
  ARTIST_LOCALES,
  artistIdentitySchema,
  artistLocalizedSchema,
} from "./schema.ts";

const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function issue(
  contentId: string,
  partial: Omit<ArtistContentIssue, "collection" | "contentId">,
): ArtistContentIssue {
  return { collection: "artists", contentId, ...partial };
}

function yaml(raw: string) {
  const document = parseDocument(raw, { strict: true });
  return document.errors.length
    ? { error: document.errors[0].message }
    : { value: document.toJS() as unknown };
}

function parseIdentity(raw: string, contentId: string, file: string) {
  const parsed = yaml(raw);
  if (parsed.error)
    return {
      issues: [
        issue(contentId, {
          ruleId: "content.identity.parse",
          severity: "error",
          category: "parse",
          file,
          messageKey: "content.source.parseFailed",
        }),
      ],
    };
  const result = artistIdentitySchema.safeParse(parsed.value);
  return result.success
    ? { value: result.data, issues: [] }
    : {
        issues: [
          issue(contentId, {
            ruleId: "content.identity.structure",
            severity: "error",
            category: "structure",
            file,
            messageKey: "content.identity.invalid",
          }),
        ],
      };
}

function parseLocale(
  raw: string,
  contentId: string,
  locale: ArtistLocale,
  file: string,
) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match)
    return {
      issues: [
        issue(contentId, {
          ruleId: "content.locale.frontmatter",
          severity: "error",
          category: "parse",
          locale,
          file,
          messageKey: "content.locale.frontmatterInvalid",
        }),
      ],
    };
  const parsed = yaml(match[1]);
  const result = parsed.error
    ? undefined
    : artistLocalizedSchema.safeParse(parsed.value);
  if (!result?.success)
    return {
      issues: [
        issue(contentId, {
          ruleId: "content.locale.structure",
          severity: "error",
          category: parsed.error ? "parse" : "structure",
          locale,
          file,
          messageKey: "content.locale.invalid",
        }),
      ],
    };
  const issues: ArtistContentIssue[] = [];
  if (match[2].trim())
    issues.push(
      issue(contentId, {
        ruleId: "content.locale.body.unsupported",
        severity: "error",
        category: "structure",
        locale,
        file,
        fieldPath: "body",
        messageKey: "content.locale.bodyMustBeEmpty",
      }),
    );
  for (const [fieldPath, value] of Object.entries(result.data))
    if (typeof value === "string" && value.includes("__TODO_"))
      issues.push(
        issue(contentId, {
          ruleId: "content.placeholder.unresolved",
          severity: "error",
          category: "content-quality",
          locale,
          file,
          fieldPath,
          messageKey: "content.placeholder.unresolved",
        }),
      );
  return { value: result.data, issues };
}

async function read(file: string) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadArtistUnit(
  directory: string,
): Promise<LoadedArtistUnit> {
  const contentId = path.basename(directory);
  const issues: ArtistContentIssue[] = [];
  if (!CONTENT_ID.test(contentId))
    issues.push(
      issue(contentId, {
        ruleId: "content.id.invalid",
        severity: "error",
        category: "structure",
        file: directory,
        messageKey: "content.id.invalid",
      }),
    );

  const identityFile = path.join(directory, "index.yaml");
  const identityRaw = await read(identityFile);
  let identity: ArtistSourceState<ArtistIdentity>;
  if (identityRaw === undefined) {
    identity = { state: "missing" };
    issues.push(
      issue(contentId, {
        ruleId: "content.identity.missing",
        severity: "error",
        category: "unit-integrity",
        file: identityFile,
        messageKey: "content.identity.missing",
      }),
    );
  } else {
    const parsed = parseIdentity(identityRaw, contentId, identityFile);
    issues.push(...parsed.issues);
    identity = parsed.value
      ? { state: "valid", raw: identityRaw, value: parsed.value }
      : { state: "invalid", raw: identityRaw };
  }

  const locales = {} as LoadedArtistUnit["locales"];
  for (const locale of ARTIST_LOCALES) {
    const file = path.join(directory, `${locale}.md`);
    const raw = await read(file);
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
        }),
      );
      continue;
    }
    const parsed = parseLocale(raw, contentId, locale, file);
    issues.push(...parsed.issues);
    locales[locale] = parsed.value
      ? { state: "valid", raw, value: parsed.value }
      : { state: "invalid", raw };
  }
  return { contentId, directory, identity, locales, issues };
}

export async function loadArtistRepository(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort()
      .map(loadArtistUnit),
  );
}
