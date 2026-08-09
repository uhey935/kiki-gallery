import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  acquireWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
  type RepositoryLock as AssetRepositoryLock,
} from "./works-asset-repository-lock.ts";

const RELATIVE_LOCK = ".kiki-editor/content-lifecycle/repository.lock";

export type ContentWriter =
  "save" | "create" | "rename" | "publish" | "delete" | "restore";

export type ContentLifecycleLock = {
  schemaVersion: 1;
  identity: string;
  writer: ContentWriter;
  operationId: string;
  ownerPid: number;
  acquiredAt: string;
  expiresAt: string;
};

export class ContentLifecycleLockError extends Error {
  readonly code:
    "lock-conflict" | "stale-lock" | "lock-ownership" | "unsafe-path";
  constructor(
    code: ContentLifecycleLockError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContentLifecycleLockError";
    this.code = code;
  }
}

const lockPath = (repositoryRoot: string) => {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, RELATIVE_LOCK);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new ContentLifecycleLockError(
      "unsafe-path",
      "Content lock escaped repository",
    );
  return target;
};

const readOwner = async (repositoryRoot: string) =>
  fs
    .readFile(path.join(lockPath(repositoryRoot), "owner.json"), "utf8")
    .then((value) => JSON.parse(value) as ContentLifecycleLock)
    .catch(() => null);

export async function acquireContentLifecycleLock(input: {
  repositoryRoot: string;
  writer: ContentWriter;
  operationId?: string;
  now?: string;
  ttlMs?: number;
}) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const rootStat = await fs.lstat(repositoryRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new ContentLifecycleLockError(
      "unsafe-path",
      "Unsafe repository root",
    );
  const acquiredAt = new Date(input.now ?? Date.now()).toISOString();
  const owner: ContentLifecycleLock = {
    schemaVersion: 1,
    identity: randomUUID(),
    writer: input.writer,
    operationId: input.operationId ?? randomUUID(),
    ownerPid: process.pid,
    acquiredAt,
    expiresAt: new Date(
      Date.parse(acquiredAt) + (input.ttlMs ?? 300_000),
    ).toISOString(),
  };
  const lock = lockPath(repositoryRoot);
  await fs.mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  try {
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      `${JSON.stringify(owner, null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    return owner;
  } catch (error) {
    const existing = await readOwner(repositoryRoot);
    const stale =
      existing && Date.parse(existing.expiresAt) <= Date.parse(acquiredAt);
    throw new ContentLifecycleLockError(
      stale ? "stale-lock" : "lock-conflict",
      "Content lifecycle lock requires reconciliation; it is never stolen automatically",
      { cause: error },
    );
  }
}

export async function assertContentLifecycleLock(
  repositoryRoot: string,
  identity: string,
) {
  const owner = await readOwner(repositoryRoot);
  if (!owner || owner.identity !== identity)
    throw new ContentLifecycleLockError(
      "lock-ownership",
      "Content lifecycle lock ownership was lost",
    );
  return owner;
}

export async function releaseContentLifecycleLock(
  repositoryRoot: string,
  identity: string,
) {
  await assertContentLifecycleLock(repositoryRoot, identity);
  await fs.rm(lockPath(repositoryRoot), { recursive: true });
}

export async function withContentLifecycleLock<T>(input: {
  repositoryRoot?: string;
  writer: Exclude<ContentWriter, "delete">;
  operationId?: string;
  action: () => Promise<T>;
}): Promise<T> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  const lock = await acquireContentLifecycleLock({
    repositoryRoot,
    writer: input.writer,
    operationId: input.operationId,
  });
  try {
    await assertContentLifecycleLock(repositoryRoot, lock.identity);
    return await input.action();
  } finally {
    await releaseContentLifecycleLock(repositoryRoot, lock.identity);
  }
}

export async function acquireWorksDeleteLocks(input: {
  repositoryRoot: string;
  operationId: string;
  now?: string;
}) {
  const now = new Date(input.now ?? Date.now()).toISOString();
  const content = await acquireContentLifecycleLock({
    repositoryRoot: input.repositoryRoot,
    writer: "delete",
    operationId: input.operationId,
    now,
  });
  let asset: AssetRepositoryLock;
  try {
    asset = await acquireWorksAssetRepositoryLock(input.repositoryRoot, now);
  } catch (error) {
    await releaseContentLifecycleLock(input.repositoryRoot, content.identity);
    throw error;
  }
  return {
    content,
    asset,
    release: async () => {
      await releaseWorksAssetRepositoryLock(
        input.repositoryRoot,
        asset.identity,
      );
      await releaseContentLifecycleLock(input.repositoryRoot, content.identity);
    },
  };
}
