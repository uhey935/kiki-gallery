import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { loadJournalUnit } from "../content-loaders/journal/repository.ts";
import { isContentId } from "./content-id.ts";
import { createJournalEditorDraft } from "./journal-draft-state.ts";
import { assertJournalMutationAdmitted } from "./journal-manual-recovery.ts";
import { readJournalEditorEntry } from "./journal-state.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";

const execFile = promisify(execFileCallback);
const fileNames = ["index.yaml", "ja.md", "en.md"] as const;

export type JournalRenamePlan = {
  schemaVersion: 1;
  operation: "journal-rename";
  operationId: string;
  sourceContentId: string;
  destinationContentId: string;
  oldRoutes: string[];
  newRoutes: string[];
  repositoryHead: string;
  repositoryBranch: string;
  sourceFiles: Record<(typeof fileNames)[number], string>;
  planHash: string;
};

export class JournalRenameError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "content-id-collision"
    | "unsafe-journal-root"
    | "canonical-mismatch"
    | "unresolved-references"
    | "unsafe-repository"
    | "lock-conflict"
    | "journal-rename-rollback-failed"
    | "rename-failed";

  constructor(
    message: string,
    code:
      | "invalid-content-id"
      | "source-unavailable"
      | "content-id-collision"
      | "unsafe-journal-root"
      | "canonical-mismatch"
      | "unresolved-references"
      | "unsafe-repository"
      | "lock-conflict"
      | "journal-rename-rollback-failed"
      | "rename-failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalRenameError";
    this.code = code;
  }
}

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const stablePlanHash = (plan: Omit<JournalRenamePlan, "planHash">) =>
  sha256(JSON.stringify(plan));

async function assertSafeRoot(root: string) {
  const resolved = path.resolve(root);
  const stat = await fs.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new JournalRenameError(
      "Canonical Journal root is not a safe directory",
      "unsafe-journal-root",
    );
  return resolved;
}

async function ensureSafeStateDirectory(parent: string, name: string) {
  const directory = path.join(parent, name);
  let stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat) {
    await fs.mkdir(directory, { mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new JournalRenameError(
      "Editor lifecycle state root is unsafe",
      "unsafe-repository",
    );
  return directory;
}

async function repositoryIdentity(repositoryRoot: string) {
  try {
    const root = await fs.realpath(repositoryRoot);
    const gitRoot = await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
    }).then(({ stdout }) => fs.realpath(stdout.trim()));
    if (gitRoot !== root) throw new Error("root mismatch");
    const repositoryHead = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).then(({ stdout }) => stdout.trim());
    const repositoryBranch = await execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: root, encoding: "utf8" },
    ).then(({ stdout }) => stdout.trim());
    return { repositoryHead, repositoryBranch };
  } catch (error) {
    throw new JournalRenameError(
      "Rename requires the repository root on an attached Git branch",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function assertDestinationAbsent(root: string, contentId: string) {
  const names = await fs.readdir(root);
  if (
    names.some(
      (name) =>
        name.toLocaleLowerCase("en-US") ===
        contentId.toLocaleLowerCase("en-US"),
    )
  )
    throw new JournalRenameError(
      `Journal Content ID or case-fold equivalent already exists: ${contentId}`,
      "content-id-collision",
    );
}

async function sourceInventory(root: string, contentId: string) {
  const directory = path.resolve(root, contentId);
  if (path.dirname(directory) !== root)
    throw new JournalRenameError("Unsafe Journal source", "source-unavailable");
  const stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new JournalRenameError(
      `Journal source does not exist: ${contentId}`,
      "source-unavailable",
    );
  const entries = (await fs.readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...fileNames].sort()))
    throw new JournalRenameError(
      "Journal source must contain exactly index.yaml, ja.md, and en.md",
      "source-unavailable",
    );
  const unit = await loadJournalUnit(directory);
  if (
    unit.issues.length ||
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid"
  )
    throw new JournalRenameError(
      "Journal source failed canonical three-file validation",
      "source-unavailable",
    );
  const sourceFiles = {} as JournalRenamePlan["sourceFiles"];
  for (const fileName of fileNames) {
    const file = path.join(directory, fileName);
    const fileStat = await fs.lstat(file);
    if (!fileStat.isFile() || fileStat.isSymbolicLink())
      throw new JournalRenameError(
        `Unsafe Journal source file: ${fileName}`,
        "source-unavailable",
      );
    sourceFiles[fileName] = sha256(await fs.readFile(file));
  }
  return sourceFiles;
}

async function assertNoIncomingReferences(
  repositoryRoot: string,
  sourceContentId: string,
) {
  const contentRoot = path.join(repositoryRoot, "src/content");
  const escaped = sourceContentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const route = new RegExp(
    String.raw`(?:\]\(|href\s*=\s*["'])\/journal\/${escaped}\/?(?:[?#][^"')\s]*)?(?:["')]?)`,
  );
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new JournalRenameError(
          "Reference inventory encountered a symlink",
          "unresolved-references",
        );
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const text = await fs.readFile(target, "utf8");
        if (route.test(text))
          throw new JournalRenameError(
            `Incoming Journal route reference must be resolved before Rename: ${path.relative(repositoryRoot, target)}`,
            "unresolved-references",
          );
      }
    }
  };
  await visit(contentRoot).catch((error) => {
    if (error instanceof JournalRenameError) throw error;
    throw new JournalRenameError(
      "The canonical reference inventory could not be completed",
      "unresolved-references",
      { cause: error },
    );
  });
}

export async function planJournalRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
}): Promise<JournalRenamePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  const heroEvidence = await new HeroAssetPublishEvidenceStore(
    repositoryRoot,
  ).read("journal", input.sourceContentId);
  if (heroEvidence)
    throw new JournalRenameError(
      "Publish the pending Journal Hero asset before Rename.",
      "canonical-mismatch",
    );
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new JournalRenameError(
      "Source and new Journal Content IDs must be different lowercase hyphenated IDs",
      "invalid-content-id",
    );
  const root = await assertSafeRoot(
    path.join(repositoryRoot, "src/content/journal"),
  );
  const identity = await repositoryIdentity(repositoryRoot);
  const sourceFiles = await sourceInventory(root, input.sourceContentId);
  await assertDestinationAbsent(root, input.destinationContentId);
  await assertNoIncomingReferences(repositoryRoot, input.sourceContentId);
  const body: Omit<JournalRenamePlan, "planHash"> = {
    schemaVersion: 1,
    operation: "journal-rename",
    operationId: randomUUID(),
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    oldRoutes: [`/journal/${input.sourceContentId}/`],
    newRoutes: [`/journal/${input.destinationContentId}/`],
    ...identity,
    sourceFiles,
  };
  return { ...body, planHash: stablePlanHash(body) };
}

export async function executeJournalRename(
  reviewedPlan: JournalRenamePlan,
  repositoryRoot = path.resolve("."),
) {
  repositoryRoot = path.resolve(repositoryRoot);
  await assertJournalMutationAdmitted(
    reviewedPlan.sourceContentId,
    path.join(repositoryRoot, "src/content/journal"),
  );
  const suppliedBody = { ...reviewedPlan };
  delete (suppliedBody as Partial<JournalRenamePlan>).planHash;
  if (
    reviewedPlan.planHash !==
    stablePlanHash(suppliedBody as Omit<JournalRenamePlan, "planHash">)
  )
    throw new JournalRenameError(
      "Rename plan identity is invalid",
      "canonical-mismatch",
    );
  const rebuilt = await planJournalRename({
    repositoryRoot,
    sourceContentId: reviewedPlan.sourceContentId,
    destinationContentId: reviewedPlan.destinationContentId,
  });
  const reviewedBody = { ...reviewedPlan } as Partial<JournalRenamePlan>;
  delete reviewedBody.planHash;
  delete reviewedBody.operationId;
  const rebuiltBody = { ...rebuilt } as Partial<JournalRenamePlan>;
  delete rebuiltBody.planHash;
  delete rebuiltBody.operationId;
  if (
    stablePlanHash(reviewedBody as Omit<JournalRenamePlan, "planHash">) !==
    stablePlanHash(rebuiltBody as Omit<JournalRenamePlan, "planHash">)
  )
    throw new JournalRenameError(
      "Canonical Journal or repository identity changed after Rename review",
      "canonical-mismatch",
    );

  const editorState = await ensureSafeStateDirectory(
    repositoryRoot,
    ".kiki-editor",
  );
  const stateRoot = await ensureSafeStateDirectory(
    editorState,
    "content-lifecycle",
  );
  await ensureSafeStateDirectory(stateRoot, "operations");
  const lock = path.join(stateRoot, "repository.lock");
  const assetLock = path.join(
    repositoryRoot,
    ".kiki-editor/asset-lifecycle/repository.lock",
  );
  if (await fs.lstat(assetLock).catch(() => undefined))
    throw new JournalRenameError(
      "Asset lifecycle mutation is active or requires recovery",
      "lock-conflict",
    );
  try {
    await fs.mkdir(lock);
  } catch (error) {
    throw new JournalRenameError(
      "Another content lifecycle operation is active or requires recovery",
      "lock-conflict",
      { cause: error },
    );
  }
  const recordPath = path.join(
    stateRoot,
    "operations",
    `${reviewedPlan.operationId}.json`,
  );
  const root = path.join(repositoryRoot, "src/content/journal");
  const source = path.join(root, reviewedPlan.sourceContentId);
  const destination = path.join(root, reviewedPlan.destinationContentId);
  let moved = false;
  const record = async (state: string, detail?: string) =>
    fs.writeFile(
      recordPath,
      `${JSON.stringify({ schemaVersion: 1, plan: reviewedPlan, state, detail, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: state === "planned" ? "wx" : "w", mode: 0o600 },
    );
  try {
    await fs.writeFile(
      path.join(lock, "owner.json"),
      `${JSON.stringify({ operationId: reviewedPlan.operationId, pid: process.pid })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await record("planned");
    const current = await sourceInventory(root, reviewedPlan.sourceContentId);
    if (JSON.stringify(current) !== JSON.stringify(reviewedPlan.sourceFiles))
      throw new JournalRenameError(
        "Canonical Journal files changed after Rename review",
        "canonical-mismatch",
      );
    await assertDestinationAbsent(root, reviewedPlan.destinationContentId);
    await assertNoIncomingReferences(
      repositoryRoot,
      reviewedPlan.sourceContentId,
    );
    await record("executing");
    await fs.rename(source, destination);
    moved = true;
    const renamed = await sourceInventory(
      root,
      reviewedPlan.destinationContentId,
    );
    if (JSON.stringify(renamed) !== JSON.stringify(reviewedPlan.sourceFiles))
      throw new JournalRenameError(
        "Renamed Journal unit failed canonical byte verification",
        "canonical-mismatch",
      );
    if (await fs.lstat(source).catch(() => undefined))
      throw new JournalRenameError(
        "Old Journal Content ID remained after Rename",
        "canonical-mismatch",
      );
    const draft = createJournalEditorDraft(
      await readJournalEditorEntry(reviewedPlan.destinationContentId, root),
    );
    await record("completed");
    await fs.unlink(path.join(lock, "owner.json"));
    await fs.rmdir(lock);
    return {
      draft,
      operationId: reviewedPlan.operationId,
      state: "saved-unpublished" as const,
    };
  } catch (error) {
    if (moved) {
      try {
        if (await fs.lstat(source).catch(() => undefined))
          throw new Error("source path was recreated before rollback");
        const current = await sourceInventory(
          root,
          reviewedPlan.destinationContentId,
        );
        if (
          JSON.stringify(current) !== JSON.stringify(reviewedPlan.sourceFiles)
        )
          throw new Error("destination bytes changed before rollback");
        await fs.rename(destination, source);
        await record(
          "rolled-back",
          error instanceof Error ? error.message : "Rename failed",
        );
      } catch (rollbackError) {
        await record(
          "manual-recovery-required",
          "Rollback could not restore the exact source unit",
        ).catch(() => undefined);
        throw new JournalRenameError(
          "Journal Rename rollback failed; stop Editor mutation and inspect the operation record",
          "journal-rename-rollback-failed",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }
    await fs.unlink(path.join(lock, "owner.json")).catch(() => undefined);
    await fs.rmdir(lock).catch(() => undefined);
    if (error instanceof JournalRenameError) throw error;
    throw new JournalRenameError(
      "Failed to rename Journal entry",
      "rename-failed",
      { cause: error },
    );
  }
}
