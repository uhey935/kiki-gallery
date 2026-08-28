import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { isContentId } from "./content-id.ts";
import { loadExhibitionUnit } from "../content-loaders/exhibitions/repository.ts";
import { findNewsReferenceSpan } from "./news-reference-update.ts";
import { createExhibitionsEditorDraft } from "./exhibitions-draft-state.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import { assertNoActiveRenameEvidence } from "./content-rename-evidence-lifecycle.ts";
const execFile = promisify(execFileCallback),
  names = ["en.md", "index.yaml", "ja.md"] as const,
  sha = (v: Uint8Array | string) =>
    createHash("sha256").update(v).digest("hex");
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
  adapterVersion: "exhibition-news-link-v2";
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
  sourceFiles: Array<{ file: string; hash: string; size: number }>;
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
    | "pending-hero-publish-evidence"
    | "pending-rename-evidence"
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
    this.code = code;
  }
}
const rel = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");
async function identity(root: string) {
  try {
    const repositoryRealpath = await fs.realpath(root),
      repositoryHead = (
        await execFile("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout.trim(),
      repositoryBranch = (
        await execFile("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        })
      ).stdout.trim(),
      repositoryUpstream = (
        await execFile(
          "git",
          ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
          { cwd: root, encoding: "utf8" },
        )
      ).stdout.trim();
    return {
      repositoryRealpath,
      repositoryHead,
      repositoryBranch,
      repositoryUpstream,
    };
  } catch (error) {
    throw new ExhibitionsRenameError("Unsafe repository", "unsafe-repository", {
      cause: error,
    });
  }
}
async function news(root: string, oldId: string, newId: string) {
  const base = path.join(root, "src/content/news"),
    edits: ExhibitionReferenceEdit[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile() && item.name === "index.yaml") {
        const bytes = await fs.readFile(file),
          relative = rel(root, file),
          span = findNewsReferenceSpan(
            relative,
            bytes,
            "exhibitions",
            oldId,
            newId,
          );
        if (span) {
          const output = Buffer.concat([
            bytes.subarray(0, span.start),
            Buffer.from(span.newValue),
            bytes.subarray(span.end),
          ]);
          edits.push({
            collection: "news",
            contentId: path.basename(path.dirname(file)),
            file: relative,
            fieldPath: "link",
            oldValue: span.oldValue,
            newValue: span.newValue,
            sourceHash: sha(bytes),
            resultingHash: sha(output),
            start: span.start,
            end: span.end,
          });
        }
      }
    }
  };
  await visit(base);
  return edits;
}
function hashPlan(plan: Omit<ExhibitionsRenamePlan, "planHash">) {
  return sha(JSON.stringify(plan));
}
async function build(
  root: string,
  sourceContentId: string,
  destinationContentId: string,
  operationId: string,
  createdAt: string,
) {
  root = path.resolve(root);
  const base = path.join(root, "src/content/exhibitions"),
    source = path.join(base, sourceContentId),
    stat = await fs.lstat(source).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ExhibitionsRenameError(
      "Source unavailable",
      "source-unavailable",
    );
  const inventory = (await fs.readdir(source, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  if (
    JSON.stringify(inventory.map((item) => item.name)) !==
      JSON.stringify(names) ||
    inventory.some((item) => !item.isFile() || item.isSymbolicLink())
  )
    throw new ExhibitionsRenameError(
      "Exact three-file inventory required",
      "source-unavailable",
    );
  if (
    (await fs.readdir(base)).some(
      (name) => name.toLowerCase() === destinationContentId.toLowerCase(),
    )
  )
    throw new ExhibitionsRenameError(
      "Destination conflict",
      "destination-conflict",
    );
  const unit = await loadExhibitionUnit(source);
  if (
    unit.shared.state !== "valid" ||
    unit.locales.ja.state !== "valid" ||
    unit.locales.en.state !== "valid"
  )
    throw new ExhibitionsRenameError("Source invalid", "source-unavailable");
  const sourceFiles = await Promise.all(
      names.map(async (name) => {
        const file = path.join(source, name),
          bytes = await fs.readFile(file);
        return { file: rel(root, file), hash: sha(bytes), size: bytes.length };
      }),
    ),
    edits = await news(root, sourceContentId, destinationContentId),
    newFiles = names.map(
      (name) => `src/content/exhibitions/${destinationContentId}/${name}`,
    ),
    touchedPaths = [
      ...sourceFiles.map((x) => x.file),
      ...newFiles,
      ...edits.map((x) => x.file),
    ].sort(),
    sourceFile = {
      file: `src/content/exhibitions/${sourceContentId}`,
      hash: sha(sourceFiles.map((x) => x.hash).join("")),
      size: sourceFiles.reduce((n, x) => n + x.size, 0),
    };
  const body: Omit<ExhibitionsRenamePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: "exhibition-news-link-v2",
    operation: "exhibitions-rename",
    operationId,
    createdAt,
    sourceContentId,
    destinationContentId,
    oldRoutes: [
      `/exhibitions/${sourceContentId}/`,
      `/en/exhibitions/${sourceContentId}/`,
    ],
    newRoutes: [
      `/exhibitions/${destinationContentId}/`,
      `/en/exhibitions/${destinationContentId}/`,
    ],
    ...(await identity(root)),
    graphHash: sha(JSON.stringify([...sourceFiles, ...edits])),
    sourceFile,
    sourceFiles,
    referenceEdits: edits,
    touchedPaths,
    publishPaths: touchedPaths,
    unchanged: ["Content bytes", "Artist and Work references", "Assets"],
  };
  return { ...body, planHash: hashPlan(body) };
}
export async function planExhibitionsRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
}) {
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new ExhibitionsRenameError("Invalid IDs", "invalid-content-id");
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  try { await assertNoActiveRenameEvidence(repositoryRoot, "exhibitions", input.sourceContentId); }
  catch (error) { throw new ExhibitionsRenameError("Publish the active Exhibition Rename before renaming again.", "pending-rename-evidence", { cause: error }); }
  if (await new HeroAssetPublishEvidenceStore(repositoryRoot).read("exhibitions", input.sourceContentId))
    throw new ExhibitionsRenameError("Publish the pending Exhibition Hero asset before Rename.", "pending-hero-publish-evidence");
  return build(
    repositoryRoot,
    input.sourceContentId,
    input.destinationContentId,
    randomUUID(),
    new Date().toISOString(),
  );
}
export async function executeExhibitionsRename(
  plan: ExhibitionsRenamePlan,
  repositoryRoot = path.resolve("."),
  hooks?: { afterSourceMove?: () => Promise<void> },
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const copy = { ...plan } as any;
  delete copy.planHash;
  if (hashPlan(copy) !== plan.planHash)
    throw new ExhibitionsRenameError("Plan identity invalid", "plan-stale");
  if (await new HeroAssetPublishEvidenceStore(repositoryRoot).read("exhibitions", plan.sourceContentId))
    throw new ExhibitionsRenameError("Publish the pending Exhibition Hero asset before Rename.", "pending-hero-publish-evidence");
  try { await assertNoActiveRenameEvidence(repositoryRoot, "exhibitions", plan.sourceContentId); }
  catch (error) { throw new ExhibitionsRenameError("Publish the active Exhibition Rename before renaming again.", "pending-rename-evidence", { cause: error }); }
  const fresh = await build(
    repositoryRoot,
    plan.sourceContentId,
    plan.destinationContentId,
    plan.operationId,
    plan.createdAt,
  );
  if (
    fresh.graphHash !== plan.graphHash ||
    fresh.repositoryHead !== plan.repositoryHead
  )
    throw new ExhibitionsRenameError("Plan stale", "plan-stale");
  const state = path.join(repositoryRoot, ".kiki-editor/content-lifecycle"),
    lock = path.join(state, "repository.lock"),
    operationRoot = path.join(state, "operations", plan.operationId);
  await fs.mkdir(path.dirname(operationRoot), { recursive: true });
  try {
    await fs.mkdir(lock);
  } catch (error) {
    throw new ExhibitionsRenameError(
      "Lifecycle lock conflict",
      "lifecycle-lock-conflict",
      { cause: error },
    );
  }
  const source = path.join(
      repositoryRoot,
      "src/content/exhibitions",
      plan.sourceContentId,
    ),
    destination = path.join(
      repositoryRoot,
      "src/content/exhibitions",
      plan.destinationContentId,
    );
  let moved = false;
  const preimages: Record<string, { hash: string; bytes: string }> = {},
    prospective: Record<string, { hash: string; bytes: string }> = {};
  try {
    for (const item of [
      ...plan.sourceFiles,
      ...plan.referenceEdits.map((edit) => ({
        file: edit.file,
        hash: edit.sourceHash,
        size: 0,
      })),
    ]) {
      const bytes = await fs.readFile(path.join(repositoryRoot, item.file));
      preimages[item.file] = {
        hash: sha(bytes),
        bytes: bytes.toString("base64"),
      };
    }
    await fs.mkdir(operationRoot, { recursive: true });
    await fs.rename(source, destination);
    moved = true;
    await hooks?.afterSourceMove?.();
    for (const name of names) {
      const old = `src/content/exhibitions/${plan.sourceContentId}/${name}`,
        next = `src/content/exhibitions/${plan.destinationContentId}/${name}`;
      prospective[next] = preimages[old];
    }
    for (const edit of plan.referenceEdits) {
      const file = path.join(repositoryRoot, edit.file),
        bytes = Buffer.from(preimages[edit.file].bytes, "base64"),
        output = Buffer.concat([
          bytes.subarray(0, edit.start),
          Buffer.from(edit.newValue),
          bytes.subarray(edit.end),
        ]);
      await fs.writeFile(file, output);
      prospective[edit.file] = {
        hash: sha(output),
        bytes: output.toString("base64"),
      };
    }
    await fs.writeFile(
      path.join(operationRoot, "operation.json"),
      `${JSON.stringify({ state: "completed", plan, preimages, prospective }, null, 2)}\n`,
    );
    await fs.rm(lock, { recursive: true });
    return {
      draft: createExhibitionsEditorDraft(
        await import("./exhibitions-state.ts").then((m) =>
          m.readExhibitionsEditorEntry(
            plan.destinationContentId,
            path.join(repositoryRoot, "src/content/exhibitions"),
          ),
        ),
      ),
      operationId: plan.operationId,
    };
  } catch (error) {
    try {
      for (const edit of plan.referenceEdits)
        if (preimages[edit.file])
          await fs.writeFile(
            path.join(repositoryRoot, edit.file),
            Buffer.from(preimages[edit.file].bytes, "base64"),
          );
      if (moved) await fs.rename(destination, source);
      await fs.rm(lock, { recursive: true });
    } catch (rollback) {
      throw new ExhibitionsRenameError(
        "Manual recovery required",
        "manual-recovery-required",
        { cause: new AggregateError([error, rollback]) },
      );
    }
    throw new ExhibitionsRenameError(
      "Rename failed and rolled back",
      "rename-failed-rolled-back",
      { cause: error },
    );
  }
}
