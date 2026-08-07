import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import {
  inspectWorksImage,
  type WorksAssetInspection,
} from "./works-asset-inspection.ts";
import {
  WORKS_ASSET_BASENAME,
  WORKS_ASSET_MIME,
  WORKS_ASSET_POLICY,
  type WorksAssetFormat,
} from "./works-asset-policy.ts";

export type WorksAssetReference = { contentId: string; imageIndex: number };
export type WorksAssetInventoryItem = WorksAssetInspection & {
  filename: string;
  path: string;
  publicUrl: string;
  extension: string;
  byteSize: number;
  sha256: string;
  extensionMatchesFormat: boolean;
  warnings: ("extension-content-mismatch" | "noncanonical-filename")[];
  references: WorksAssetReference[];
  referenceCount: number;
  referencedByWorks: string[];
  orphan: boolean | "unknown";
};
export type WorksAssetAuditEntry = {
  name: string;
  code:
    | "asset-unsafe-path"
    | "asset-decode-failed"
    | "asset-reference-invalid"
    | "asset-reference-missing";
};
export type WorksAssetInventory = {
  assets: WorksAssetInventoryItem[];
  audit: WorksAssetAuditEntry[];
  referenceGraphComplete: boolean;
};

export type WorksAssetFailureCode =
  | "asset-unsafe-path"
  | "asset-too-large"
  | "asset-unsupported-format"
  | "asset-type-mismatch"
  | "asset-decode-failed"
  | "asset-duplicate"
  | "asset-name-conflict";

export type WorksAssetAdmissionResult =
  | {
      accepted: true;
      proposedUrl: string;
      sha256: string;
      byteSize: number;
      media: WorksAssetInspection;
    }
  | {
      accepted: false;
      code: WorksAssetFailureCode;
      reason: string;
      existingUrls?: string[];
    };

export type WorksAssetCandidate = {
  filename: string;
  declaredMime: string;
  bytes: Uint8Array;
};
export type ExistingWorksAsset = { filename: string; sha256: string };

const canonicalAssetRoot = path.resolve("public/images/works");
const canonicalWorksRoot = path.resolve("src/content/works");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const extensionFor = (filename: string) =>
  path.extname(filename).slice(1).toLowerCase();
const canonicalExtension = (format: WorksAssetFormat) => format;

function safeBasename(filename: string): boolean {
  return (
    filename.length <= WORKS_ASSET_POLICY.maxBasenameLength &&
    WORKS_ASSET_BASENAME.test(filename) &&
    path.basename(filename) === filename &&
    !/[\\/%\0\u0000-\u001f\u007f\u2215\u2044\uff0f]/u.test(filename)
  );
}

function reject(
  code: WorksAssetFailureCode,
  reason: string,
  existingUrls?: string[],
): WorksAssetAdmissionResult {
  return {
    accepted: false,
    code,
    reason,
    ...(existingUrls ? { existingUrls } : {}),
  };
}

export function admitWorksAssetUpload(
  candidate: WorksAssetCandidate,
  existing: readonly ExistingWorksAsset[] = [],
): WorksAssetAdmissionResult {
  if (!safeBasename(candidate.filename))
    return reject(
      "asset-unsafe-path",
      "Filename is outside the canonical Works asset naming policy.",
    );
  if (candidate.bytes.byteLength === 0)
    return reject("asset-decode-failed", "Image bytes are empty or malformed.");
  if (candidate.bytes.byteLength > WORKS_ASSET_POLICY.maxBytes)
    return reject("asset-too-large", "Encoded image exceeds the 20 MiB limit.");

  const signature = Buffer.from(candidate.bytes.subarray(0, 12)).toString(
    "latin1",
  );
  if (
    signature.startsWith("GIF8") ||
    signature.startsWith("BM") ||
    signature.startsWith("II*") ||
    signature.startsWith("MM\0*") ||
    /^\s*<svg/i.test(signature)
  )
    return reject(
      "asset-unsupported-format",
      "Decoded format is outside the permitted JPEG, PNG, WebP, and AVIF set.",
    );

  let media: WorksAssetInspection;
  try {
    media = inspectWorksImage(candidate.bytes);
  } catch {
    return reject(
      "asset-decode-failed",
      "Image is unsupported, malformed, or truncated.",
    );
  }
  if (
    !Object.hasOwn(WORKS_ASSET_MIME, media.format) ||
    media.animated ||
    media.frameCount !== 1
  )
    return reject(
      "asset-unsupported-format",
      "Only single-frame JPEG, PNG, WebP, and AVIF are permitted.",
    );
  if (
    media.width < 1 ||
    media.height < 1 ||
    media.width > WORKS_ASSET_POLICY.maxDimension ||
    media.height > WORKS_ASSET_POLICY.maxDimension ||
    media.width * media.height > WORKS_ASSET_POLICY.maxPixels
  )
    return reject(
      "asset-too-large",
      "Image dimensions exceed the 12,000 px or 40 MP limit.",
    );
  if (
    candidate.declaredMime !== media.mime ||
    extensionFor(candidate.filename) !== canonicalExtension(media.format)
  )
    return reject(
      "asset-type-mismatch",
      "Declared MIME, decoded format, and canonical extension must agree.",
    );

  const hash = sha256(candidate.bytes);
  const duplicateUrls = existing
    .filter((asset) => asset.sha256 === hash)
    .map((asset) => `${WORKS_ASSET_POLICY.publicPrefix}${asset.filename}`);
  if (duplicateUrls.length)
    return reject(
      "asset-duplicate",
      "Identical bytes already exist in the canonical asset root.",
      duplicateUrls,
    );
  if (
    existing.some(
      (asset) =>
        asset.filename.toLocaleLowerCase("en-US") ===
        candidate.filename.toLocaleLowerCase("en-US"),
    )
  )
    return reject(
      "asset-name-conflict",
      "The proposed canonical filename already exists.",
    );
  return {
    accepted: true,
    proposedUrl: `${WORKS_ASSET_POLICY.publicPrefix}${candidate.filename}`,
    sha256: hash,
    byteSize: candidate.bytes.byteLength,
    media,
  };
}

function parseReferences(
  contentId: string,
  raw: string,
): { urls: string[]; references: WorksAssetReference[] } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) throw new Error("Invalid frontmatter");
  const data = parse(match[1]) as { images?: unknown };
  if (!Array.isArray(data?.images)) throw new Error("Invalid images");
  const urls = data.images.map((image) => {
    if (
      !image ||
      typeof image !== "object" ||
      typeof (image as { src?: unknown }).src !== "string"
    )
      throw new Error("Invalid image src");
    return (image as { src: string }).src;
  });
  const references = urls.map((_, imageIndex) => ({
    contentId,
    imageIndex,
  }));
  return { urls, references };
}

export async function readWorksAssetInventory(
  assetRoot = canonicalAssetRoot,
  worksRoot = canonicalWorksRoot,
): Promise<WorksAssetInventory> {
  const audit: WorksAssetAuditEntry[] = [];
  const rootStat = await fs.lstat(assetRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("asset-unsafe-path");
  const resolvedRoot = await fs.realpath(assetRoot);

  const worksRootStat = await fs.lstat(worksRoot);
  if (!worksRootStat.isDirectory() || worksRootStat.isSymbolicLink())
    throw new Error("asset-unsafe-path");

  const graph = new Map<string, WorksAssetReference[]>();
  let referenceGraphComplete = true;
  const workNames = (await fs.readdir(worksRoot))
    .filter((name) => name.endsWith(".md"))
    .sort();
  for (const name of workNames) {
    const file = path.join(worksRoot, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      referenceGraphComplete = false;
      audit.push({ name, code: "asset-reference-invalid" });
      continue;
    }
    try {
      const parsed = parseReferences(
        name.slice(0, -3),
        await fs.readFile(file, "utf8"),
      );
      parsed.urls.forEach((url, index) => {
        if (
          !url.startsWith(WORKS_ASSET_POLICY.publicPrefix) ||
          url.slice(WORKS_ASSET_POLICY.publicPrefix.length).includes("/")
        ) {
          referenceGraphComplete = false;
          audit.push({ name: url, code: "asset-reference-invalid" });
          return;
        }
        const list = graph.get(url) ?? [];
        list.push(parsed.references[index]);
        graph.set(url, list);
      });
    } catch {
      referenceGraphComplete = false;
      audit.push({ name, code: "asset-reference-invalid" });
    }
  }

  const assets: WorksAssetInventoryItem[] = [];
  for (const name of (await fs.readdir(resolvedRoot)).sort()) {
    const file = path.join(resolvedRoot, name);
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      path.dirname(file) !== resolvedRoot
    ) {
      audit.push({ name, code: "asset-unsafe-path" });
      continue;
    }
    const bytes = await fs.readFile(file);
    try {
      const media = inspectWorksImage(bytes);
      const extension = extensionFor(name);
      const extensionMatchesFormat =
        extension === canonicalExtension(media.format);
      const warnings: WorksAssetInventoryItem["warnings"] = [];
      if (!extensionMatchesFormat) warnings.push("extension-content-mismatch");
      if (!safeBasename(name)) warnings.push("noncanonical-filename");
      const publicUrl = `${WORKS_ASSET_POLICY.publicPrefix}${name}`;
      const references = graph.get(publicUrl) ?? [];
      assets.push({
        ...media,
        filename: name,
        path: file,
        publicUrl,
        extension,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
        extensionMatchesFormat,
        warnings,
        references,
        referenceCount: references.length,
        referencedByWorks: [
          ...new Set(references.map(({ contentId }) => contentId)),
        ],
        orphan: referenceGraphComplete ? references.length === 0 : "unknown",
      });
    } catch {
      audit.push({ name, code: "asset-decode-failed" });
    }
  }
  const availableUrls = new Set(assets.map(({ publicUrl }) => publicUrl));
  for (const url of [...graph.keys()].sort()) {
    if (!availableUrls.has(url)) {
      referenceGraphComplete = false;
      audit.push({ name: url, code: "asset-reference-missing" });
    }
  }
  if (!referenceGraphComplete) {
    for (const asset of assets) asset.orphan = "unknown";
  }
  return { assets, audit, referenceGraphComplete };
}
