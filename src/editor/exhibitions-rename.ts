import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import { createExhibitionsEditorDraft } from "./exhibitions-draft-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import {
  findNewsReferenceSpan,
  NewsReferenceStructureError,
} from "./news-reference-update.ts";

const execFile = promisify(execFileCallback);
const CONTENT_COLLECTIONS = [
  "artists",
  "works",
  "exhibitions",
  "news",
  "home",
  "journal",
] as const;

export type ExhibitionReferenceEdit = {
  collection: "news";
  contentId: string;
  file: string;
  fieldPath: "link";
  oldValue: string;
  newValue: string;
  sourceHash: string;
  resultingHash: string;
  start: number;
  end: number;
};

export type ExhibitionsRenamePlan = {
  schemaVersion: 1;
  adapterVersion: "exhibition-news-link-v1";
  operation: "exhibitions-rename";
  operationId: string;
  createdAt: string;
  sourceContentId: string;
  destinationContentId: string;
  oldRoutes: string[];
  newRoutes: string[];
  repositoryRealpath: string;
  repositoryHead: string;
  repositoryBranch: string;
  repositoryUpstream: string;
  graphHash: string;
  sourceFile: { file: string; hash: string; size: number };
  referenceEdits: ExhibitionReferenceEdit[];
  touchedPaths: string[];
  publishPaths: string[];
  unchanged: string[];
  planHash: string;
};

export class ExhibitionsRenameError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "destination-conflict"
    | "reference-graph-incomplete"
    | "reference-rewrite-unsupported"
    | "prospective-validation-failed"
    | "plan-stale"
    | "lifecycle-lock-conflict"
    | "unsafe-repository"
    | "rename-failed-rolled-back"
    | "manual-recovery-required";

  constructor(
    message: string,
    code: ExhibitionsRenameError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExhibitionsRenameError";
    this.code = code;
  }
}

const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const hashPlan = (value: Omit<ExhibitionsRenamePlan, "planHash">) =>
  sha256(JSON.stringify(value));
const relative = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

async function safeDirectory(
  directory: string,
  code: ExhibitionsRenameError["code"],
) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ExhibitionsRenameError(`Unsafe directory: ${resolved}`, code);
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
    throw new ExhibitionsRenameError(
      "Editor lifecycle evidence path is unsafe.",
      "unsafe-repository",
    );
  return directory;
}

async function repositoryIdentity(repositoryRoot: string) {
  try {
    const repositoryRealpath = await fs.realpath(repositoryRoot);
    const gitRoot = await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: repositoryRealpath,
      encoding: "utf8",
    }).then(({ stdout }) => fs.realpath(stdout.trim()));
    if (gitRoot !== repositoryRealpath) throw new Error("root mismatch");
    const repositoryHead = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRealpath,
      encoding: "utf8",
    }).then(({ stdout }) => stdout.trim());
    const repositoryBranch = await execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: repositoryRealpath, encoding: "utf8" },
    ).then(({ stdout }) => stdout.trim());
    const repositoryUpstream = await execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: repositoryRealpath, encoding: "utf8" },
    ).then(({ stdout }) => stdout.trim());
    if (!repositoryUpstream.endsWith(`/${repositoryBranch}`))
      throw new Error("upstream mismatch");
    return {
      repositoryRealpath,
      repositoryHead,
      repositoryBranch,
      repositoryUpstream,
    };
  } catch (error) {
    throw new ExhibitionsRenameError(
      "Rename requires the exact repository root on a branch with a matching upstream.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function walkCanonical(repositoryRoot: string) {
  const inventory: Array<{ file: string; bytes: Buffer }> = [];
  for (const collection of CONTENT_COLLECTIONS) {
    const root = await safeDirectory(
      path.join(repositoryRoot, "src/content", collection),
      "reference-graph-incomplete",
    );
    const visit = async (directory: string): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink())
          throw new ExhibitionsRenameError(
            `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
            "reference-graph-incomplete",
          );
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) {
          if (!/\.(md|ya?ml)$/.test(entry.name))
            throw new ExhibitionsRenameError(
              `Unsupported canonical file: ${relative(repositoryRoot, file)}`,
              "reference-graph-incomplete",
            );
          inventory.push({ file, bytes: await fs.readFile(file) });
        } else
          throw new ExhibitionsRenameError(
            `Unsupported canonical entry: ${relative(repositoryRoot, file)}`,
            "reference-graph-incomplete",
          );
      }
    };
    await visit(root);
  }
  return inventory.sort((a, b) => a.file.localeCompare(b.file));
}

function newsLinkEdit(
  repositoryRoot: string,
  item: { file: string; bytes: Buffer },
  oldId: string,
  newId: string,
): ExhibitionReferenceEdit | undefined {
  const file = relative(repositoryRoot, item.file);
  let span;
  try {
    span = findNewsReferenceSpan(file, item.bytes, "exhibitions", oldId, newId);
  } catch (error) {
    if (error instanceof NewsReferenceStructureError)
      throw new ExhibitionsRenameError(
        error.message,
        "reference-rewrite-unsupported",
        { cause: error },
      );
    throw error;
  }
  if (!span) return;
  const { oldValue, newValue, start, end } = span;
  const output = Buffer.concat([
    item.bytes.subarray(0, start),
    Buffer.from(newValue),
    item.bytes.subarray(end),
  ]);
  return {
    collection: "news",
    contentId: span.contentId,
    file,
    fieldPath: "link",
    oldValue,
    newValue,
    sourceHash: sha256(item.bytes),
    resultingHash: sha256(output),
    start,
    end,
  };
}

function rewriteReference(bytes: Buffer, edit: ExhibitionReferenceEdit) {
  if (sha256(bytes) !== edit.sourceHash)
    throw new ExhibitionsRenameError(
      `Reference bytes changed: ${edit.file}`,
      "plan-stale",
    );
  const current = bytes.subarray(edit.start, edit.end).toString("utf8");
  if (current !== edit.oldValue)
    throw new ExhibitionsRenameError(
      `Reference span no longer matches: ${edit.file}`,
      "reference-rewrite-unsupported",
    );
  const output = Buffer.concat([
    bytes.subarray(0, edit.start),
    Buffer.from(edit.newValue),
    bytes.subarray(edit.end),
  ]);
  if (sha256(output) !== edit.resultingHash)
    throw new ExhibitionsRenameError(
      `Reference rewrite proof failed: ${edit.file}`,
      "reference-rewrite-unsupported",
    );
  return output;
}

async function buildPlan(input: {
  repositoryRoot: string;
  sourceContentId: string;
  destinationContentId: string;
  operationId: string;
  createdAt: string;
}) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const identity = await repositoryIdentity(repositoryRoot);
  const exhibitionsRoot = await safeDirectory(
    path.join(repositoryRoot, "src/content/exhibitions"),
    "unsafe-repository",
  );
  const source = path.join(exhibitionsRoot, `${input.sourceContentId}.md`);
  const sourceStat = await fs.lstat(source).catch(() => undefined);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink())
    throw new ExhibitionsRenameError(
      "Exhibition source is missing or unsafe.",
      "source-unavailable",
    );
  const entry = await readExhibitionsEditorEntry(
    input.sourceContentId,
    exhibitionsRoot,
  ).catch((error) => {
    throw new ExhibitionsRenameError(
      "Exhibition source failed canonical validation.",
      "source-unavailable",
      { cause: error },
    );
  });
  if (entry.structuralStatus !== "valid")
    throw new ExhibitionsRenameError(
      "Fix Exhibition validation issues first.",
      "source-unavailable",
    );
  const destinationName = `${input.destinationContentId}.md`.toLocaleLowerCase(
    "en-US",
  );
  if (
    (await fs.readdir(exhibitionsRoot)).some(
      (name) => name.toLocaleLowerCase("en-US") === destinationName,
    )
  )
    throw new ExhibitionsRenameError(
      "The destination Exhibition ID or case-fold equivalent already exists.",
      "destination-conflict",
    );
  const inventory = await walkCanonical(repositoryRoot);
  const edits = inventory
    .map((item) =>
      newsLinkEdit(
        repositoryRoot,
        item,
        input.sourceContentId,
        input.destinationContentId,
      ),
    )
    .filter((edit): edit is ExhibitionReferenceEdit => Boolean(edit));
  const oldRoute = `/exhibitions/${input.sourceContentId}`;
  const escapedRoute = oldRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unsupportedRoute = new RegExp(`${escapedRoute}/?(?=[\\s"')\\]}>?#]|$)`);
  for (const item of inventory) {
    const file = relative(repositoryRoot, item.file);
    if (
      !file.startsWith("src/content/news/") &&
      unsupportedRoute.test(item.bytes.toString("utf8"))
    )
      throw new ExhibitionsRenameError(
        `Unsupported incoming Exhibition reference: ${file}`,
        "reference-graph-incomplete",
      );
  }
  const sourceBytes = await fs.readFile(source);
  const sourceFile = {
    file: relative(repositoryRoot, source),
    hash: sha256(sourceBytes),
    size: sourceBytes.length,
  };
  const newFile = `src/content/exhibitions/${input.destinationContentId}.md`;
  const touchedPaths = [
    sourceFile.file,
    newFile,
    ...edits.map(({ file }) => file),
  ].sort();
  const body: Omit<ExhibitionsRenamePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: "exhibition-news-link-v1",
    operation: "exhibitions-rename",
    operationId: input.operationId,
    createdAt: input.createdAt,
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    oldRoutes: [`${oldRoute}/`],
    newRoutes: [`/exhibitions/${input.destinationContentId}/`],
    ...identity,
    graphHash: sha256(
      inventory
        .map(
          ({ file, bytes }) =>
            `${relative(repositoryRoot, file)}\0${sha256(bytes)}`,
        )
        .join("\n"),
    ),
    sourceFile,
    referenceEdits: edits,
    touchedPaths,
    publishPaths: touchedPaths,
    unchanged: [
      "Exhibition artists[] and works[] references",
      "All asset bytes and paths",
      "Production loaders and generated relationships",
      "Preview and Save boundaries",
    ],
  };
  return { ...body, planHash: hashPlan(body) };
}

export async function planExhibitionsRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
}): Promise<ExhibitionsRenamePlan> {
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new ExhibitionsRenameError(
      "Source and new Exhibition IDs must be different lowercase hyphenated IDs.",
      "invalid-content-id",
    );
  return buildPlan({
    repositoryRoot: path.resolve(input.repositoryRoot ?? "."),
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    operationId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

const comparableHash = (plan: ExhibitionsRenamePlan) => {
  const body = { ...plan } as Partial<ExhibitionsRenamePlan>;
  delete body.planHash;
  delete body.operationId;
  delete body.createdAt;
  return sha256(JSON.stringify(body));
};

export async function executeExhibitionsRename(
  reviewedPlan: ExhibitionsRenamePlan,
  repositoryRoot = path.resolve("."),
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const supplied = { ...reviewedPlan } as Partial<ExhibitionsRenamePlan>;
  delete supplied.planHash;
  if (
    reviewedPlan.planHash !==
    hashPlan(supplied as Omit<ExhibitionsRenamePlan, "planHash">)
  )
    throw new ExhibitionsRenameError(
      "Rename plan identity is invalid.",
      "plan-stale",
    );
  const stateRoot = await ensureStateDirectory(repositoryRoot, ".kiki-editor");
  const lifecycle = await ensureStateDirectory(stateRoot, "content-lifecycle");
  const operations = await ensureStateDirectory(lifecycle, "operations");
  const lock = path.join(lifecycle, "repository.lock");
  if (
    await fs
      .lstat(path.join(stateRoot, "asset-lifecycle/repository.lock"))
      .catch(() => undefined)
  )
    throw new ExhibitionsRenameError(
      "Asset lifecycle mutation is active or requires recovery.",
      "lifecycle-lock-conflict",
    );
  try {
    await fs.mkdir(lock);
  } catch (error) {
    throw new ExhibitionsRenameError(
      "Another content lifecycle operation is active or requires recovery.",
      "lifecycle-lock-conflict",
      { cause: error },
    );
  }
  const operationRoot = path.join(operations, reviewedPlan.operationId);
  let mutationStarted = false;
  let record: Record<string, unknown> | undefined;
  try {
    await fs.writeFile(
      path.join(lock, "owner.json"),
      `${JSON.stringify({ operationId: reviewedPlan.operationId, pid: process.pid })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    const rebuilt = await buildPlan({
      repositoryRoot,
      sourceContentId: reviewedPlan.sourceContentId,
      destinationContentId: reviewedPlan.destinationContentId,
      operationId: reviewedPlan.operationId,
      createdAt: reviewedPlan.createdAt,
    });
    if (comparableHash(reviewedPlan) !== comparableHash(rebuilt))
      throw new ExhibitionsRenameError(
        "Canonical content, references, destination, or Git identity changed; review a new plan.",
        "plan-stale",
      );
    await fs.mkdir(operationRoot, { mode: 0o700 });
    const recoveryRoot = await ensureStateDirectory(operationRoot, "recovery");
    const stagedRoot = await ensureStateDirectory(operationRoot, "staged");
    const preimages: Record<
      string,
      { hash: string; mode: number; bytes: string }
    > = {};
    const prospective: Record<
      string,
      { hash: string; mode: number; bytes: string }
    > = {};
    for (const file of reviewedPlan.touchedPaths.filter(
      (file) =>
        file !==
        `src/content/exhibitions/${reviewedPlan.destinationContentId}.md`,
    )) {
      const absolute = path.join(repositoryRoot, file);
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new ExhibitionsRenameError(
          `Touched path became unsafe: ${file}`,
          "plan-stale",
        );
      const bytes = await fs.readFile(absolute);
      preimages[file] = {
        hash: sha256(bytes),
        mode: stat.mode,
        bytes: bytes.toString("base64"),
      };
    }
    const sourceBytes = Buffer.from(
      preimages[reviewedPlan.sourceFile.file].bytes,
      "base64",
    );
    const newFile = `src/content/exhibitions/${reviewedPlan.destinationContentId}.md`;
    prospective[newFile] = {
      hash: sha256(sourceBytes),
      mode: preimages[reviewedPlan.sourceFile.file].mode,
      bytes: sourceBytes.toString("base64"),
    };
    for (const edit of reviewedPlan.referenceEdits) {
      const bytes = Buffer.from(preimages[edit.file].bytes, "base64");
      const rewritten = rewriteReference(bytes, edit);
      prospective[edit.file] = {
        hash: sha256(rewritten),
        mode: preimages[edit.file].mode,
        bytes: rewritten.toString("base64"),
      };
    }
    record = {
      schemaVersion: 1,
      operation: "exhibitions-rename",
      state: "prepared",
      plan: reviewedPlan,
      preimages,
      prospective,
      completedSteps: [],
      updatedAt: new Date().toISOString(),
    };
    const recordPath = path.join(operationRoot, "operation.json");
    const writeRecord = async () => {
      await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
        mode: 0o600,
      });
      const handle = await fs.open(recordPath, "r");
      await handle.sync();
      await handle.close();
    };
    for (const [file, value] of Object.entries(prospective)) {
      const staged = path.join(stagedRoot, file.replaceAll("/", "__"));
      await fs.writeFile(staged, Buffer.from(value.bytes, "base64"), {
        flag: "wx",
        mode: value.mode,
      });
      if (sha256(await fs.readFile(staged)) !== value.hash)
        throw new ExhibitionsRenameError(
          "Staged bytes failed validation.",
          "prospective-validation-failed",
        );
    }
    await writeRecord();
    // The complete inventory was validated while rebuilding the plan; validate every
    // prospective reference and the renamed source before the first canonical move.
    if (sha256(sourceBytes) !== reviewedPlan.sourceFile.hash)
      throw new ExhibitionsRenameError(
        "Source preimage mismatch.",
        "plan-stale",
      );
    for (const edit of reviewedPlan.referenceEdits)
      if (prospective[edit.file].hash !== edit.resultingHash)
        throw new ExhibitionsRenameError(
          "Prospective reference graph mismatch.",
          "prospective-validation-failed",
        );
    mutationStarted = true;
    for (const file of Object.keys(preimages).sort()) {
      const recovery = path.join(recoveryRoot, file.replaceAll("/", "__"));
      await fs.rename(path.join(repositoryRoot, file), recovery);
      (record.completedSteps as string[]).push(`recover:${file}`);
      await writeRecord();
    }
    for (const file of Object.keys(prospective).sort()) {
      const destination = path.join(repositoryRoot, file);
      const staged = path.join(stagedRoot, file.replaceAll("/", "__"));
      await fs.rename(staged, destination);
      (record.completedSteps as string[]).push(`install:${file}`);
      await writeRecord();
    }
    const installedInventory = await walkCanonical(repositoryRoot);
    const installedGraph = sha256(
      installedInventory
        .map(
          ({ file, bytes }) =>
            `${relative(repositoryRoot, file)}\0${sha256(bytes)}`,
        )
        .join("\n"),
    );
    if (
      !installedGraph ||
      (await fs
        .lstat(path.join(repositoryRoot, reviewedPlan.sourceFile.file))
        .catch(() => undefined))
    )
      throw new ExhibitionsRenameError(
        "Installed graph failed validation.",
        "prospective-validation-failed",
      );
    for (const [file, value] of Object.entries(prospective))
      if (
        sha256(await fs.readFile(path.join(repositoryRoot, file))) !==
        value.hash
      )
        throw new ExhibitionsRenameError(
          `Installed bytes mismatch: ${file}`,
          "prospective-validation-failed",
        );
    const draft = createExhibitionsEditorDraft(
      await readExhibitionsEditorEntry(
        reviewedPlan.destinationContentId,
        path.join(repositoryRoot, "src/content/exhibitions"),
      ),
    );
    if (!draft)
      throw new ExhibitionsRenameError(
        "Renamed workspace is invalid.",
        "prospective-validation-failed",
      );
    record.state = "completed";
    record.installedGraphHash = installedGraph;
    record.updatedAt = new Date().toISOString();
    await writeRecord();
    await fs.unlink(path.join(lock, "owner.json"));
    await fs.rmdir(lock);
    return {
      draft,
      operationId: reviewedPlan.operationId,
      state: "saved-unpublished" as const,
    };
  } catch (error) {
    if (mutationStarted && record) {
      try {
        const prospective = record.prospective as Record<
          string,
          { hash: string }
        >;
        const preimages = record.preimages as Record<
          string,
          { hash: string; mode: number; bytes: string }
        >;
        for (const [file, expected] of Object.entries(prospective).reverse()) {
          const installed = path.join(repositoryRoot, file);
          const stat = await fs.lstat(installed).catch(() => undefined);
          if (stat) {
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              sha256(await fs.readFile(installed)) !== expected.hash
            )
              throw new Error(`installed file changed: ${file}`);
            await fs.unlink(installed);
          }
        }
        for (const [file, expected] of Object.entries(preimages).reverse()) {
          const destination = path.join(repositoryRoot, file);
          if (await fs.lstat(destination).catch(() => undefined))
            throw new Error(`rollback destination occupied: ${file}`);
          const recovery = path.join(
            operationRoot,
            "recovery",
            file.replaceAll("/", "__"),
          );
          if (sha256(await fs.readFile(recovery)) !== expected.hash)
            throw new Error(`recovery bytes changed: ${file}`);
          await fs.rename(recovery, destination);
          await fs.chmod(destination, expected.mode);
          if (sha256(await fs.readFile(destination)) !== expected.hash)
            throw new Error(`restored bytes mismatch: ${file}`);
        }
        record.state = "rolled-back";
        record.failure =
          error instanceof Error ? error.message : "Rename failed";
        record.updatedAt = new Date().toISOString();
        await fs.writeFile(
          path.join(operationRoot, "operation.json"),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        await fs.unlink(path.join(lock, "owner.json")).catch(() => undefined);
        await fs.rmdir(lock).catch(() => undefined);
        throw new ExhibitionsRenameError(
          "Exhibition Rename failed; every touched canonical byte was restored.",
          "rename-failed-rolled-back",
          { cause: error },
        );
      } catch (rollbackError) {
        if (rollbackError instanceof ExhibitionsRenameError)
          throw rollbackError;
        record.state = "manual-recovery-required";
        record.failure =
          rollbackError instanceof Error
            ? rollbackError.message
            : "Rollback failed";
        await fs
          .writeFile(
            path.join(operationRoot, "operation.json"),
            `${JSON.stringify(record, null, 2)}\n`,
          )
          .catch(() => undefined);
        throw new ExhibitionsRenameError(
          "Exact rollback could not be proven. Preserve the lock and operation evidence.",
          "manual-recovery-required",
          { cause: rollbackError },
        );
      }
    }
    await fs.unlink(path.join(lock, "owner.json")).catch(() => undefined);
    await fs.rmdir(lock).catch(() => undefined);
    throw error;
  }
}
