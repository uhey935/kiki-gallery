import { promises as fs } from "node:fs";
import path from "node:path";

import { isContentId } from "./content-id.ts";

const canonicalFiles = new Set(["index.yaml", "ja.md", "en.md"]);
const transactionPattern =
  /^(\.journal-(?:hero-)?save-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))-(stage|backup)$/i;

export type JournalManualRecoveryState = {
  contentId: string;
  transaction: string;
  recoveryReference: string;
  evidenceIntegrity: "complete" | "incomplete-or-unsafe";
};

export type JournalManualRecoveryStatus =
  | { state: "normal" }
  | {
      state: "manual-recovery-required";
      recoveryReference: string;
    };

export class JournalManualRecoveryError extends Error {
  readonly code = "journal-manual-recovery-required";
  readonly recoveryReference: string;

  constructor(state: JournalManualRecoveryState) {
    super(
      `Journal mutation blocked; manual recovery is required for ${state.recoveryReference}`,
    );
    this.name = "JournalManualRecoveryError";
    this.recoveryReference = state.recoveryReference;
  }
}

async function isSafeTransactionDirectory(target: string) {
  const stat = await fs.lstat(target).catch(() => undefined);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}

async function hasCompleteBackup(target: string) {
  const entries = await fs.readdir(target, { withFileTypes: true });
  if (
    entries.length !== canonicalFiles.size ||
    entries.some(
      (entry) =>
        !canonicalFiles.has(entry.name) ||
        !entry.isFile() ||
        entry.isSymbolicLink(),
    )
  )
    return false;
  return true;
}

async function hasSafeStage(target: string) {
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.every(
    (entry) =>
      canonicalFiles.has(entry.name) &&
      entry.isFile() &&
      !entry.isSymbolicLink(),
  );
}

export async function detectJournalManualRecovery(
  contentId: string,
  journalRoot = path.resolve("src/content/journal"),
): Promise<JournalManualRecoveryState | null> {
  if (!isContentId(contentId)) return null;
  const root = path.resolve(journalRoot);
  const directory = path.resolve(root, contentId);
  if (path.dirname(directory) !== root) return null;
  const directoryStat = await fs.lstat(directory).catch(() => undefined);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink())
    return null;

  const transactions = new Map<
    string,
    { identity: string; stage?: string; backup?: string }
  >();
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const match = transactionPattern.exec(entry.name);
    if (!match) continue;
    const [, prefix, identity, kind] = match;
    const transaction = transactions.get(prefix) ?? { identity };
    transaction[kind as "stage" | "backup"] = entry.name;
    transactions.set(prefix, transaction);
  }

  for (const [prefix, transaction] of [...transactions].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!transaction.stage || !transaction.backup) continue;
    const stage = path.join(directory, transaction.stage);
    const backup = path.join(directory, transaction.backup);
    const evidenceIntegrity =
      (await isSafeTransactionDirectory(stage)) &&
      (await isSafeTransactionDirectory(backup)) &&
      (await hasSafeStage(stage).catch(() => false)) &&
      (await hasCompleteBackup(backup).catch(() => false))
        ? "complete"
        : "incomplete-or-unsafe";
    return {
      contentId,
      transaction: transaction.identity,
      recoveryReference: path.posix.join(
        "src/content/journal",
        contentId,
        prefix,
      ),
      evidenceIntegrity,
    };
  }
  return null;
}

export async function assertJournalMutationAdmitted(
  contentId: string,
  journalRoot = path.resolve("src/content/journal"),
) {
  const state = await detectJournalManualRecovery(contentId, journalRoot);
  if (state) throw new JournalManualRecoveryError(state);
}

export async function readJournalManualRecoveryStatus(
  contentId: string,
  journalRoot = path.resolve("src/content/journal"),
): Promise<JournalManualRecoveryStatus> {
  const state = await detectJournalManualRecovery(contentId, journalRoot);
  return state
    ? {
        state: "manual-recovery-required",
        recoveryReference: state.recoveryReference,
      }
    : { state: "normal" };
}

export function journalManualRecoveryResponse(
  error: JournalManualRecoveryError,
) {
  return Response.json(
    {
      error: error.message,
      code: error.code,
      recoveryReference: error.recoveryReference,
    },
    { status: 409 },
  );
}
