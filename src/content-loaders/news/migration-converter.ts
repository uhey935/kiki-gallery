import { parseDocument, stringify } from "yaml";
import { newsLocalizedSchema, newsSharedSchema } from "./schema.ts";

export const NEWS_MIGRATION_VERSION = 1 as const;

export const NEWS_EN_PLACEHOLDERS = {
  title: "__TODO_EN_TITLE__",
  summary: "__TODO_EN_SUMMARY__",
} as const;

type ConvertedNewsFiles = {
  shared: string;
  ja: string;
  en: string;
};

function splitLegacyMarkdown(bytes: Buffer, source: string) {
  const delimiter = Buffer.from("---");
  if (!bytes.subarray(0, delimiter.length).equals(delimiter)) {
    throw new Error(`${source}: opening frontmatter delimiter is missing`);
  }
  const firstLineEnd = bytes.indexOf(0x0a);
  const closingStart = bytes.indexOf(Buffer.from("\n---"), firstLineEnd);
  if (firstLineEnd < 0 || closingStart < 0) {
    throw new Error(`${source}: closing frontmatter delimiter is missing`);
  }
  const closingLineEnd = bytes.indexOf(0x0a, closingStart + 1);
  const bodyStart = closingLineEnd < 0 ? bytes.length : closingLineEnd + 1;
  return {
    frontmatter: bytes
      .subarray(firstLineEnd + 1, closingStart)
      .toString("utf8"),
    body: bytes.subarray(bodyStart).toString("utf8"),
  };
}

function markdownFile(frontmatter: Record<string, unknown>, body = ""): string {
  return `---\n${stringify(frontmatter).trimEnd()}\n---\n${body}`;
}

export function convertLegacyNewsMarkdown(
  sourceBytes: Buffer,
  source: string,
): ConvertedNewsFiles {
  const { frontmatter, body } = splitLegacyMarkdown(sourceBytes, source);
  const document = parseDocument(frontmatter, { strict: true });
  if (document.errors.length) {
    throw new Error(`${source}: ${document.errors[0].message}`);
  }
  const legacy = document.toJS() as Record<string, unknown>;
  const shared = newsSharedSchema.safeParse({
    date: legacy.date,
    news_type: legacy.news_type,
    link: legacy.link,
    show_on_home: legacy.show_on_home,
  });
  if (!shared.success) {
    throw new Error(
      `${source}: invalid shared News fields: ${shared.error.message}`,
    );
  }
  const localized = newsLocalizedSchema.safeParse({
    title: legacy.title,
    summary: legacy.summary,
  });
  if (!localized.success) {
    throw new Error(
      `${source}: invalid localized News fields: ${localized.error.message}`,
    );
  }

  const knownFields = new Set([
    "title",
    "summary",
    "date",
    "news_type",
    "link",
    "show_on_home",
  ]);
  const unknownFields = Object.keys(legacy).filter(
    (field) => !knownFields.has(field),
  );
  if (unknownFields.length) {
    throw new Error(
      `${source}: unknown legacy News fields: ${unknownFields.join(", ")}`,
    );
  }

  return {
    shared: stringify(shared.data),
    ja: markdownFile(localized.data, body),
    en: markdownFile(NEWS_EN_PLACEHOLDERS),
  };
}
