import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { isContentId } from "./content-id.ts";
import { createArtistsEditorDraft } from "./artists-draft-state.ts";
import { readArtistsEditorEntry } from "./artists-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import {
  findNewsReferenceSpan,
  NewsReferenceStructureError,
} from "./news-reference-update.ts";
import { HeroAssetPublishEvidenceStore } from "./hero-asset-publish-evidence.ts";
import { assertNoActiveRenameEvidence } from "./content-rename-evidence-lifecycle.ts";

const execFile = promisify(execFileCallback);
const CONTENT_COLLECTIONS = [
  "artists",
  "works",
  "exhibitions",
  "news",
  "home",
  "journal",
] as const;

export type ArtistReferenceEdit = {
  collection: "works" | "exhibitions" | "news";
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

export type ArtistsRenamePlan = {
  schemaVersion: 1;
  adapterVersion: "artist-typed-reference-v1";
  operation: "artists-rename";
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
  sourceFiles: { file: string; hash: string; size: number }[];
  referenceEdits: ArtistReferenceEdit[];
  touchedPaths: string[];
  publishPaths: string[];
  unchanged: string[];
  planHash: string;
};

export class ArtistsRenameError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "destination-conflict"
    | "reference-graph-incomplete"
    | "reference-rewrite-unsupported"
    | "prospective-validation-failed"
    | "plan-stale"
    | "lifecycle-lock-conflict"
    | "pending-hero-publish-evidence"
    | "pending-rename-evidence"
    | "unsafe-repository"
    | "rename-failed-rolled-back"
    | "manual-recovery-required";

  constructor(
    message: string,
    code: ArtistsRenameError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtistsRenameError";
    this.code = code;
  }
}

const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const hashPlan = (value: Omit<ArtistsRenamePlan, "planHash">) =>
  sha256(JSON.stringify(value));
const relative = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

async function safeDirectory(
  directory: string,
  code: ArtistsRenameError["code"],
) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new ArtistsRenameError(`Unsafe directory: ${resolved}`, code);
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
    throw new ArtistsRenameError(
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
    throw new ArtistsRenameError(
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
          throw new ArtistsRenameError(
            `Reference inventory encountered a symlink: ${relative(repositoryRoot, file)}`,
            "reference-graph-incomplete",
          );
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) {
          if (!/\.(md|ya?ml)$/.test(entry.name))
            throw new ArtistsRenameError(
              `Unsupported canonical file: ${relative(repositoryRoot, file)}`,
              "reference-graph-incomplete",
            );
          inventory.push({ file, bytes: await fs.readFile(file) });
        } else
          throw new ArtistsRenameError(
            `Unsupported canonical entry: ${relative(repositoryRoot, file)}`,
            "reference-graph-incomplete",
          );
      }
    };
    await visit(root);
  }
  return inventory.sort((a, b) => a.file.localeCompare(b.file));
}

async function validateProspectiveTypedGraph(
  repositoryRoot: string,
  inventory: Array<{ file: string; bytes: Buffer }>,
  oldId: string,
  newId: string,
) {
  const ids = (collection: string) =>
    new Set(
      inventory
        .map(({ file }) => relative(repositoryRoot, file))
        .filter((file) =>
          collection === "artists" || collection === "news"
            ? file.startsWith(`src/content/${collection}/`) &&
              file.endsWith("/index.yaml")
            : path.posix.dirname(file) === `src/content/${collection}` &&
              file.endsWith(".md"),
        )
        .map((file) =>
          collection === "artists" || collection === "news"
            ? path.posix.basename(path.posix.dirname(file))
            : path.basename(file, ".md"),
        ),
    );
  const artistIds = ids("artists");
  artistIds.delete(oldId);
  artistIds.add(newId);
  const workIds = ids("works");
  for (const workId of workIds) {
    const entry = await readWorksEditorEntry(
      workId,
      path.join(repositoryRoot, "src/content/works"),
    );
    if (entry.structuralStatus !== "valid" || !entry.data)
      throw new ArtistsRenameError(
        `Invalid Work blocks the reference graph: ${workId}`,
        "reference-graph-incomplete",
      );
    const owner = entry.data.artist.id === oldId ? newId : entry.data.artist.id;
    if (!artistIds.has(owner))
      throw new ArtistsRenameError(
        `Work references missing Artist: ${workId}`,
        "prospective-validation-failed",
      );
  }
  for (const exhibitionId of ids("exhibitions")) {
    const entry = await readExhibitionsEditorEntry(
      exhibitionId,
      path.join(repositoryRoot, "src/content/exhibitions"),
    );
    if (entry.structuralStatus !== "valid" || !entry.data)
      throw new ArtistsRenameError(
        `Invalid Exhibition blocks the reference graph: ${exhibitionId}`,
        "reference-graph-incomplete",
      );
    const prospectiveArtists = entry.data.artists.map((reference) =>
      reference.id === oldId ? newId : reference.id,
    );
    if (
      new Set(prospectiveArtists).size !== prospectiveArtists.length ||
      prospectiveArtists.some((id) => !artistIds.has(id))
    )
      throw new ArtistsRenameError(
        `Exhibition Artist graph is invalid: ${exhibitionId}`,
        "prospective-validation-failed",
      );
    if (
      (entry.data.works ?? []).some((reference) => !workIds.has(reference.id))
    )
      throw new ArtistsRenameError(
        `Exhibition Work graph is invalid: ${exhibitionId}`,
        "prospective-validation-failed",
      );
  }
  for (const newsId of ids("news")) {
    const entry = await readNewsEditorEntry(
      newsId,
      path.join(repositoryRoot, "src/content/news"),
    );
    if (entry.structuralStatus !== "valid")
      throw new ArtistsRenameError(
        `Invalid News blocks the reference graph: ${newsId}`,
        "reference-graph-incomplete",
      );
  }
}

function spanEdit(
  repositoryRoot: string,
  item: { file: string; bytes: Buffer },
  collection: ArtistReferenceEdit["collection"],
  fieldPath: string,
  startCharacter: number,
  oldValue: string,
  newValue: string,
): ArtistReferenceEdit {
  const raw = item.bytes.toString("utf8");
  const start = Buffer.byteLength(raw.slice(0, startCharacter));
  return {
    collection,
    contentId: item.file.endsWith("/index.yaml")
      ? path.basename(path.dirname(item.file))
      : path.basename(item.file, ".md"),
    file: relative(repositoryRoot, item.file),
    fieldPath,
    oldValue,
    newValue,
    sourceHash: sha256(item.bytes),
    resultingHash: "",
    start,
    end: start + Buffer.byteLength(oldValue),
  };
}

function typedReferenceEdits(
  repositoryRoot: string,
  item: { file: string; bytes: Buffer },
  oldId: string,
  newId: string,
): ArtistReferenceEdit[] {
  const file = relative(repositoryRoot, item.file);
  const raw = item.bytes.toString("utf8");
  const frontmatter = /^---(\r?\n)([\s\S]*?)\1---(?:\1|$)/.exec(raw);
  if (
    !file.startsWith("src/content/works/") &&
    !file.startsWith("src/content/exhibitions/")
  )
    return [];
  if (
    file.startsWith("src/content/exhibitions/") &&
    !file.endsWith("/index.yaml")
  )
    return [];
  if (file.startsWith("src/content/works/") && !file.endsWith("/index.yaml"))
    return [];
  const body = file.endsWith("/index.yaml") ? raw : frontmatter![2];
  const bodyStart = file.endsWith("/index.yaml")
    ? 0
    : frontmatter!.index + 3 + frontmatter![1].length;
  if (file.startsWith("src/content/works/")) {
    const expression =
      /^(\s*artist\s*:\s*)(["']?)([^\s#"']+)(\2)(\s*(?:#.*)?)$/gm;
    const matches = [...body.matchAll(expression)].filter(
      (match) => match[3] === oldId,
    );
    if (body.includes(oldId) && matches.length !== 1)
      throw new ArtistsRenameError(
        `Work artist cannot be byte-preservingly inventoried: ${file}`,
        "reference-rewrite-unsupported",
      );
    return matches.map((match) =>
      spanEdit(
        repositoryRoot,
        item,
        "works",
        "artist",
        bodyStart + match.index! + match[1].length + match[2].length,
        oldId,
        newId,
      ),
    );
  }
  const lines = body.split(/(?<=\n)/);
  let offset = 0;
  let inArtists = false;
  let index = 0;
  const edits: ArtistReferenceEdit[] = [];
  for (const line of lines) {
    if (/^artists\s*:\s*(?:#.*)?\r?\n?$/.test(line)) inArtists = true;
    else if (inArtists && /^\S/.test(line)) inArtists = false;
    else if (inArtists) {
      const match = /^(\s*-\s*)(["']?)([^\s#"']+)(\2)(\s*(?:#.*)?\r?\n?)$/.exec(
        line,
      );
      if (match) {
        if (match[3] === oldId)
          edits.push(
            spanEdit(
              repositoryRoot,
              item,
              "exhibitions",
              `artists[${index}]`,
              bodyStart + offset + match[1].length + match[2].length,
              oldId,
              newId,
            ),
          );
        index++;
      }
    }
    offset += line.length;
  }
  return edits;
}

function newsLinkEdit(
  repositoryRoot: string,
  item: { file: string; bytes: Buffer },
  oldId: string,
  newId: string,
): ArtistReferenceEdit | undefined {
  const file = relative(repositoryRoot, item.file);
  let span;
  try {
    span = findNewsReferenceSpan(file, item.bytes, "artists", oldId, newId);
  } catch (error) {
    if (error instanceof NewsReferenceStructureError)
      throw new ArtistsRenameError(
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

function rewriteReferences(bytes: Buffer, edits: ArtistReferenceEdit[]) {
  if (!edits.length || sha256(bytes) !== edits[0].sourceHash)
    throw new ArtistsRenameError(
      `Reference bytes changed: ${edits[0]?.file}`,
      "plan-stale",
    );
  let output = bytes;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (bytes.subarray(edit.start, edit.end).toString("utf8") !== edit.oldValue)
      throw new ArtistsRenameError(
        `Reference span no longer matches: ${edit.file}`,
        "reference-rewrite-unsupported",
      );
    output = Buffer.concat([
      output.subarray(0, edit.start),
      Buffer.from(edit.newValue),
      output.subarray(edit.end),
    ]);
  }
  if (edits.some((edit) => sha256(output) !== edit.resultingHash))
    throw new ArtistsRenameError(
      `Reference rewrite proof failed: ${edits[0].file}`,
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
  const artistsRoot = await safeDirectory(
    path.join(repositoryRoot, "src/content/artists"),
    "unsafe-repository",
  );
  const source = path.join(artistsRoot, input.sourceContentId);
  const sourceStat = await fs.lstat(source).catch(() => undefined);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink())
    throw new ArtistsRenameError(
      "Artist source is missing or unsafe.",
      "source-unavailable",
    );
  const destinationName = input.destinationContentId.toLocaleLowerCase("en-US");
  if (
    (await fs.readdir(artistsRoot)).some((name) =>
      [destinationName, `${destinationName}.md`].includes(
        name.toLocaleLowerCase("en-US"),
      ),
    )
  )
    throw new ArtistsRenameError(
      "The destination Artist ID or case-fold equivalent already exists.",
      "destination-conflict",
    );
  const entry = await readArtistsEditorEntry(
    input.sourceContentId,
    artistsRoot,
  ).catch((error) => {
    throw new ArtistsRenameError(
      "Artist source failed canonical validation.",
      "source-unavailable",
      { cause: error },
    );
  });
  if (entry.structuralStatus !== "valid")
    throw new ArtistsRenameError(
      "Fix Artist validation issues first.",
      "source-unavailable",
    );
  const inventory = await walkCanonical(repositoryRoot);
  await validateProspectiveTypedGraph(
    repositoryRoot,
    inventory,
    input.sourceContentId,
    input.destinationContentId,
  );
  const edits = inventory.flatMap((item) => {
    const typed = typedReferenceEdits(
      repositoryRoot,
      item,
      input.sourceContentId,
      input.destinationContentId,
    );
    const news = newsLinkEdit(
      repositoryRoot,
      item,
      input.sourceContentId,
      input.destinationContentId,
    );
    return news ? [...typed, news] : typed;
  });
  for (const file of new Set(edits.map((edit) => edit.file))) {
    const item = inventory.find(
      (candidate) => relative(repositoryRoot, candidate.file) === file,
    )!;
    const fileEdits = edits.filter((edit) => edit.file === file);
    let output = item.bytes;
    for (const edit of [...fileEdits].sort((a, b) => b.start - a.start))
      output = Buffer.concat([
        output.subarray(0, edit.start),
        Buffer.from(edit.newValue),
        output.subarray(edit.end),
      ]);
    for (const edit of fileEdits) edit.resultingHash = sha256(output);
  }
  const oldRoute = `/artists/${input.sourceContentId}`;
  const escapedRoute = oldRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const unsupportedRoute = new RegExp(`${escapedRoute}/?(?=[\\s"')\\]}>?#]|$)`);
  for (const item of inventory) {
    const file = relative(repositoryRoot, item.file);
    if (
      !file.startsWith("src/content/news/") &&
      !file.startsWith("src/content/works/") &&
      !file.startsWith("src/content/exhibitions/") &&
      unsupportedRoute.test(item.bytes.toString("utf8"))
    )
      throw new ArtistsRenameError(
        `Unsupported incoming Artist reference: ${file}`,
        "reference-graph-incomplete",
      );
  }
  const sourceFiles = await Promise.all(
    ["index.yaml", "ja.md", "en.md"].map(async (name) => {
      const file = path.join(source, name);
      const stat = await fs.lstat(file).catch(() => undefined);
      if (!stat?.isFile() || stat.isSymbolicLink())
        throw new ArtistsRenameError(
          "Artist unit inventory is unsafe.",
          "source-unavailable",
        );
      const bytes = await fs.readFile(file);
      return {
        file: relative(repositoryRoot, file),
        hash: sha256(bytes),
        size: bytes.length,
      };
    }),
  );
  if ((await fs.readdir(source)).length !== sourceFiles.length)
    throw new ArtistsRenameError(
      "Artist unit inventory is unsafe.",
      "source-unavailable",
    );
  const sourceFile = sourceFiles[0];
  const newFiles = sourceFiles.map(({ file }) =>
    file.replace(
      `/${input.sourceContentId}/`,
      `/${input.destinationContentId}/`,
    ),
  );
  const touchedPaths = [
    ...sourceFiles.map(({ file }) => file),
    ...newFiles,
    ...edits.map(({ file }) => file),
  ].sort();
  const body: Omit<ArtistsRenamePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: "artist-typed-reference-v1",
    operation: "artists-rename",
    operationId: input.operationId,
    createdAt: input.createdAt,
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    oldRoutes: [`${oldRoute}/`],
    newRoutes: [`/artists/${input.destinationContentId}/`],
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
    sourceFiles,
    referenceEdits: edits,
    touchedPaths,
    publishPaths: touchedPaths,
    unchanged: [
      "Artist works_layout[].works[] references",
      "All asset bytes and paths",
      "Production loaders and generated relationships",
      "Preview and Save boundaries",
    ],
  };
  return { ...body, planHash: hashPlan(body) };
}

export async function planArtistsRename(input: {
  repositoryRoot?: string;
  sourceContentId: string;
  destinationContentId: string;
}): Promise<ArtistsRenamePlan> {
  if (
    !isContentId(input.sourceContentId) ||
    !isContentId(input.destinationContentId) ||
    input.sourceContentId === input.destinationContentId
  )
    throw new ArtistsRenameError(
      "Source and new Artist IDs must be different lowercase hyphenated IDs.",
      "invalid-content-id",
    );
  const repositoryRoot = path.resolve(input.repositoryRoot ?? ".");
  try {
    await assertNoActiveRenameEvidence(repositoryRoot, "artists", input.sourceContentId);
  } catch (error) {
    throw new ArtistsRenameError("Publish the active Artist Rename before renaming again.", "pending-rename-evidence", { cause: error });
  }
  if (
    await new HeroAssetPublishEvidenceStore(repositoryRoot).read(
      "artists",
      input.sourceContentId,
    )
  )
    throw new ArtistsRenameError(
      "Publish the pending Artist Hero asset before Rename.",
      "pending-hero-publish-evidence",
    );
  return buildPlan({
    repositoryRoot,
    sourceContentId: input.sourceContentId,
    destinationContentId: input.destinationContentId,
    operationId: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

const comparableHash = (plan: ArtistsRenamePlan) => {
  const body = { ...plan } as Partial<ArtistsRenamePlan>;
  delete body.planHash;
  delete body.operationId;
  delete body.createdAt;
  return sha256(JSON.stringify(body));
};

export async function executeArtistsRename(
  reviewedPlan: ArtistsRenamePlan,
  repositoryRoot = path.resolve("."),
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const supplied = { ...reviewedPlan } as Partial<ArtistsRenamePlan>;
  delete supplied.planHash;
  if (
    reviewedPlan.planHash !==
    hashPlan(supplied as Omit<ArtistsRenamePlan, "planHash">)
  )
    throw new ArtistsRenameError(
      "Rename plan identity is invalid.",
      "plan-stale",
    );
  if (
    await new HeroAssetPublishEvidenceStore(repositoryRoot).read(
      "artists",
      reviewedPlan.sourceContentId,
    )
  )
    throw new ArtistsRenameError(
      "Publish the pending Artist Hero asset before Rename.",
      "pending-hero-publish-evidence",
    );
  try {
    await assertNoActiveRenameEvidence(repositoryRoot, "artists", reviewedPlan.sourceContentId);
  } catch (error) {
    throw new ArtistsRenameError("Publish the active Artist Rename before renaming again.", "pending-rename-evidence", { cause: error });
  }
  const stateRoot = await ensureStateDirectory(repositoryRoot, ".kiki-editor");
  const lifecycle = await ensureStateDirectory(stateRoot, "content-lifecycle");
  const operations = await ensureStateDirectory(lifecycle, "operations");
  const lock = path.join(lifecycle, "repository.lock");
  if (
    await fs
      .lstat(path.join(stateRoot, "asset-lifecycle/repository.lock"))
      .catch(() => undefined)
  )
    throw new ArtistsRenameError(
      "Asset lifecycle mutation is active or requires recovery.",
      "lifecycle-lock-conflict",
    );
  try {
    await fs.mkdir(lock);
  } catch (error) {
    throw new ArtistsRenameError(
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
    }).catch((error) => {
      throw new ArtistsRenameError(
        "Canonical graph changed; review a new plan.",
        "plan-stale",
        { cause: error },
      );
    });
    if (comparableHash(reviewedPlan) !== comparableHash(rebuilt))
      throw new ArtistsRenameError(
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
        !file.startsWith(
          `src/content/artists/${reviewedPlan.destinationContentId}/`,
        ),
    )) {
      const absolute = path.join(repositoryRoot, file);
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new ArtistsRenameError(
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
    for (const source of reviewedPlan.sourceFiles) {
      const bytes = Buffer.from(preimages[source.file].bytes, "base64");
      const destination = source.file.replace(
        `/${reviewedPlan.sourceContentId}/`,
        `/${reviewedPlan.destinationContentId}/`,
      );
      prospective[destination] = {
        hash: sha256(bytes),
        mode: preimages[source.file].mode,
        bytes: bytes.toString("base64"),
      };
    }
    for (const file of new Set(
      reviewedPlan.referenceEdits.map((edit) => edit.file),
    )) {
      const fileEdits = reviewedPlan.referenceEdits.filter(
        (edit) => edit.file === file,
      );
      const bytes = Buffer.from(preimages[file].bytes, "base64");
      const rewritten = rewriteReferences(bytes, fileEdits);
      prospective[file] = {
        hash: sha256(rewritten),
        mode: preimages[file].mode,
        bytes: rewritten.toString("base64"),
      };
    }
    record = {
      schemaVersion: 1,
      operation: "artists-rename",
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
        throw new ArtistsRenameError(
          "Staged bytes failed validation.",
          "prospective-validation-failed",
        );
    }
    await writeRecord();
    // The complete inventory was validated while rebuilding the plan; validate every
    // prospective reference and the renamed source before the first canonical move.
    for (const source of reviewedPlan.sourceFiles)
      if (preimages[source.file].hash !== source.hash)
        throw new ArtistsRenameError("Source preimage mismatch.", "plan-stale");
    for (const edit of reviewedPlan.referenceEdits)
      if (prospective[edit.file].hash !== edit.resultingHash)
        throw new ArtistsRenameError(
          "Prospective reference graph mismatch.",
          "prospective-validation-failed",
        );
    mutationStarted = true;
    await fs.mkdir(
      path.join(
        repositoryRoot,
        `src/content/artists/${reviewedPlan.destinationContentId}`,
      ),
    );
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
    await fs.rmdir(
      path.join(
        repositoryRoot,
        `src/content/artists/${reviewedPlan.sourceContentId}`,
      ),
    );
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
        .lstat(
          path.join(
            repositoryRoot,
            `src/content/artists/${reviewedPlan.sourceContentId}`,
          ),
        )
        .catch(() => undefined))
    )
      throw new ArtistsRenameError(
        "Installed graph failed validation.",
        "prospective-validation-failed",
      );
    for (const [file, value] of Object.entries(prospective))
      if (
        sha256(await fs.readFile(path.join(repositoryRoot, file))) !==
        value.hash
      )
        throw new ArtistsRenameError(
          `Installed bytes mismatch: ${file}`,
          "prospective-validation-failed",
        );
    const draft = createArtistsEditorDraft(
      await readArtistsEditorEntry(
        reviewedPlan.destinationContentId,
        path.join(repositoryRoot, "src/content/artists"),
      ),
    );
    if (!draft)
      throw new ArtistsRenameError(
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
        await fs
          .rmdir(
            path.join(
              repositoryRoot,
              `src/content/artists/${reviewedPlan.destinationContentId}`,
            ),
          )
          .catch(() => undefined);
        await fs.mkdir(
          path.join(
            repositoryRoot,
            `src/content/artists/${reviewedPlan.sourceContentId}`,
          ),
          { recursive: true },
        );
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
        throw new ArtistsRenameError(
          "Artist Rename failed; every touched canonical byte was restored.",
          "rename-failed-rolled-back",
          { cause: error },
        );
      } catch (rollbackError) {
        if (rollbackError instanceof ArtistsRenameError) throw rollbackError;
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
        throw new ArtistsRenameError(
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
