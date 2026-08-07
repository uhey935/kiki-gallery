import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const BACKUP_ROOTS = [
  "src/content",
  "public/images",
  ".kiki-editor",
] as const;

const LOCK_PREFIX = ".kiki-editor/asset-lifecycle/repository.lock/";

export type BackupFile = {
  path: string;
  sha256: string;
  byteSize: number;
  mode: number;
  restore: boolean;
};

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  repositoryHead: string | null;
  repositoryBranch: string | null;
  roots: readonly string[];
  files: BackupFile[];
  missingRoots: string[];
  capturedRepositoryLock: boolean;
};

export class BackupRecoveryError extends Error {
  readonly code:
    | "unsafe-path"
    | "unsafe-file"
    | "backup-exists"
    | "backup-corrupt"
    | "active-lock"
    | "restore-conflict";

  constructor(
    code:
      | "unsafe-path"
      | "unsafe-file"
      | "backup-exists"
      | "backup-corrupt"
      | "active-lock"
      | "restore-conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackupRecoveryError";
    this.code = code;
  }
}

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const normalizeRelative = (value: string) => value.split(path.sep).join("/");

const inside = (root: string, relative: string) => {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    throw new BackupRecoveryError("unsafe-path", `Unsafe path: ${relative}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (
    target !== resolvedRoot &&
    !target.startsWith(`${resolvedRoot}${path.sep}`)
  )
    throw new BackupRecoveryError(
      "unsafe-path",
      `Path escaped root: ${relative}`,
    );
  return target;
};

const assertSafeDirectory = async (directory: string, label: string) => {
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new BackupRecoveryError(
      "unsafe-path",
      `${label} must be a regular directory`,
    );
};

const readGitValue = async (repositoryRoot: string, args: string[]) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile)("git", args, { cwd: repositoryRoot })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
};

async function inventory(repositoryRoot: string) {
  const files: Array<{ relative: string; bytes: Buffer; mode: number }> = [];
  const missingRoots: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const absolute = inside(repositoryRoot, relative);
    const stat = await fs.lstat(absolute).catch(() => undefined);
    if (!stat) return;
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
      throw new BackupRecoveryError(
        "unsafe-file",
        `Unsupported entry: ${relative}`,
      );
    if (stat.isFile()) {
      files.push({
        relative: normalizeRelative(relative),
        bytes: await fs.readFile(absolute),
        mode: stat.mode & 0o777,
      });
      return;
    }
    for (const name of (await fs.readdir(absolute)).sort())
      await visit(path.join(relative, name));
  };
  for (const root of BACKUP_ROOTS) {
    if (!(await fs.lstat(inside(repositoryRoot, root)).catch(() => undefined)))
      missingRoots.push(root);
    else await visit(root);
  }
  return { files, missingRoots };
}

export const serializeBackupManifest = (manifest: BackupManifest) =>
  `${JSON.stringify(manifest, null, 2)}\n`;

const backupIdentity = (manifest: Omit<BackupManifest, "backupId">) =>
  sha256(
    JSON.stringify({
      createdAt: manifest.createdAt,
      repositoryHead: manifest.repositoryHead,
      repositoryBranch: manifest.repositoryBranch,
      roots: manifest.roots,
      files: manifest.files,
      missingRoots: manifest.missingRoots,
      capturedRepositoryLock: manifest.capturedRepositoryLock,
    }),
  );

export async function createBackup(input: {
  repositoryRoot: string;
  destination: string;
  createdAt?: string;
}) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const destination = path.resolve(input.destination);
  await assertSafeDirectory(repositoryRoot, "Repository root");
  await assertSafeDirectory(path.dirname(destination), "Backup parent");
  const realRepositoryRoot = await fs.realpath(repositoryRoot);
  const realDestination = path.join(
    await fs.realpath(path.dirname(destination)),
    path.basename(destination),
  );
  if (
    realDestination === realRepositoryRoot ||
    realDestination.startsWith(`${realRepositoryRoot}${path.sep}`)
  )
    throw new BackupRecoveryError(
      "unsafe-path",
      "Backup destination must be outside the repository",
    );
  if (await fs.lstat(destination).catch(() => undefined))
    throw new BackupRecoveryError(
      "backup-exists",
      "Backup destination already exists",
    );
  const { files, missingRoots } = await inventory(repositoryRoot);
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
  const manifestBody: Omit<BackupManifest, "backupId"> = {
    schemaVersion: 1,
    createdAt,
    repositoryHead: await readGitValue(repositoryRoot, ["rev-parse", "HEAD"]),
    repositoryBranch: await readGitValue(repositoryRoot, [
      "branch",
      "--show-current",
    ]),
    roots: [...BACKUP_ROOTS],
    files: files.map(({ relative, bytes, mode }) => ({
      path: relative,
      sha256: sha256(bytes),
      byteSize: bytes.byteLength,
      mode,
      restore: !relative.startsWith(LOCK_PREFIX),
    })),
    missingRoots,
    capturedRepositoryLock: files.some(({ relative }) =>
      relative.startsWith(LOCK_PREFIX),
    ),
  };
  const manifest: BackupManifest = {
    ...manifestBody,
    backupId: backupIdentity(manifestBody),
  };
  const staged = `${destination}.tmp-${randomUUID()}`;
  try {
    await fs.mkdir(path.join(staged, "payload"), {
      recursive: true,
      mode: 0o700,
    });
    for (const file of files) {
      const target = inside(path.join(staged, "payload"), file.relative);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, file.bytes, { mode: file.mode });
    }
    await fs.writeFile(
      path.join(staged, "manifest.json"),
      serializeBackupManifest(manifest),
      { mode: 0o600 },
    );
    await fs.rename(staged, destination);
    return manifest;
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(
  backupRoot: string,
): Promise<BackupManifest> {
  const root = path.resolve(backupRoot);
  await assertSafeDirectory(root, "Backup root");
  const text = await fs
    .readFile(path.join(root, "manifest.json"), "utf8")
    .catch(() => "");
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(text) as BackupManifest;
  } catch {
    throw new BackupRecoveryError(
      "backup-corrupt",
      "Backup manifest is unreadable",
    );
  }
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.backupId) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.roots) ||
    !Array.isArray(manifest.missingRoots) ||
    manifest.roots.join("\0") !== BACKUP_ROOTS.join("\0")
  )
    throw new BackupRecoveryError(
      "backup-corrupt",
      "Backup manifest is invalid",
    );
  const { backupId, ...manifestBody } = manifest;
  if (backupIdentity(manifestBody) !== backupId)
    throw new BackupRecoveryError(
      "backup-corrupt",
      "Backup manifest identity does not match its contents",
    );
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      seen.has(file.path) ||
      file.restore !== !file.path.startsWith(LOCK_PREFIX) ||
      !BACKUP_ROOTS.some(
        (rootPath) =>
          file.path === rootPath || file.path.startsWith(`${rootPath}/`),
      )
    )
      throw new BackupRecoveryError(
        "backup-corrupt",
        `Invalid manifest path: ${file.path}`,
      );
    seen.add(file.path);
    const target = inside(path.join(root, "payload"), file.path);
    const stat = await fs.lstat(target).catch(() => undefined);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new BackupRecoveryError(
        "backup-corrupt",
        `Missing or unsafe payload: ${file.path}`,
      );
    const bytes = await fs.readFile(target);
    if (bytes.byteLength !== file.byteSize || sha256(bytes) !== file.sha256)
      throw new BackupRecoveryError(
        "backup-corrupt",
        `Payload integrity failed: ${file.path}`,
      );
  }
  return manifest;
}

export async function restoreBackup(input: {
  repositoryRoot: string;
  backupRoot: string;
  includeCanonical?: boolean;
}) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  await assertSafeDirectory(repositoryRoot, "Repository root");
  const manifest = await verifyBackup(input.backupRoot);
  const lock = inside(
    repositoryRoot,
    ".kiki-editor/asset-lifecycle/repository.lock",
  );
  if (await fs.lstat(lock).catch(() => undefined))
    throw new BackupRecoveryError(
      "active-lock",
      "Current repository lock requires manual recovery before restore",
    );
  const roots = input.includeCanonical ? [...BACKUP_ROOTS] : [".kiki-editor"];
  const applicable = manifest.files.filter(
    (file) =>
      file.restore &&
      roots.some(
        (root) => file.path === root || file.path.startsWith(`${root}/`),
      ),
  );
  const stagedRoot = inside(
    repositoryRoot,
    `.kiki-editor-restore-${randomUUID()}`,
  );
  const rollbackRoot = inside(
    repositoryRoot,
    `.kiki-editor-rollback-${randomUUID()}`,
  );
  await fs.mkdir(stagedRoot, { mode: 0o700 });
  try {
    for (const file of applicable) {
      const target = inside(stagedRoot, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.copyFile(
        inside(path.join(path.resolve(input.backupRoot), "payload"), file.path),
        target,
      );
      await fs.chmod(target, file.mode);
    }
    await fs.mkdir(rollbackRoot, { mode: 0o700 });
    const moved: string[] = [];
    const installed: string[] = [];
    try {
      for (const root of roots) {
        const current = inside(repositoryRoot, root);
        if (await fs.lstat(current).catch(() => undefined)) {
          const rollback = inside(rollbackRoot, root);
          await fs.mkdir(path.dirname(rollback), { recursive: true });
          await fs.rename(current, rollback);
          moved.push(root);
        }
        const staged = inside(stagedRoot, root);
        if (await fs.lstat(staged).catch(() => undefined)) {
          await fs.mkdir(path.dirname(current), { recursive: true });
          await fs.rename(staged, current);
          installed.push(root);
        }
      }
    } catch (error) {
      for (const root of installed.reverse())
        await fs.rm(inside(repositoryRoot, root), {
          recursive: true,
          force: true,
        });
      for (const root of moved.reverse())
        await fs.rename(
          inside(rollbackRoot, root),
          inside(repositoryRoot, root),
        );
      throw new BackupRecoveryError(
        "restore-conflict",
        "Restore rolled back after a filesystem failure",
        { cause: error },
      );
    }
    await fs.rm(rollbackRoot, { recursive: true, force: true });
    return {
      manifest,
      restoredRoots: roots,
      skippedCapturedLock: manifest.capturedRepositoryLock,
    };
  } finally {
    await fs.rm(stagedRoot, { recursive: true, force: true });
    await fs.rm(rollbackRoot, { recursive: true, force: true });
  }
}
