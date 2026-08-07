import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  admitWorksAssetUpload,
  type WorksAssetAdmissionResult,
  type WorksAssetCandidate,
} from "./works-assets.ts";
import type { WorksAssetInspection } from "./works-asset-inspection.ts";

const TOKEN = /^[a-f0-9]{64}$/;
const OWNER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type TemporaryWorksAssetMetadata = {
  token: string;
  contentId: string;
  workspaceId: string;
  originalFilename: string;
  proposedUrl: string;
  format: WorksAssetInspection["format"];
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  frameCount: number;
  animated: boolean;
  sha256: string;
  createdAt: number;
  expiresAt: number;
};

type Record = { metadata: TemporaryWorksAssetMetadata; file: string };

export class TemporaryWorksAssetStoreError extends Error {
  readonly code:
    | "asset-temp-invalid"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe";

  constructor(message: string, code: TemporaryWorksAssetStoreError["code"]) {
    super(message);
    this.name = "TemporaryWorksAssetStoreError";
    this.code = code;
  }
}

export class TemporaryWorksAssetStore {
  private readonly records = new Map<string, Record>();
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private constructor(root: string, ttlMs: number, now: () => number) {
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
  ): Promise<TemporaryWorksAssetStore> {
    const parent = path.resolve(options.parentDirectory ?? os.tmpdir());
    const parentStat = await fs.lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset parent is unsafe",
        "asset-temp-unsafe",
      );
    const root = await fs.mkdtemp(path.join(parent, "kiki-works-assets-"));
    await fs.chmod(root, 0o700);
    return new TemporaryWorksAssetStore(
      await fs.realpath(root),
      options.ttlMs ?? 10 * 60 * 1000,
      options.now ?? Date.now,
    );
  }

  private async owned(
    token: string,
    contentId: string,
    workspaceId: string,
  ): Promise<Record> {
    if (
      !TOKEN.test(token) ||
      !OWNER.test(contentId) ||
      !OWNER.test(workspaceId)
    )
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset was not found",
        "asset-temp-not-found",
      );
    const record = this.records.get(token);
    if (
      !record ||
      record.metadata.contentId !== contentId ||
      record.metadata.workspaceId !== workspaceId
    )
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset was not found",
        "asset-temp-not-found",
      );
    if (record.metadata.expiresAt <= this.now()) {
      this.records.delete(token);
      await this.removeRegularFile(record.file);
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset has expired",
        "asset-temp-expired",
      );
    }
    return record;
  }

  private async removeRegularFile(file: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return false;
      await fs.unlink(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async register(
    contentId: string,
    workspaceId: string,
    candidate: WorksAssetCandidate,
    admission: WorksAssetAdmissionResult,
  ): Promise<TemporaryWorksAssetMetadata> {
    if (
      !OWNER.test(contentId) ||
      !OWNER.test(workspaceId) ||
      !admission.accepted
    )
      throw new TemporaryWorksAssetStoreError(
        "Only an accepted, owned upload can enter the temporary store",
        "asset-temp-invalid",
      );
    const verified = admitWorksAssetUpload(candidate);
    const actualHash = createHash("sha256")
      .update(candidate.bytes)
      .digest("hex");
    if (
      !verified.accepted ||
      admission.sha256 !== actualHash ||
      admission.byteSize !== candidate.bytes.byteLength ||
      admission.proposedUrl !== verified.proposedUrl ||
      JSON.stringify(admission.media) !== JSON.stringify(verified.media)
    )
      throw new TemporaryWorksAssetStoreError(
        "Admission metadata does not match candidate bytes",
        "asset-temp-invalid",
      );
    await this.sweepExpired();
    const token = randomBytes(32).toString("hex");
    const file = path.join(this.root, token);
    const handle = await fs.open(file, "wx", 0o600);
    try {
      await handle.writeFile(candidate.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const createdAt = this.now();
    const metadata: TemporaryWorksAssetMetadata = {
      token,
      contentId,
      workspaceId,
      originalFilename: candidate.filename,
      proposedUrl: admission.proposedUrl,
      format: admission.media.format,
      mime: admission.media.mime,
      byteSize: admission.byteSize,
      width: admission.media.width,
      height: admission.media.height,
      frameCount: admission.media.frameCount,
      animated: admission.media.animated,
      sha256: admission.sha256,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.records.set(token, { metadata, file });
    return structuredClone(metadata);
  }

  async read(
    token: string,
    contentId: string,
    workspaceId: string,
  ): Promise<{ metadata: TemporaryWorksAssetMetadata; bytes: Uint8Array }> {
    const record = await this.owned(token, contentId, workspaceId);
    const stat = await fs.lstat(record.file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset file is unsafe",
        "asset-temp-unsafe",
      );
    const handle = await fs.open(
      record.file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const bytes = await handle.readFile();
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (
        bytes.byteLength !== record.metadata.byteSize ||
        digest !== record.metadata.sha256
      )
        throw new TemporaryWorksAssetStoreError(
          "Temporary asset bytes changed after registration",
          "asset-temp-unsafe",
        );
      return { metadata: structuredClone(record.metadata), bytes };
    } finally {
      await handle.close();
    }
  }

  async release(
    token: string,
    contentId: string,
    workspaceId: string,
  ): Promise<void> {
    const record = await this.owned(token, contentId, workspaceId);
    if (!(await this.removeRegularFile(record.file)))
      throw new TemporaryWorksAssetStoreError(
        "Temporary asset file is unsafe",
        "asset-temp-unsafe",
      );
    this.records.delete(token);
  }

  async sweepExpired(): Promise<number> {
    const now = this.now();
    let removed = 0;
    for (const [token, record] of this.records) {
      if (record.metadata.expiresAt > now) continue;
      this.records.delete(token);
      if (await this.removeRegularFile(record.file)) removed += 1;
    }
    return removed;
  }
}

export const temporaryWorksAssetStore = TemporaryWorksAssetStore.create();
