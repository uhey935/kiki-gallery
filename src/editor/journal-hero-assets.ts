import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isContentId } from "./content-id.ts";
import { inspectWorksImage } from "./works-asset-inspection.ts";
import { WORKS_ASSET_POLICY } from "./works-asset-policy.ts";

export const JOURNAL_HERO_PREFIX = "/images/journal/";
const TOKEN = /^[a-f0-9]{64}$/;
const OWNER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const mimeByFormat = {
  avif: "image/avif",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type JournalHeroAssetDraft =
  | { kind: "existing"; src: string }
  | { kind: "empty"; previousSrc?: string }
  | {
      kind: "temporary";
      token: string;
      workspaceId: string;
      proposedSrc: string;
      sha256: string;
      replaces?: { src: string; sha256: string };
    };

export type JournalHeroAssetMetadata = {
  token: string;
  contentId: string;
  workspaceId: string;
  originalFilename: string;
  proposedSrc: string;
  format: keyof typeof mimeByFormat;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
  replaces?: { src: string; sha256: string };
};

export class JournalHeroAssetError extends Error {
  readonly code:
    | "asset-invalid-request"
    | "asset-too-large"
    | "asset-unsupported-format"
    | "asset-type-mismatch"
    | "asset-decode-failed"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe";

  constructor(message: string, code: JournalHeroAssetError["code"]) {
    super(message);
    this.name = "JournalHeroAssetError";
    this.code = code;
  }
}

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export function inspectJournalHeroCandidate(input: {
  contentId: string;
  declaredMime: string;
  bytes: Uint8Array;
}) {
  if (!isContentId(input.contentId))
    throw new JournalHeroAssetError(
      "Invalid Journal Content ID",
      "asset-invalid-request",
    );
  if (!input.bytes.byteLength)
    throw new JournalHeroAssetError(
      "Image bytes are empty or malformed",
      "asset-decode-failed",
    );
  if (input.bytes.byteLength > WORKS_ASSET_POLICY.maxBytes)
    throw new JournalHeroAssetError(
      "Image exceeds the 20 MiB limit",
      "asset-too-large",
    );
  let media: ReturnType<typeof inspectWorksImage>;
  try {
    media = inspectWorksImage(input.bytes);
  } catch {
    throw new JournalHeroAssetError(
      "Only decodable JPEG, PNG, WebP, or AVIF images are supported",
      "asset-decode-failed",
    );
  }
  if (media.animated || media.frameCount !== 1)
    throw new JournalHeroAssetError(
      "Animated images are not supported",
      "asset-unsupported-format",
    );
  if (
    media.width > WORKS_ASSET_POLICY.maxDimension ||
    media.height > WORKS_ASSET_POLICY.maxDimension ||
    media.width * media.height > WORKS_ASSET_POLICY.maxPixels
  )
    throw new JournalHeroAssetError(
      "Image dimensions exceed the supported limit",
      "asset-too-large",
    );
  if (input.declaredMime !== media.mime)
    throw new JournalHeroAssetError(
      "Declared MIME does not match decoded image bytes",
      "asset-type-mismatch",
    );
  return {
    proposedSrc: `${JOURNAL_HERO_PREFIX}${input.contentId}.${media.format}`,
    sha256: digest(input.bytes),
    byteSize: input.bytes.byteLength,
    media,
  };
}

export class TemporaryJournalHeroAssetStore {
  private readonly records = new Map<
    string,
    { metadata: JournalHeroAssetMetadata; file: string }
  >();
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private constructor(
    root: string,
    ttlMs: number,
    now: () => number,
  ) {
    this.root = root;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  static async create(
    options: {
      parentDirectory?: string;
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {
    const parent = path.resolve(options.parentDirectory ?? os.tmpdir());
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new JournalHeroAssetError(
        "Temporary asset parent is unsafe",
        "asset-temp-unsafe",
      );
    const ttlMs = options.ttlMs ?? 10 * 60_000;
    const now = options.now ?? Date.now;
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      if (
        !entry.name.startsWith("kiki-journal-hero-") ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      )
        continue;
      const stale = path.join(parent, entry.name);
      const staleStat = await fs.lstat(stale).catch(() => undefined);
      if (
        staleStat?.isDirectory() &&
        !staleStat.isSymbolicLink() &&
        staleStat.mtimeMs + ttlMs <= now()
      )
        await fs.rm(stale, { recursive: true, force: true });
    }
    const root = await fs.mkdtemp(path.join(parent, "kiki-journal-hero-"));
    await fs.chmod(root, 0o700);
    return new TemporaryJournalHeroAssetStore(
      await fs.realpath(root),
      ttlMs,
      now,
    );
  }

  async register(input: {
    contentId: string;
    workspaceId: string;
    originalFilename: string;
    declaredMime: string;
    bytes: Uint8Array;
    replaces?: { src: string; sha256: string };
  }) {
    await this.sweepExpired();
    if (!OWNER.test(input.workspaceId))
      throw new JournalHeroAssetError(
        "Invalid workspace",
        "asset-invalid-request",
      );
    const admitted = inspectJournalHeroCandidate(input);
    const token = randomBytes(32).toString("hex");
    const file = path.join(this.root, token);
    const handle = await fs.open(file, "wx", 0o600);
    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const createdAt = this.now();
    const metadata: JournalHeroAssetMetadata = {
      token,
      contentId: input.contentId,
      workspaceId: input.workspaceId,
      originalFilename: path.basename(input.originalFilename),
      proposedSrc: admitted.proposedSrc,
      format: admitted.media.format,
      mime: admitted.media.mime,
      byteSize: admitted.byteSize,
      width: admitted.media.width,
      height: admitted.media.height,
      sha256: admitted.sha256,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      ...(input.replaces ? { replaces: input.replaces } : {}),
    };
    this.records.set(token, { metadata, file });
    const timer = setTimeout(() => void this.expire(token), this.ttlMs);
    timer.unref();
    return structuredClone(metadata);
  }

  private async expire(token: string) {
    const item = this.records.get(token);
    if (!item || item.metadata.expiresAt > this.now()) return;
    this.records.delete(token);
    await fs.rm(item.file, { force: true });
  }

  async sweepExpired() {
    for (const token of [...this.records.keys()]) await this.expire(token);
  }

  private async owned(token: string, contentId: string, workspaceId: string) {
    if (!TOKEN.test(token) || !OWNER.test(contentId) || !OWNER.test(workspaceId))
      throw new JournalHeroAssetError(
        "Temporary image not found",
        "asset-temp-not-found",
      );
    const item = this.records.get(token);
    if (
      !item ||
      item.metadata.contentId !== contentId ||
      item.metadata.workspaceId !== workspaceId
    )
      throw new JournalHeroAssetError(
        "Temporary image not found",
        "asset-temp-not-found",
      );
    if (item.metadata.expiresAt <= this.now()) {
      this.records.delete(token);
      await fs.rm(item.file, { force: true });
      throw new JournalHeroAssetError(
        "Temporary image expired",
        "asset-temp-expired",
      );
    }
    return item;
  }

  async read(token: string, contentId: string, workspaceId: string) {
    const item = await this.owned(token, contentId, workspaceId);
    const stat = await fs.lstat(item.file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new JournalHeroAssetError(
        "Temporary image is unsafe",
        "asset-temp-unsafe",
      );
    const handle = await fs.open(
      item.file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const bytes = await handle.readFile();
      if (
        bytes.byteLength !== item.metadata.byteSize ||
        digest(bytes) !== item.metadata.sha256
      )
        throw new JournalHeroAssetError(
          "Temporary image changed",
          "asset-temp-unsafe",
        );
      return {
        metadata: structuredClone(item.metadata),
        bytes: new Uint8Array(bytes),
      };
    } finally {
      await handle.close();
    }
  }

  async release(token: string, contentId: string, workspaceId: string) {
    const item = await this.owned(token, contentId, workspaceId);
    await fs.rm(item.file, { force: true });
    this.records.delete(token);
  }
}

export const temporaryJournalHeroAssetStore =
  TemporaryJournalHeroAssetStore.create();

export function temporaryJournalHeroPreviewUrl(
  contentId: string,
  workspaceId: string,
  token: string,
) {
  return `/editor/api/journal-hero-preview/${encodeURIComponent(contentId)}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(token)}`;
}
