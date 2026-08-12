import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { convertLegacyWorkMarkdown } from "./migration-converter.ts";

export const WORK_MIGRATION_INVENTORY = [
  "reiko-kinoshita-01",
  "reiko-kinoshita-02",
  "reiko-kinoshita-03",
  "reiko-kinoshita-04",
  "reiko-kinoshita-05",
  "reiko-kinoshita-06",
  "yuka-mori-01",
] as const;
export const worksSha256 = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
export type AssetEvidence = {
  url: string;
  path: string;
  byteLength: number;
  sha256: string;
  decodedFormat: string;
  references: Array<{ contentId: string; order: number }>;
};
export type WorkMigrationManifest = Awaited<
  ReturnType<typeof createWorkMigrationManifest>
>;
function generated(file: string, content: string) {
  return {
    path: file,
    content,
    byteLength: Buffer.byteLength(content),
    sha256: worksSha256(content),
  };
}
function format(bytes: Buffer, file: string) {
  const magic = bytes.subarray(0, 12).toString("hex");
  if (magic.startsWith("89504e47")) return "png";
  if (magic.startsWith("ffd8ff")) return "jpeg";
  if (magic.startsWith("52494646") && magic.slice(16, 24) === "57454250")
    return "webp";
  if (bytes.subarray(4, 12).toString("ascii").startsWith("ftypavif"))
    return "avif";
  throw new Error(`${file}: unsupported decoded format`);
}
export async function snapshotWorkAssets(
  projectRoot: string,
  references: Array<{ contentId: string; src: string; order: number }>,
): Promise<AssetEvidence[]> {
  const grouped = new Map<
    string,
    Array<{ contentId: string; order: number }>
  >();
  for (const ref of references)
    grouped.set(ref.src, [
      ...(grouped.get(ref.src) ?? []),
      { contentId: ref.contentId, order: ref.order },
    ]);
  const output: AssetEvidence[] = [];
  for (const [url, refs] of [...grouped].sort()) {
    const relative = `public${url}`;
    const file = path.join(projectRoot, relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`${relative}: unsafe asset`);
    const bytes = await fs.readFile(file);
    output.push({
      url,
      path: relative,
      byteLength: bytes.length,
      sha256: worksSha256(bytes),
      decodedFormat: format(bytes, file),
      references: refs,
    });
  }
  return output;
}
export async function createWorkMigrationManifest(
  sourceRoot: string,
  projectRoot = path.resolve(sourceRoot, "../../.."),
) {
  const root = path.resolve(sourceRoot);
  const dirents = await fs.readdir(root, { withFileTypes: true });
  const names = dirents
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
  const expected = WORK_MIGRATION_INVENTORY.map((id) => `${id}.md`);
  if (
    JSON.stringify(names) !== JSON.stringify(expected) ||
    dirents.some((e) => !e.isFile() || e.isSymbolicLink())
  )
    throw new Error(
      `Works inventory mismatch: expected ${expected.join(", ")}; got ${dirents
        .map((e) => e.name)
        .sort()
        .join(", ")}`,
    );
  const evidenceRoot = path
    .relative(process.cwd(), root)
    .split(path.sep)
    .join("/");
  const entries = [];
  const refs: Array<{ contentId: string; src: string; order: number }> = [];
  for (const name of names) {
    const contentId = name.slice(0, -3);
    const bytes = await fs.readFile(path.join(root, name));
    const converted = convertLegacyWorkMarkdown(
      bytes,
      `${evidenceRoot}/${name}`,
    );
    refs.push(
      ...converted.mapping.imageSlots.map((slot) => ({
        contentId,
        src: slot.src,
        order: slot.index,
      })),
    );
    const target = `${evidenceRoot}/${contentId}`;
    entries.push({
      contentId,
      source: {
        path: `${evidenceRoot}/${name}`,
        byteLength: bytes.length,
        sha256: worksSha256(bytes),
        originalBase64: bytes.toString("base64"),
      },
      body: converted.body,
      mapping: converted.mapping,
      targetDirectory: target,
      generated: {
        shared: generated(`${target}/index.yaml`, converted.shared),
        ja: generated(`${target}/ja.md`, converted.ja),
        en: generated(`${target}/en.md`, converted.en),
      },
      rollback: {
        sourcePath: `${evidenceRoot}/${name}`,
        originalBase64: bytes.toString("base64"),
        byteLength: bytes.length,
        sha256: worksSha256(bytes),
      },
    });
  }
  return {
    migrationVersion: 1 as const,
    collection: "works" as const,
    mode: "dry-run" as const,
    sourceRoot: evidenceRoot,
    expectedInventory: WORK_MIGRATION_INVENTORY,
    count: 7 as const,
    entries,
    assetInvariance: {
      policy: "content-only-no-asset-mutation" as const,
      before: await snapshotWorkAssets(projectRoot, refs),
      afterMustEqualBefore: true as const,
      lifecycleEvidenceMutationAllowed: false as const,
    },
  };
}
export const serializeWorkMigrationManifest = (
  manifest: WorkMigrationManifest,
) => `${JSON.stringify(manifest, null, 2)}\n`;
export function restoreLegacyWorkBytes(manifest: WorkMigrationManifest) {
  return new Map(
    manifest.entries.map((e) => {
      const b = Buffer.from(e.rollback.originalBase64, "base64");
      if (
        b.length !== e.rollback.byteLength ||
        worksSha256(b) !== e.rollback.sha256
      )
        throw new Error(`${e.contentId}: corrupt rollback evidence`);
      return [e.rollback.sourcePath, b];
    }),
  );
}
