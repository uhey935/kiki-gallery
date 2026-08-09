import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import { createWorksEditorDraft } from "./works-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import { readHomeEditorEntry } from "./home-state.ts";
import { readJournalEditorState } from "./journal-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import { readWorksAssetInventory } from "./works-assets.ts";
import {
  acquireWorksAssetRepositoryLock,
  assertWorksAssetRepositoryLock,
  releaseWorksAssetRepositoryLock,
  type RepositoryLock,
} from "./works-asset-repository-lock.ts";

const execFile = promisify(execFileCallback);
const COLLECTIONS = [
  "artists",
  "works",
  "exhibitions",
  "news",
  "home",
  "journal",
] as const;
const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const rel = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

export type WorksReferenceEdit = {
  collection: "artists" | "exhibitions";
  contentId: string;
  file: string;
  fieldPath: string;
  oldValue: string;
  newValue: string;
  sourceHash: string;
  resultingHash: string;
  start: number;
  end: number;
};

export type WorksRenamePlan = {
  schemaVersion: 1;
  adapterVersion: "works-typed-reference-v1";
  operation: "works-rename";
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
  referenceEdits: WorksReferenceEdit[];
  touchedPaths: string[];
  publishPaths: string[];
  assetInventory: Array<{
    publicUrl: string;
    sha256: string;
    byteSize: number;
    format: string;
    references: Array<{ contentId: string; imageIndex: number }>;
  }>;
  assetGraphHash: string;
  lifecycleEvidenceHash: string;
  assetPathChanges: [];
  assetByteChanges: [];
  lifecycleEvidenceChanges: [];
  planHash: string;
};

export class WorksRenameError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "destination-conflict"
    | "reference-graph-incomplete"
    | "reference-rewrite-unsupported"
    | "prospective-validation-failed"
    | "plan-stale"
    | "pending-asset-state"
    | "unpublished-asset-manifest"
    | "lifecycle-lock-conflict"
    | "unsafe-repository"
    | "rename-failed-rolled-back"
    | "manual-recovery-required";
  constructor(
    message: string,
    code: WorksRenameError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksRenameError";
    this.code = code;
  }
}

const planHash = (value: Omit<WorksRenamePlan, "planHash">) =>
  sha256(JSON.stringify(value));

async function safeDirectory(
  directory: string,
  code: WorksRenameError["code"],
) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new WorksRenameError(`Unsafe directory: ${resolved}`, code);
  return resolved;
}

async function ensureDirectory(parent: string, name: string) {
  const directory = path.join(parent, name);
  let stat = await fs.lstat(directory).catch(() => undefined);
  if (!stat) {
    await fs.mkdir(directory, { mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new WorksRenameError(
      "Editor lifecycle evidence path is unsafe.",
      "unsafe-repository",
    );
  return directory;
}

async function repositoryIdentity(root: string) {
  try {
    const repositoryRealpath = await fs.realpath(root);
    const git = async (args: string[]) =>
      (
        await execFile("git", args, {
          cwd: repositoryRealpath,
          encoding: "utf8",
        })
      ).stdout.trim();
    if (
      (await fs.realpath(await git(["rev-parse", "--show-toplevel"]))) !==
      repositoryRealpath
    )
      throw new Error("root mismatch");
    const repositoryHead = await git(["rev-parse", "HEAD"]);
    const repositoryBranch = await git([
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    const repositoryUpstream = await git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (!repositoryUpstream.endsWith(`/${repositoryBranch}`))
      throw new Error("upstream mismatch");
    return {
      repositoryRealpath,
      repositoryHead,
      repositoryBranch,
      repositoryUpstream,
    };
  } catch (error) {
    throw new WorksRenameError(
      "Rename requires the exact repository root on a branch with a matching upstream.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function walk(root: string, relativeRoot: string, extensions?: RegExp) {
  const base = await safeDirectory(
    path.join(root, relativeRoot),
    "reference-graph-incomplete",
  );
  const result: Array<{ file: string; bytes: Buffer }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new WorksRenameError(
          `Inventory encountered a symlink: ${rel(root, file)}`,
          "reference-graph-incomplete",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && (!extensions || extensions.test(entry.name)))
        result.push({ file, bytes: await fs.readFile(file) });
      else if (!entry.isFile())
        throw new WorksRenameError(
          `Unsupported canonical entry: ${rel(root, file)}`,
          "reference-graph-incomplete",
        );
    }
  };
  await visit(base);
  return result;
}

async function canonicalInventory(root: string) {
  const all: Array<{ file: string; bytes: Buffer }> = [];
  for (const collection of COLLECTIONS)
    all.push(
      ...(await walk(root, `src/content/${collection}`, /\.(md|ya?ml)$/)),
    );
  return all.sort((a, b) => a.file.localeCompare(b.file));
}

async function lifecycleHash(root: string) {
  const state = path.join(root, ".kiki-editor/asset-lifecycle");
  const stat = await fs.lstat(state).catch(() => undefined);
  if (!stat) return sha256("absent");
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new WorksRenameError(
      "Asset lifecycle state is unsafe.",
      "unsafe-repository",
    );
  const entries = (await walk(root, ".kiki-editor/asset-lifecycle")).filter(
    ({ file }) =>
      !rel(root, file).startsWith(
        ".kiki-editor/asset-lifecycle/repository.lock/",
      ),
  );
  if (entries.length === 0) return sha256("absent");
  for (const { file, bytes } of entries) {
    const relative = rel(root, file);
    if (relative.includes("/deletion-manifests/")) {
      let value: { state?: string };
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new WorksRenameError(
          "Deletion evidence is corrupt.",
          "manual-recovery-required",
        );
      }
      if (
        value.state === "prepared" ||
        value.state === "manual-recovery-required"
      )
        throw new WorksRenameError(
          "Asset deletion requires recovery before Rename.",
          "manual-recovery-required",
        );
    }
    if (relative.includes("/quarantine/records/")) {
      let value: { state?: string };
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        throw new WorksRenameError(
          "Quarantine evidence is corrupt.",
          "manual-recovery-required",
        );
      }
      if (!value.state)
        throw new WorksRenameError(
          "Quarantine evidence is incomplete.",
          "manual-recovery-required",
        );
    }
  }
  return sha256(
    entries
      .map(({ file, bytes }) => `${rel(root, file)}\0${sha256(bytes)}`)
      .join("\n"),
  );
}

function frontmatter(item: { file: string; bytes: Buffer }, root: string) {
  const raw = item.bytes.toString("utf8");
  const match = /^---(\r?\n)([\s\S]*?)\1---(?:\1|$)/.exec(raw);
  if (!match)
    throw new WorksRenameError(
      `Frontmatter cannot be inventoried: ${rel(root, item.file)}`,
      "reference-graph-incomplete",
    );
  return { raw, body: match[2], bodyStart: match.index + 3 + match[1].length };
}

function referenceEdits(
  root: string,
  item: { file: string; bytes: Buffer },
  oldId: string,
  newId: string,
): WorksReferenceEdit[] {
  const file = rel(root, item.file);
  if (
    !file.startsWith("src/content/artists/") &&
    !file.startsWith("src/content/exhibitions/")
  )
    return [];
  const { raw, body, bodyStart } = frontmatter(item, root);
  const edits: WorksReferenceEdit[] = [];
  const lines = body.split(/(?<=\n)/);
  let offset = 0;
  let section: "artist" | "exhibition" | null = null;
  let sectionIndex = -1;
  let workIndex = 0;
  for (const line of lines) {
    if (file.startsWith("src/content/artists/")) {
      if (/^works_layout\s*:/.test(line)) section = "artist";
      else if (section && /^\S/.test(line)) section = null;
      if (section && /^\s*-\s*works\s*:/.test(line)) {
        sectionIndex += 1;
        workIndex = 0;
      }
    } else {
      if (/^works\s*:/.test(line)) {
        section = "exhibition";
        workIndex = 0;
      } else if (section && /^\S/.test(line)) section = null;
    }
    if (section) {
      const match = /^(\s*-\s*)(["']?)([^\s#"']+)(\2)(\s*(?:#.*)?\r?\n?)$/.exec(
        line,
      );
      if (match && match[3] === oldId) {
        const character =
          bodyStart + offset + match[1].length + match[2].length;
        const start = Buffer.byteLength(raw.slice(0, character));
        edits.push({
          collection: section === "artist" ? "artists" : "exhibitions",
          contentId: path.basename(file, ".md"),
          file,
          fieldPath:
            section === "artist"
              ? `works_layout[${sectionIndex}].works[${workIndex}]`
              : `works[${workIndex}]`,
          oldValue: oldId,
          newValue: newId,
          sourceHash: sha256(item.bytes),
          resultingHash: "",
          start,
          end: start + Buffer.byteLength(oldId),
        });
      }
      if (match) workIndex += 1;
    }
    offset += line.length;
  }
  return edits;
}

function rewrite(bytes: Buffer, edits: WorksReferenceEdit[]) {
  if (!edits.length || sha256(bytes) !== edits[0].sourceHash)
    throw new WorksRenameError("Reference bytes changed.", "plan-stale");
  let output = bytes;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (bytes.subarray(edit.start, edit.end).toString("utf8") !== edit.oldValue)
      throw new WorksRenameError(
        `Reference span mismatch: ${edit.file}`,
        "reference-rewrite-unsupported",
      );
    output = Buffer.concat([
      output.subarray(0, edit.start),
      Buffer.from(edit.newValue),
      output.subarray(edit.end),
    ]);
  }
  if (edits.some((edit) => edit.resultingHash !== sha256(output)))
    throw new WorksRenameError(
      "Reference rewrite proof failed.",
      "reference-rewrite-unsupported",
    );
  return output;
}

async function validateGraph(root: string, oldId: string, newId: string) {
  const works = new Set(
    (await fs.readdir(path.join(root, "src/content/works")))
      .filter((x) => x.endsWith(".md"))
      .map((x) => path.basename(x, ".md")),
  );
  works.delete(oldId);
  works.add(newId);
  for (const name of await fs.readdir(path.join(root, "src/content/artists")))
    if (name.endsWith(".md")) {
      const id = path.basename(name, ".md");
      const entry = await readArtistsEditorEntry(
        id,
        path.join(root, "src/content/artists"),
      );
      if (
        entry.structuralStatus !== "valid" ||
        entry.data?.works_layout?.some((s) =>
          s.works.some((w) => !works.has(w.id === oldId ? newId : w.id)),
        )
      )
        throw new WorksRenameError(
          `Invalid Artist Work graph: ${id}`,
          "prospective-validation-failed",
        );
    }
  for (const name of await fs.readdir(
    path.join(root, "src/content/exhibitions"),
  ))
    if (name.endsWith(".md")) {
      const id = path.basename(name, ".md");
      const entry = await readExhibitionsEditorEntry(
        id,
        path.join(root, "src/content/exhibitions"),
      );
      if (
        entry.structuralStatus !== "valid" ||
        entry.data?.works?.some(
          (w) => !works.has(w.id === oldId ? newId : w.id),
        )
      )
        throw new WorksRenameError(
          `Invalid Exhibition Work graph: ${id}`,
          "prospective-validation-failed",
        );
    }
  for (const name of await fs.readdir(path.join(root, "src/content/news")))
    if (name.endsWith(".md")) {
      const id = path.basename(name, ".md");
      const entry = await readNewsEditorEntry(
        id,
        path.join(root, "src/content/news"),
      );
      if (entry.structuralStatus !== "valid")
        throw new WorksRenameError(
          `Invalid News blocks the prospective graph: ${id}`,
          "reference-graph-incomplete",
        );
    }
  if (
    (await readHomeEditorEntry(path.join(root, "src/content/home")))
      .structuralStatus !== "valid"
  )
    throw new WorksRenameError(
      "Invalid Home blocks the prospective graph.",
      "reference-graph-incomplete",
    );
  await readJournalEditorState(path.join(root, "src/content/journal"));
}

async function buildPlan(input: {
  repositoryRoot: string;
  sourceContentId: string;
  destinationContentId: string;
  operationId: string;
  createdAt: string;
}) {
  const root = path.resolve(input.repositoryRoot);
  const identity = await repositoryIdentity(root);
  const worksRoot = await safeDirectory(
    path.join(root, "src/content/works"),
    "unsafe-repository",
  );
  const source = path.join(worksRoot, `${input.sourceContentId}.md`);
  const sourceStat = await fs.lstat(source).catch(() => undefined);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink())
    throw new WorksRenameError(
      "Work source is missing or unsafe.",
      "source-unavailable",
    );
  const entry = await readWorksEditorEntry(input.sourceContentId, worksRoot);
  if (entry.structuralStatus !== "valid")
    throw new WorksRenameError(
      "Fix Work validation issues first.",
      "source-unavailable",
    );
  const destinationName = `${input.destinationContentId}.md`.toLocaleLowerCase(
    "en-US",
  );
  if (
    (await fs.readdir(worksRoot)).some(
      (name) => name.toLocaleLowerCase("en-US") === destinationName,
    )
  )
    throw new WorksRenameError(
      "The destination Work ID or case-fold equivalent already exists.",
      "destination-conflict",
    );
  const inventory = await canonicalInventory(root);
  await validateGraph(root, input.sourceContentId, input.destinationContentId);
  const edits = inventory.flatMap((item) =>
    referenceEdits(
      root,
      item,
      input.sourceContentId,
      input.destinationContentId,
    ),
  );
  for (const file of new Set(edits.map((e) => e.file))) {
    const item = inventory.find(
      (candidate) => rel(root, candidate.file) === file,
    )!;
    let output = item.bytes;
    for (const edit of [...edits.filter((e) => e.file === file)].sort(
      (a, b) => b.start - a.start,
    ))
      output = Buffer.concat([
        output.subarray(0, edit.start),
        Buffer.from(edit.newValue),
        output.subarray(edit.end),
      ]);
    for (const edit of edits.filter((e) => e.file === file))
      edit.resultingHash = sha256(output);
  }
  const oldToken = `/works/${input.sourceContentId}`;
  const oldRoutePattern = new RegExp(
    `(?<!/images)${oldToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?(?=[\\s\"')\\]}>?#]|$)`,
  );
  for (const item of inventory) {
    const file = rel(root, item.file);
    const text = item.bytes.toString("utf8");
    if (oldRoutePattern.test(text))
      throw new WorksRenameError(
        `Unsupported incoming Work route: ${file}`,
        "reference-rewrite-unsupported",
      );
    if (
      (file.startsWith("src/content/artists/") ||
        file.startsWith("src/content/exhibitions/")) &&
      text.includes(input.sourceContentId) &&
      !edits.some((e) => e.file === file)
    )
      throw new WorksRenameError(
        `Unresolved Work reference: ${file}`,
        "reference-graph-incomplete",
      );
  }
  const assets = await readWorksAssetInventory(
    path.join(root, "public/images/works"),
    worksRoot,
  ).catch((error) => {
    throw new WorksRenameError(
      "Works asset root or inventory is unsafe.",
      "reference-graph-incomplete",
      { cause: error },
    );
  });
  if (!assets.referenceGraphComplete || assets.audit.length)
    throw new WorksRenameError(
      "Works asset graph is incomplete.",
      "reference-graph-incomplete",
    );
  const assetInventory = assets.assets.map((a) => ({
    publicUrl: a.publicUrl,
    sha256: a.sha256,
    byteSize: a.byteSize,
    format: a.format,
    references: [...a.references].sort((x, y) =>
      `${x.contentId}:${x.imageIndex}`.localeCompare(
        `${y.contentId}:${y.imageIndex}`,
      ),
    ),
  }));
  const lifecycleEvidenceHash = await lifecycleHash(root);
  const sourceBytes = await fs.readFile(source);
  const sourceFile = {
    file: rel(root, source),
    hash: sha256(sourceBytes),
    size: sourceBytes.length,
  };
  const newFile = `src/content/works/${input.destinationContentId}.md`;
  const touchedPaths = [
    sourceFile.file,
    newFile,
    ...new Set(edits.map((e) => e.file)),
  ].sort();
  const body: Omit<WorksRenamePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: "works-typed-reference-v1",
    operation: "works-rename",
    operationId: input.operationId,
    createdAt: input.createdAt,
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    oldRoutes: [`${oldToken}/`],
    newRoutes: [`/works/${input.destinationContentId}/`],
    ...identity,
    graphHash: sha256(
      inventory
        .map(({ file, bytes }) => `${rel(root, file)}\0${sha256(bytes)}`)
        .join("\n"),
    ),
    sourceFile,
    referenceEdits: edits,
    touchedPaths,
    publishPaths: touchedPaths,
    assetInventory,
    assetGraphHash: sha256(JSON.stringify(assetInventory)),
    lifecycleEvidenceHash,
    assetPathChanges: [],
    assetByteChanges: [],
    lifecycleEvidenceChanges: [],
  };
  return { ...body, planHash: planHash(body) };
}

export async function planWorksRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
  pendingAssetState?: boolean;
  unpublishedAssetCount?: number;
}): Promise<WorksRenamePlan> {
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new WorksRenameError(
      "Source and new Work IDs must be different lowercase hyphenated IDs.",
      "invalid-content-id",
    );
  if (input.pendingAssetState)
    throw new WorksRenameError(
      "Finish or abandon pending asset changes before Rename.",
      "pending-asset-state",
    );
  if ((input.unpublishedAssetCount ?? 0) > 0)
    throw new WorksRenameError(
      "Publish or reconcile the unpublished asset manifest before Rename.",
      "unpublished-asset-manifest",
    );
  return buildPlan({
    repositoryRoot: path.resolve(input.repositoryRoot ?? "."),
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    operationId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

const comparable = (plan: WorksRenamePlan) => {
  const value = { ...plan } as Partial<WorksRenamePlan>;
  delete value.planHash;
  delete value.operationId;
  delete value.createdAt;
  return sha256(JSON.stringify(value));
};

export async function executeWorksRename(
  reviewed: WorksRenamePlan,
  repositoryRoot = path.resolve("."),
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const supplied = { ...reviewed } as Partial<WorksRenamePlan>;
  delete supplied.planHash;
  if (
    reviewed.planHash !==
    planHash(supplied as Omit<WorksRenamePlan, "planHash">)
  )
    throw new WorksRenameError(
      "Rename plan identity is invalid.",
      "plan-stale",
    );
  const state = await ensureDirectory(repositoryRoot, ".kiki-editor");
  const lifecycle = await ensureDirectory(state, "content-lifecycle");
  const operations = await ensureDirectory(lifecycle, "operations");
  const contentLock = path.join(lifecycle, "repository.lock");
  try {
    await fs.mkdir(contentLock);
  } catch (error) {
    throw new WorksRenameError(
      "Another content lifecycle operation is active or requires recovery.",
      "lifecycle-lock-conflict",
      { cause: error },
    );
  }
  let assetLock: RepositoryLock | undefined;
  let mutation = false;
  let record: any;
  const operationRoot = path.join(operations, reviewed.operationId);
  try {
    await fs.writeFile(
      path.join(contentLock, "owner.json"),
      `${JSON.stringify({ operationId: reviewed.operationId, pid: process.pid })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    try {
      assetLock = await acquireWorksAssetRepositoryLock(
        repositoryRoot,
        new Date().toISOString(),
      );
    } catch (error) {
      throw new WorksRenameError(
        "Asset lifecycle mutation is active or requires recovery.",
        "lifecycle-lock-conflict",
        { cause: error },
      );
    }
    const rebuilt = await buildPlan({
      repositoryRoot,
      sourceContentId: reviewed.sourceContentId,
      destinationContentId: reviewed.destinationContentId,
      operationId: reviewed.operationId,
      createdAt: reviewed.createdAt,
    });
    if (comparable(reviewed) !== comparable(rebuilt))
      throw new WorksRenameError(
        "Canonical content, assets, lifecycle evidence, references, destination, or Git identity changed; review a new plan.",
        "plan-stale",
      );
    await fs.mkdir(operationRoot, { mode: 0o700 });
    const recovery = await ensureDirectory(operationRoot, "recovery");
    const staged = await ensureDirectory(operationRoot, "staged");
    const preimages: Record<
      string,
      { hash: string; mode: number; bytes: string }
    > = {};
    const prospective: Record<
      string,
      { hash: string; mode: number; bytes: string }
    > = {};
    for (const file of reviewed.touchedPaths.filter(
      (f) => f !== `src/content/works/${reviewed.destinationContentId}.md`,
    )) {
      const absolute = path.join(repositoryRoot, file);
      const stat = await fs.lstat(absolute);
      const bytes = await fs.readFile(absolute);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new WorksRenameError(
          `Touched path became unsafe: ${file}`,
          "plan-stale",
        );
      preimages[file] = {
        hash: sha256(bytes),
        mode: stat.mode,
        bytes: bytes.toString("base64"),
      };
    }
    const sourceBytes = Buffer.from(
      preimages[reviewed.sourceFile.file].bytes,
      "base64",
    );
    const newFile = `src/content/works/${reviewed.destinationContentId}.md`;
    prospective[newFile] = {
      hash: sha256(sourceBytes),
      mode: preimages[reviewed.sourceFile.file].mode,
      bytes: sourceBytes.toString("base64"),
    };
    for (const file of new Set(reviewed.referenceEdits.map((e) => e.file))) {
      const bytes = Buffer.from(preimages[file].bytes, "base64");
      const output = rewrite(
        bytes,
        reviewed.referenceEdits.filter((e) => e.file === file),
      );
      prospective[file] = {
        hash: sha256(output),
        mode: preimages[file].mode,
        bytes: output.toString("base64"),
      };
    }
    record = {
      schemaVersion: 1,
      operation: "works-rename",
      state: "prepared",
      plan: reviewed,
      assetLockIdentity: assetLock.identity,
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
      const h = await fs.open(recordPath, "r");
      await h.sync();
      await h.close();
    };
    for (const [file, value] of Object.entries(prospective))
      await fs.writeFile(
        path.join(staged, file.replaceAll("/", "__")),
        Buffer.from(value.bytes, "base64"),
        { flag: "wx", mode: value.mode },
      );
    await writeRecord();
    await assertWorksAssetRepositoryLock(repositoryRoot, assetLock.identity);
    mutation = true;
    for (const file of Object.keys(preimages).sort()) {
      await fs.rename(
        path.join(repositoryRoot, file),
        path.join(recovery, file.replaceAll("/", "__")),
      );
      record.completedSteps.push(`recover:${file}`);
      await writeRecord();
    }
    for (const file of Object.keys(prospective).sort()) {
      await fs.rename(
        path.join(staged, file.replaceAll("/", "__")),
        path.join(repositoryRoot, file),
      );
      record.completedSteps.push(`install:${file}`);
      await writeRecord();
    }
    await validateGraph(
      repositoryRoot,
      "__old_absent__",
      reviewed.destinationContentId,
    );
    const installedAssets = await readWorksAssetInventory(
      path.join(repositoryRoot, "public/images/works"),
      path.join(repositoryRoot, "src/content/works"),
    );
    const installedAssetInventory = installedAssets.assets.map((a) => ({
      publicUrl: a.publicUrl,
      sha256: a.sha256,
      byteSize: a.byteSize,
      format: a.format,
      references: a.references
        .map((r) => ({
          ...r,
          contentId:
            r.contentId === reviewed.destinationContentId
              ? reviewed.sourceContentId
              : r.contentId,
        }))
        .sort((x, y) =>
          `${x.contentId}:${x.imageIndex}`.localeCompare(
            `${y.contentId}:${y.imageIndex}`,
          ),
        ),
    }));
    if (
      sha256(JSON.stringify(installedAssetInventory)) !==
      reviewed.assetGraphHash
    )
      throw new WorksRenameError(
        "Asset inventory changed during Rename.",
        "prospective-validation-failed",
      );
    if (
      (await lifecycleHash(repositoryRoot)) !== reviewed.lifecycleEvidenceHash
    )
      throw new WorksRenameError(
        "Lifecycle evidence changed during Rename.",
        "prospective-validation-failed",
      );
    const draft = createWorksEditorDraft(
      await readWorksEditorEntry(
        reviewed.destinationContentId,
        path.join(repositoryRoot, "src/content/works"),
      ),
    );
    if (!draft)
      throw new WorksRenameError(
        "Renamed workspace is invalid.",
        "prospective-validation-failed",
      );
    record.state = "completed";
    record.updatedAt = new Date().toISOString();
    await writeRecord();
    await releaseWorksAssetRepositoryLock(repositoryRoot, assetLock.identity);
    assetLock = undefined;
    await fs.rm(contentLock, { recursive: true });
    return {
      draft,
      operationId: reviewed.operationId,
      renameEvidence: {
        operationId: reviewed.operationId,
        planHash: reviewed.planHash,
      },
      state: "saved-unpublished" as const,
    };
  } catch (error) {
    if (mutation && record)
      try {
        for (const [file, expected] of Object.entries(
          record.prospective as Record<string, { hash: string }>,
        ).reverse()) {
          const target = path.join(repositoryRoot, file);
          const stat = await fs.lstat(target).catch(() => undefined);
          if (stat) {
            if (
              !stat.isFile() ||
              sha256(await fs.readFile(target)) !== expected.hash
            )
              throw new Error(`installed mismatch: ${file}`);
            await fs.rm(target);
          }
        }
        for (const [file, expected] of Object.entries(
          record.preimages as Record<
            string,
            { hash: string; mode: number; bytes: string }
          >,
        )) {
          const bytes = Buffer.from(expected.bytes, "base64");
          await fs.writeFile(path.join(repositoryRoot, file), bytes, {
            flag: "wx",
            mode: expected.mode,
          });
          if (
            sha256(await fs.readFile(path.join(repositoryRoot, file))) !==
            expected.hash
          )
            throw new Error(`rollback mismatch: ${file}`);
        }
        record.state = "rolled-back";
        record.failure =
          error instanceof Error ? error.message : "Rename failed";
        record.updatedAt = new Date().toISOString();
        await fs.writeFile(
          path.join(operationRoot, "operation.json"),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        if (
          (await lifecycleHash(repositoryRoot)) !==
          reviewed.lifecycleEvidenceHash
        )
          throw new Error("lifecycle evidence drift");
        throw new WorksRenameError(
          "Works Rename failed; every touched canonical byte was restored.",
          "rename-failed-rolled-back",
          { cause: error },
        );
      } catch (rollbackError) {
        if (rollbackError instanceof WorksRenameError) throw rollbackError;
        throw new WorksRenameError(
          "Works Rename rollback could not be proven; preserve both locks and evidence.",
          "manual-recovery-required",
          { cause: rollbackError },
        );
      }
    throw error;
  } finally {
    if (assetLock)
      await releaseWorksAssetRepositoryLock(
        repositoryRoot,
        assetLock.identity,
      ).catch(() => undefined);
    await fs.rm(contentLock, { recursive: true }).catch(() => undefined);
  }
}
