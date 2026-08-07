import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  hashWorksAssetCandidateLedger,
  parseWorksAssetCandidateLedger,
  serializeWorksAssetCandidateLedger,
  type WorksAssetCandidateLedger,
} from "./works-asset-candidate-ledger.ts";

export const WORKS_ASSET_LEDGER_RELATIVE_PATH = path.join(
  ".kiki-editor",
  "asset-lifecycle",
  "works-candidate-ledger.v1.json",
);

export type WorksAssetLedgerLoadResult =
  | { status: "missing"; ledger: null; ledgerSha256: null }
  | {
      status: "loaded";
      ledger: WorksAssetCandidateLedger;
      ledgerSha256: string;
    }
  | { status: "corrupt"; ledger: null; ledgerSha256: null };

export class WorksAssetLedgerStoreError extends Error {
  readonly code:
    | "ledger-conflict"
    | "ledger-unsafe-path"
    | "ledger-write-failed";

  constructor(
    code: WorksAssetLedgerStoreError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksAssetLedgerStoreError";
    this.code = code;
  }
}

const ledgerPath = (repositoryRoot: string) =>
  path.resolve(repositoryRoot, WORKS_ASSET_LEDGER_RELATIVE_PATH);

async function ensureSafeLedgerDirectory(
  repositoryRoot: string,
  create: boolean,
): Promise<"ready" | "missing"> {
  const root = path.resolve(repositoryRoot);
  const rootStat = await fs.lstat(root).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new WorksAssetLedgerStoreError(
      "ledger-unsafe-path",
      "Repository root is not a safe regular directory",
    );
  let current = root;
  for (const segment of [".kiki-editor", "asset-lifecycle"]) {
    current = path.join(current, segment);
    let stat = await fs.lstat(current).catch(() => undefined);
    if (!stat && !create) return "missing";
    if (!stat && create) {
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink())
      throw new WorksAssetLedgerStoreError(
        "ledger-unsafe-path",
        "Ledger path contains an unsafe directory",
      );
  }
  return "ready";
}

export async function loadWorksAssetCandidateLedger(
  repositoryRoot = path.resolve("."),
): Promise<WorksAssetLedgerLoadResult> {
  try {
    if ((await ensureSafeLedgerDirectory(repositoryRoot, false)) === "missing")
      return { status: "missing", ledger: null, ledgerSha256: null };
  } catch (error) {
    if (
      error instanceof WorksAssetLedgerStoreError &&
      error.code === "ledger-unsafe-path"
    )
      return { status: "corrupt", ledger: null, ledgerSha256: null };
    throw error;
  }
  const target = ledgerPath(repositoryRoot);
  const stat = await fs.lstat(target).catch(() => undefined);
  if (!stat) return { status: "missing", ledger: null, ledgerSha256: null };
  if (!stat.isFile() || stat.isSymbolicLink())
    return { status: "corrupt", ledger: null, ledgerSha256: null };
  const parsed = parseWorksAssetCandidateLedger(
    await fs.readFile(target, "utf8"),
  );
  if (!parsed.ok)
    return { status: "corrupt", ledger: null, ledgerSha256: null };
  return {
    status: "loaded",
    ledger: parsed.ledger,
    ledgerSha256: hashWorksAssetCandidateLedger(parsed.ledger),
  };
}

/** Atomically persists Editor-only evidence with optimistic concurrency. */
export async function saveWorksAssetCandidateLedger(
  ledger: WorksAssetCandidateLedger,
  expectedLedgerSha256: string | null,
  repositoryRoot = path.resolve("."),
): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const target = ledgerPath(root);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new WorksAssetLedgerStoreError(
      "ledger-unsafe-path",
      "Ledger path escaped the repository root",
    );
  const directory = path.dirname(target);
  const staged = path.join(directory, `.works-ledger-${randomUUID()}.tmp`);
  try {
    await ensureSafeLedgerDirectory(root, true);
    const current = await loadWorksAssetCandidateLedger(root);
    if (
      current.status === "corrupt" ||
      (current.status === "missing" && expectedLedgerSha256 !== null) ||
      (current.status === "loaded" &&
        current.ledgerSha256 !== expectedLedgerSha256)
    )
      throw new WorksAssetLedgerStoreError(
        "ledger-conflict",
        "Ledger changed or is corrupt; manual recovery is required",
      );
    await fs.writeFile(staged, serializeWorksAssetCandidateLedger(ledger), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(staged, target);
    return hashWorksAssetCandidateLedger(ledger);
  } catch (error) {
    if (error instanceof WorksAssetLedgerStoreError) throw error;
    throw new WorksAssetLedgerStoreError(
      "ledger-write-failed",
      "Failed to persist the Works asset candidate ledger",
      { cause: error },
    );
  } finally {
    await fs.rm(staged, { force: true }).catch(() => undefined);
  }
}
