import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, stringify } from "yaml";

const LEGACY_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const LOCALIZED_FIELDS = ["title", "summary", "hero_alt"] as const;
const SHARED_FIELDS = [
  "date",
  "categories",
  "hero",
  "author",
  "credits",
] as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type LegacyJournalMigrationItem = {
  contentId: string;
  source: string;
  destinations: { shared: string; ja: string; en: string };
  shared: Record<string, unknown> & { visibility: "public" };
  localized: Record<string, unknown>;
  enPlaceholder: {
    title: "__TODO_EN_TITLE__";
    summary: "__TODO_EN_SUMMARY__";
    hero_alt: "__TODO_EN_HERO_ALT__";
    body: "__TODO_EN_BODY__";
  };
  originalByteLength: number;
  originalSha256: string;
  originalBase64: string;
  bodyByteLength: number;
  bodySha256: string;
  bodyBase64: string;
};

export type LegacyJournalMigrationManifest = {
  version: 1;
  mode: "dry-run";
  sourceRoot: string;
  count: number;
  entries: LegacyJournalMigrationItem[];
};

const LOCALIZED_PLACEHOLDERS = {
  title: "__TODO_EN_TITLE__",
  summary: "__TODO_EN_SUMMARY__",
  hero_alt: "__TODO_EN_HERO_ALT__",
} as const;

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
    body: bytes.subarray(bodyStart),
  };
}

export async function createLegacyJournalMigrationManifest(
  sourceRoot: string,
): Promise<LegacyJournalMigrationManifest> {
  const names = (await fs.readdir(sourceRoot))
    .filter((name) => LEGACY_FILE.test(name))
    .sort();
  const entries: LegacyJournalMigrationItem[] = [];
  for (const name of names) {
    const source = path.join(sourceRoot, name);
    const contentId = name.slice(0, -3);
    const original = await fs.readFile(source);
    const { frontmatter, body } = splitLegacyMarkdown(original, source);
    const document = parseDocument(frontmatter, { strict: true });
    if (document.errors.length) throw document.errors[0];
    const data = document.toJS() as Record<string, unknown>;
    const shared: Record<string, unknown> & { visibility: "public" } = {
      visibility: "public",
    };
    const localized: Record<string, unknown> = {};
    for (const field of SHARED_FIELDS)
      if (data[field] !== undefined) shared[field] = data[field];
    for (const field of LOCALIZED_FIELDS) localized[field] = data[field];
    const target = path.join(sourceRoot, contentId);
    entries.push({
      contentId,
      source,
      destinations: {
        shared: path.join(target, "index.yaml"),
        ja: path.join(target, "ja.md"),
        en: path.join(target, "en.md"),
      },
      shared,
      localized,
      enPlaceholder: {
        ...LOCALIZED_PLACEHOLDERS,
        body: "__TODO_EN_BODY__",
      },
      originalByteLength: original.byteLength,
      originalSha256: sha256(original),
      originalBase64: original.toString("base64"),
      bodyByteLength: body.byteLength,
      bodySha256: sha256(body),
      bodyBase64: body.toString("base64"),
    });
  }
  return {
    version: 1,
    mode: "dry-run",
    sourceRoot,
    count: entries.length,
    entries,
  };
}

function markdownFile(frontmatter: Record<string, unknown>, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`---\n${stringify(frontmatter).trimEnd()}\n---\n`),
    body,
  ]);
}

export async function writeLegacyJournalMigration(
  manifest: LegacyJournalMigrationManifest,
): Promise<void> {
  if (manifest.count !== 9) throw new Error(`Expected 9 entries, got ${manifest.count}`);

  for (const entry of manifest.entries) {
    const original = Buffer.from(entry.originalBase64, "base64");
    if (original.byteLength !== entry.originalByteLength || sha256(original) !== entry.originalSha256) {
      throw new Error(`${entry.contentId}: rollback bytes do not match manifest`);
    }
    const current = await fs.readFile(entry.source);
    if (!current.equals(original)) throw new Error(`${entry.contentId}: source changed after manifest freeze`);
  }

  const staged: Array<{ temporary: string; destination: string }> = [];
  const committed: string[] = [];
  try {
    for (const entry of manifest.entries) {
      const target = path.dirname(entry.destinations.shared);
      const temporary = `${target}.migration-stage`;
      await fs.mkdir(temporary, { recursive: false });
      const body = Buffer.from(entry.bodyBase64, "base64");
      if (body.byteLength !== entry.bodyByteLength || sha256(body) !== entry.bodySha256) {
        throw new Error(`${entry.contentId}: body bytes do not match manifest`);
      }
      await fs.writeFile(path.join(temporary, "index.yaml"), stringify(entry.shared));
      await fs.writeFile(path.join(temporary, "ja.md"), markdownFile(entry.localized, body));
      await fs.writeFile(
        path.join(temporary, "en.md"),
        markdownFile(LOCALIZED_PLACEHOLDERS, Buffer.from("__TODO_EN_BODY__\n")),
      );
      staged.push({ temporary, destination: target });
    }
    for (const item of staged) {
      await fs.rename(item.temporary, item.destination);
      committed.push(item.destination);
    }
    for (const entry of manifest.entries) await fs.unlink(entry.source);
  } catch (error) {
    for (const item of staged) await fs.rm(item.temporary, { recursive: true, force: true });
    for (const destination of committed) await fs.rm(destination, { recursive: true, force: true });
    for (const entry of manifest.entries) {
      await fs.writeFile(entry.source, Buffer.from(entry.originalBase64, "base64"));
    }
    throw error;
  }
}

export function restoreOriginalBytes(manifest: LegacyJournalMigrationManifest): Map<string, Buffer> {
  return new Map(
    manifest.entries.map((entry) => [entry.source, Buffer.from(entry.originalBase64, "base64")]),
  );
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "src/content/journal");
  const manifest = await createLegacyJournalMigrationManifest(root);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const freezeArg = args.find((arg) => arg.startsWith("--freeze="));
  if (freezeArg) {
    const output = path.resolve(freezeArg.slice("--freeze=".length));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, serialized, { flag: "wx" });
  }
  if (args.includes("--write")) await writeLegacyJournalMigration(manifest);
  if (!freezeArg) process.stdout.write(serialized);
}
