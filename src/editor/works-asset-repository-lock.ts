import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const STATE = path.join(".kiki-editor", "asset-lifecycle");
const LOCK = path.join(STATE, "repository.lock");

export class WorksAssetRepositoryLockError extends Error {
  readonly code:
    "lock-conflict" | "stale-lock" | "lock-ownership" | "unsafe-path";
  constructor(
    code: WorksAssetRepositoryLockError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksAssetRepositoryLockError";
    this.code = code;
  }
}

export type RepositoryLock = {
  schemaVersion: 1;
  identity: string;
  ownerPid: number;
  acquiredAt: string;
  expiresAt: string;
};

const resolvedInside = (root: string, relative: string) => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new WorksAssetRepositoryLockError(
      "unsafe-path",
      "Path escaped repository",
    );
  return target;
};

const ensureRegularParents = async (
  root: string,
  relative: string,
  create = false,
) => {
  let current = path.resolve(root);
  const rootStat = await fs.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new WorksAssetRepositoryLockError(
      "unsafe-path",
      "Unsafe repository root",
    );
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat = await fs.lstat(current).catch(() => undefined);
    if (!stat && create) {
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink())
      throw new WorksAssetRepositoryLockError(
        "unsafe-path",
        "Unsafe lifecycle directory",
      );
  }
};

export async function acquireWorksAssetRepositoryLock(
  repositoryRoot: string,
  now: string,
  ttlMs = 300_000,
): Promise<RepositoryLock> {
  await ensureRegularParents(repositoryRoot, STATE, true);
  const lockDir = resolvedInside(repositoryRoot, LOCK);
  const acquiredAt = new Date(Date.parse(now)).toISOString();
  const lock: RepositoryLock = {
    schemaVersion: 1,
    identity: randomUUID(),
    ownerPid: process.pid,
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + ttlMs).toISOString(),
  };
  try {
    await fs.mkdir(lockDir);
    await fs.writeFile(
      path.join(lockDir, "owner.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return lock;
  } catch (error) {
    const owner = (await fs
      .readFile(path.join(lockDir, "owner.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null)) as RepositoryLock | null;
    const code =
      owner && Date.parse(owner.expiresAt) <= Date.parse(acquiredAt)
        ? "stale-lock"
        : "lock-conflict";
    throw new WorksAssetRepositoryLockError(
      code,
      "Repository lifecycle lock requires manual recovery",
      { cause: error },
    );
  }
}

export async function assertWorksAssetRepositoryLock(
  repositoryRoot: string,
  identity: string,
) {
  const owner = (await fs
    .readFile(
      path.join(resolvedInside(repositoryRoot, LOCK), "owner.json"),
      "utf8",
    )
    .then(JSON.parse)
    .catch(() => null)) as RepositoryLock | null;
  if (!owner || owner.identity !== identity)
    throw new WorksAssetRepositoryLockError(
      "lock-ownership",
      "Repository lock is not owned by this operation",
    );
}

export async function releaseWorksAssetRepositoryLock(
  repositoryRoot: string,
  identity: string,
) {
  await assertWorksAssetRepositoryLock(repositoryRoot, identity);
  await fs.rm(resolvedInside(repositoryRoot, LOCK), { recursive: true });
}
