import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import { createNewsEditorDraft } from "./news-draft-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";

const execFile = promisify(execFileCallback);
const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

export type NewsRenamePlan = {
  schemaVersion: 1;
  operation: "news-rename";
  operationId: string;
  sourceContentId: string;
  destinationContentId: string;
  oldRoutes: [];
  newRoutes: [];
  repositoryHead: string;
  repositoryBranch: string;
  sourceFile: string;
  planHash: string;
};

export class NewsRenameError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "content-id-collision"
    | "unsafe-news-root"
    | "canonical-mismatch"
    | "unsafe-repository"
    | "lock-conflict"
    | "news-rename-rollback-failed"
    | "rename-failed";
  constructor(
    message: string,
    code: NewsRenameError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NewsRenameError";
    this.code = code;
  }
}

const planHash = (plan: Omit<NewsRenamePlan, "planHash">) =>
  sha256(JSON.stringify(plan));

async function safeDirectory(directory: string, code: NewsRenameError["code"]) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new NewsRenameError("Rename directory is unsafe", code);
  return resolved;
}

async function ensureStateDirectory(parent: string, name: string) {
  const directory = path.join(parent, name);
  let stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat) {
    await fs.mkdir(directory, { mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new NewsRenameError(
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
    throw new NewsRenameError(
      "Rename requires the repository root on an attached Git branch",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function assertDestinationAbsent(root: string, contentId: string) {
  const target = `${contentId}.md`.toLocaleLowerCase("en-US");
  if (
    (await fs.readdir(root)).some(
      (name) => name.toLocaleLowerCase("en-US") === target,
    )
  )
    throw new NewsRenameError(
      `News Content ID or case-fold equivalent already exists: ${contentId}. Choose another ID.`,
      "content-id-collision",
    );
}

async function sourceHash(root: string, contentId: string) {
  const file = path.resolve(root, `${contentId}.md`);
  if (path.dirname(file) !== root)
    throw new NewsRenameError("Unsafe News source", "source-unavailable");
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw new NewsRenameError(
      `News source is unavailable: ${contentId}.`,
      "source-unavailable",
    );
  const entry = await readNewsEditorEntry(contentId, root).catch((error) => {
    throw new NewsRenameError(
      "News source failed canonical validation",
      "source-unavailable",
      { cause: error },
    );
  });
  if (entry.structuralStatus !== "valid")
    throw new NewsRenameError(
      "Fix News validation issues before Rename.",
      "source-unavailable",
    );
  return sha256(await fs.readFile(file));
}

export async function planNewsRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
}): Promise<NewsRenamePlan> {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new NewsRenameError(
      "Source and new News Content IDs must be different lowercase hyphenated IDs.",
      "invalid-content-id",
    );
  const root = await safeDirectory(
    path.join(repositoryRoot, "src/content/news"),
    "unsafe-news-root",
  );
  const body: Omit<NewsRenamePlan, "planHash"> = {
    schemaVersion: 1,
    operation: "news-rename",
    operationId: randomUUID(),
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    oldRoutes: [],
    newRoutes: [],
    ...(await repositoryIdentity(repositoryRoot)),
    sourceFile: await sourceHash(root, input.sourceContentId),
  };
  await assertDestinationAbsent(root, input.destinationContentId);
  return { ...body, planHash: planHash(body) };
}

export async function executeNewsRename(
  reviewedPlan: NewsRenamePlan,
  repositoryRoot = path.resolve("."),
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const supplied = { ...reviewedPlan } as Partial<NewsRenamePlan>;
  delete supplied.planHash;
  if (
    reviewedPlan.planHash !==
    planHash(supplied as Omit<NewsRenamePlan, "planHash">)
  )
    throw new NewsRenameError(
      "Rename plan identity is invalid; request a new plan.",
      "canonical-mismatch",
    );
  const rebuilt = await planNewsRename({
    repositoryRoot,
    sourceContentId: reviewedPlan.sourceContentId,
    destinationContentId: reviewedPlan.destinationContentId,
  });
  const comparable = (value: NewsRenamePlan) => {
    const copy = { ...value } as Partial<NewsRenamePlan>;
    delete copy.planHash;
    delete copy.operationId;
    return planHash(copy as Omit<NewsRenamePlan, "planHash">);
  };
  if (comparable(reviewedPlan) !== comparable(rebuilt))
    throw new NewsRenameError(
      "Canonical News or repository identity changed; review a new plan.",
      "canonical-mismatch",
    );

  const editorState = await ensureStateDirectory(
    repositoryRoot,
    ".kiki-editor",
  );
  const stateRoot = await ensureStateDirectory(
    editorState,
    "content-lifecycle",
  );
  const operations = await ensureStateDirectory(stateRoot, "operations");
  const lock = path.join(stateRoot, "repository.lock");
  if (
    await fs
      .lstat(
        path.join(
          repositoryRoot,
          ".kiki-editor/asset-lifecycle/repository.lock",
        ),
      )
      .catch(() => undefined)
  )
    throw new NewsRenameError(
      "Asset lifecycle mutation is active or requires recovery.",
      "lock-conflict",
    );
  try {
    await fs.mkdir(lock);
  } catch (error) {
    throw new NewsRenameError(
      "Another content lifecycle operation is active or requires recovery.",
      "lock-conflict",
      { cause: error },
    );
  }
  const recordPath = path.join(operations, `${reviewedPlan.operationId}.json`);
  const root = path.join(repositoryRoot, "src/content/news");
  const source = path.join(root, `${reviewedPlan.sourceContentId}.md`);
  const destination = path.join(
    root,
    `${reviewedPlan.destinationContentId}.md`,
  );
  let moved = false;
  const record = (state: string, detail?: string) =>
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
    if (
      (await sourceHash(root, reviewedPlan.sourceContentId)) !==
      reviewedPlan.sourceFile
    )
      throw new NewsRenameError(
        "Canonical News changed after review; request a new plan.",
        "canonical-mismatch",
      );
    await assertDestinationAbsent(root, reviewedPlan.destinationContentId);
    await record("executing");
    await fs.rename(source, destination);
    moved = true;
    if (
      (await sourceHash(root, reviewedPlan.destinationContentId)) !==
      reviewedPlan.sourceFile
    )
      throw new NewsRenameError(
        "Renamed News failed byte verification.",
        "canonical-mismatch",
      );
    if (await fs.lstat(source).catch(() => undefined))
      throw new NewsRenameError(
        "Old News Content ID remained after Rename.",
        "canonical-mismatch",
      );
    const draft = createNewsEditorDraft(
      await readNewsEditorEntry(reviewedPlan.destinationContentId, root),
    );
    if (!draft)
      throw new NewsRenameError(
        "Renamed News could not open a workspace.",
        "canonical-mismatch",
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
          throw new Error("source recreated");
        if (
          (await sourceHash(root, reviewedPlan.destinationContentId)) !==
          reviewedPlan.sourceFile
        )
          throw new Error("destination changed");
        await fs.rename(destination, source);
        await record(
          "rolled-back",
          error instanceof Error ? error.message : "Rename failed",
        );
      } catch (rollbackError) {
        await record(
          "manual-recovery-required",
          "Rollback could not restore the exact source file",
        ).catch(() => undefined);
        throw new NewsRenameError(
          "News Rename rollback failed; stop Editor mutation and inspect the operation record.",
          "news-rename-rollback-failed",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
    }
    await fs.unlink(path.join(lock, "owner.json")).catch(() => undefined);
    await fs.rmdir(lock).catch(() => undefined);
    if (error instanceof NewsRenameError) throw error;
    throw new NewsRenameError("Failed to rename News entry.", "rename-failed", {
      cause: error,
    });
  }
}
