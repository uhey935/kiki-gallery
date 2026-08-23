import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const COLLECTION = /^[a-z][a-z0-9-]*$/;
const mimeByFormat = {
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type HeroAssetPublishEvidenceV1 = {
  version: 1;
  state: "pending" | "committed-push-failed";
  operation: "hero-asset-save" | "hero-asset-create";
  collection: string;
  contentId: string;
  content: Array<{ path: string; sha256: string; byteSize: number }>;
  assets: Array<{
    src: string;
    path: string;
    sha256: string;
    byteSize: number;
    format: keyof typeof mimeByFormat;
    mime: (typeof mimeByFormat)[keyof typeof mimeByFormat];
    width: number;
    height: number;
  }>;
  createdAt: string;
  commit?: string;
};

export class HeroAssetPublishEvidenceError extends Error {
  readonly code:
    | "publish-evidence-invalid"
    | "publish-evidence-corrupt"
    | "publish-evidence-unsafe";
  constructor(
    message: string,
    code: HeroAssetPublishEvidenceError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HeroAssetPublishEvidenceError";
    this.code = code;
  }
}

export const heroPublishSha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeRepositoryPath = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.split(path.sep).join("/") &&
  !path.posix.isAbsolute(value) &&
  path.posix.normalize(value) === value &&
  !value.startsWith("../");
const positiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0;
const nonnegativeInteger = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function parseHeroAssetPublishEvidence(
  value: unknown,
): HeroAssetPublishEvidenceV1 {
  if (!record(value))
    throw new HeroAssetPublishEvidenceError(
      "Hero asset Publish evidence is not an object",
      "publish-evidence-corrupt",
    );
  const allowed = [
    "version",
    "state",
    "operation",
    "collection",
    "contentId",
    "content",
    "assets",
    "createdAt",
    ...(value.state === "committed-push-failed" ? ["commit"] : []),
  ];
  if (
    !exactKeys(value, allowed) ||
    value.version !== 1 ||
    !["pending", "committed-push-failed"].includes(String(value.state)) ||
    !["hero-asset-save", "hero-asset-create"].includes(
      String(value.operation),
    ) ||
    typeof value.collection !== "string" ||
    !COLLECTION.test(value.collection) ||
    typeof value.contentId !== "string" ||
    !isContentId(value.contentId) ||
    !Array.isArray(value.content) ||
    value.content.length === 0 ||
    !Array.isArray(value.assets) ||
    value.assets.length === 0 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.state === "pending" && "commit" in value) ||
    (value.state === "committed-push-failed" &&
      (typeof value.commit !== "string" || !GIT_COMMIT.test(value.commit)))
  )
    throw new HeroAssetPublishEvidenceError(
      "Hero asset Publish evidence schema is invalid",
      "publish-evidence-corrupt",
    );
  const content = value.content.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, ["path", "sha256", "byteSize"]) ||
      !safeRepositoryPath(item.path) ||
      typeof item.sha256 !== "string" ||
      !SHA256.test(item.sha256) ||
      !nonnegativeInteger(item.byteSize)
    )
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish content evidence is invalid",
        "publish-evidence-corrupt",
      );
    return item as HeroAssetPublishEvidenceV1["content"][number];
  });
  const assets = value.assets.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, [
        "src",
        "path",
        "sha256",
        "byteSize",
        "format",
        "mime",
        "width",
        "height",
      ]) ||
      typeof item.src !== "string" ||
      !item.src.startsWith("/") ||
      !safeRepositoryPath(item.path) ||
      typeof item.sha256 !== "string" ||
      !SHA256.test(item.sha256) ||
      !nonnegativeInteger(item.byteSize) ||
      typeof item.format !== "string" ||
      !(item.format in mimeByFormat) ||
      mimeByFormat[item.format as keyof typeof mimeByFormat] !== item.mime ||
      !positiveInteger(item.width) ||
      !positiveInteger(item.height)
    )
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish asset evidence is invalid",
        "publish-evidence-corrupt",
      );
    return item as HeroAssetPublishEvidenceV1["assets"][number];
  });
  if (
    new Set(content.map((item) => item.path)).size !== content.length ||
    new Set(assets.map((item) => item.path)).size !== assets.length
  )
    throw new HeroAssetPublishEvidenceError(
      "Hero asset Publish evidence contains duplicate paths",
      "publish-evidence-corrupt",
    );
  return structuredClone({
    ...value,
    content,
    assets,
  } as HeroAssetPublishEvidenceV1);
}

async function safeDirectory(directory: string, create: boolean) {
  let stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat && create) {
    await fs.mkdir(directory, { mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new HeroAssetPublishEvidenceError(
      "Hero asset Publish evidence directory is unsafe",
      "publish-evidence-unsafe",
    );
  return true;
}

export class HeroAssetPublishEvidenceStore {
  readonly repositoryRoot: string;
  constructor(repositoryRoot = path.resolve(".")) {
    this.repositoryRoot = path.resolve(repositoryRoot);
  }

  private async location(
    collection: string,
    contentId: string,
    create: boolean,
  ) {
    if (!COLLECTION.test(collection) || !isContentId(contentId))
      throw new HeroAssetPublishEvidenceError(
        "Invalid Hero asset Publish evidence owner",
        "publish-evidence-invalid",
      );
    if (!(await safeDirectory(this.repositoryRoot, false)))
      throw new HeroAssetPublishEvidenceError(
        "Repository root is unavailable",
        "publish-evidence-unsafe",
      );
    const parts = [
      ".kiki-editor",
      "publish-evidence",
      "hero-assets",
      collection,
    ];
    let parent = this.repositoryRoot;
    for (const part of parts) {
      parent = path.join(parent, part);
      if (!(await safeDirectory(parent, create))) return null;
    }
    const file = path.join(parent, `${contentId}.v1.json`);
    if (path.dirname(file) !== parent)
      throw new HeroAssetPublishEvidenceError(
        "Unsafe Hero asset Publish evidence path",
        "publish-evidence-unsafe",
      );
    return file;
  }

  async read(collection: string, contentId: string) {
    const file = await this.location(collection, contentId, false);
    if (!file) return undefined;
    const stat = await fs.lstat(file).catch(() => undefined);
    if (!stat) return undefined;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish evidence file is unsafe",
        "publish-evidence-unsafe",
      );
    try {
      return parseHeroAssetPublishEvidence(
        JSON.parse(await fs.readFile(file, "utf8")),
      );
    } catch (error) {
      if (error instanceof HeroAssetPublishEvidenceError) throw error;
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish evidence is unreadable",
        "publish-evidence-corrupt",
        { cause: error },
      );
    }
  }

  async write(evidence: HeroAssetPublishEvidenceV1) {
    const parsed = parseHeroAssetPublishEvidence(evidence);
    const file = await this.location(parsed.collection, parsed.contentId, true);
    if (!file)
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish evidence directory is unavailable",
        "publish-evidence-unsafe",
      );
    const existing = await fs.lstat(file).catch(() => undefined);
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish evidence file is unsafe",
        "publish-evidence-unsafe",
      );
    const temporary = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.tmp`,
    );
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, file);
      const directory = await fs.open(path.dirname(file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return parsed;
  }

  async delete(collection: string, contentId: string) {
    const file = await this.location(collection, contentId, false);
    if (!file) return;
    const stat = await fs.lstat(file).catch(() => undefined);
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new HeroAssetPublishEvidenceError(
        "Hero asset Publish evidence file is unsafe",
        "publish-evidence-unsafe",
      );
    await fs.rm(file);
  }
}
