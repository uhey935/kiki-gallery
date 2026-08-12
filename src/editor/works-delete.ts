import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { readArtistsEditorEntry } from "./artists-state.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import { readNewsEditorEntry } from "./news-state.ts";
import { readWorksEditorEntry } from "./works-state.ts";
import { readWorksAssetInventory } from "./works-assets.ts";
import {
  type ContentRecoveryRecord,
  type DeletePreimage,
  persistContentRecoveryRecord,
  plannedDeletePublishPaths,
  provePreDeleteBackup,
} from "./delete-safety-contracts.ts";
import {
  assertClosedDeleteReferenceGraph,
  parseMarkdownDeleteReferences,
} from "./delete-reference-parser.ts";
import { acquireWorksDeleteLocks } from "./content-lifecycle-lock.ts";
import { assertContentLifecycleLock } from "./content-lifecycle-lock.ts";
import { assertWorksAssetRepositoryLock } from "./works-asset-repository-lock.ts";
import { isContentId } from "./content-id.ts";

const execFile = promisify(execFileCallback);
const POLICY_COMMIT = "fe2d6fe2c1c5ff5ce1bf255af8207bfa43681971";
const ADAPTER_VERSION = "works-delete-v1" as const;
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const rel = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join("/");

export type WorksDeleteAsset = {
  publicUrl: string;
  path: string;
  sha256: string;
  byteSize: number;
  currentReferrers: string[];
  prospectiveReferrers: string[];
  consequence: "still-referenced" | "unreferenced-after-content-delete";
};

export type WorksDeletePlan = {
  schemaVersion: 1;
  adapterVersion: typeof ADAPTER_VERSION;
  operation: "works-delete";
  operationId: string;
  contentId: string;
  routes: string[];
  repositoryHead: string;
  repositoryBranch: string;
  backupRoot: string;
  backupProof: Awaited<ReturnType<typeof provePreDeleteBackup>>;
  preimages: DeletePreimage[];
  recoveryPaths: string[];
  incomingReferences: [];
  outgoingArtist: string;
  assets: WorksDeleteAsset[];
  assetSnapshotHash: string;
  lifecycleEvidenceHash: string;
  assetPathChanges: [];
  assetByteChanges: [];
  lifecycleEvidenceChanges: [];
  orphanObservationsCreated: [];
  quarantineActions: [];
  physicalDeleteActions: [];
  planHash: string;
};

export class WorksDeleteError extends Error {
  readonly code:
    | "invalid-content-id"
    | "source-unavailable"
    | "backup-proof-required"
    | "backup-proof-stale"
    | "incoming-reference"
    | "parser-uncertainty"
    | "pending-asset-state"
    | "unpublished-asset-manifest"
    | "asset-lifecycle-state"
    | "plan-stale"
    | "state-mismatch"
    | "lock-conflict"
    | "rollback-failed"
    | "unsafe-repository"
    | "delete-failed"
    | "publish-failed";
  constructor(
    message: string,
    code: WorksDeleteError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorksDeleteError";
    this.code = code;
  }
}

async function repositoryIdentity(root: string) {
  try {
    const real = await fs.realpath(root);
    const gitRoot = await execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd: real,
      encoding: "utf8",
    }).then(({ stdout }) => fs.realpath(stdout.trim()));
    if (gitRoot !== real) throw new Error("root mismatch");
    const repositoryHead = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: real,
      encoding: "utf8",
    }).then(({ stdout }) => stdout.trim());
    const repositoryBranch = await execFile(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: real, encoding: "utf8" },
    ).then(({ stdout }) => stdout.trim());
    return { repositoryHead, repositoryBranch };
  } catch (error) {
    throw new WorksDeleteError(
      "Delete requires the exact repository root on an attached Git branch.",
      "unsafe-repository",
      { cause: error },
    );
  }
}

async function workInventory(root: string, contentId: string) {
  const directory = path.join(root, "src/content/works");
  const unit = path.resolve(directory, contentId);
  const stat = await fs.lstat(unit).catch(() => undefined);
  const entry = await readWorksEditorEntry(contentId, directory).catch(
    () => undefined,
  );
  if (
    path.dirname(unit) !== directory ||
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    !entry?.data ||
    entry.structuralStatus !== "valid" ||
    entry.issues.length
  )
    throw new WorksDeleteError(
      "Works source is unavailable or invalid.",
      "source-unavailable",
    );
  const names = await fs.readdir(unit, { withFileTypes: true });
  if (names.length !== 3 || names.some((item) => item.isSymbolicLink() || !item.isFile() || !["index.yaml", "ja.md", "en.md"].includes(item.name)))
    throw new WorksDeleteError("Works unit inventory is unsafe.", "source-unavailable");
  const preimages = await Promise.all(["index.yaml", "ja.md", "en.md"].map(async (name) => {
    const file = path.join(unit, name), bytes = await fs.readFile(file);
    return { path: rel(root, file), sha256: sha256(bytes), byteSize: bytes.byteLength };
  }));
  return {
    entry,
    preimages,
  };
}

async function walkCanonical(root: string) {
  const contentRoot = path.join(root, "src/content");
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new WorksDeleteError(
          `Reference inventory encountered a symlink: ${rel(root, file)}`,
          "parser-uncertainty",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(md|ya?ml)$/.test(entry.name))
        files.push(file);
      else
        throw new WorksDeleteError(
          `Unsupported canonical reference source: ${rel(root, file)}`,
          "parser-uncertainty",
        );
    }
  };
  await visit(contentRoot);
  return files;
}

async function assertNoIncomingReferences(root: string, contentId: string) {
  for (const file of await walkCanonical(root)) {
    const canonical = rel(root, file);
    const text = await fs.readFile(file, "utf8");
    try {
      if (canonical.startsWith("src/content/artists/")) {
        if (path.basename(file) !== "index.yaml") continue;
        const item = await readArtistsEditorEntry(
          path.basename(path.dirname(file)),
          path.dirname(path.dirname(file)),
        );
        if (!item.data || item.structuralStatus !== "valid")
          throw new Error("invalid Artist source");
        if (
          item.data.works_layout?.some((section) =>
            section.works.some((work) => work.id === contentId),
          )
        )
          throw new WorksDeleteError(
            `Incoming Artist.works_layout reference blocks Delete: ${canonical}`,
            "incoming-reference",
          );
      } else if (canonical.startsWith("src/content/exhibitions/")) {
        if (path.basename(file) !== "index.yaml") continue;
        const item = await readExhibitionsEditorEntry(
          path.basename(path.dirname(file)),
          path.dirname(path.dirname(file)),
        );
        if (!item.data || item.structuralStatus !== "valid")
          throw new Error("invalid Exhibition source");
        if (item.data.works?.some((work) => work.id === contentId))
          throw new WorksDeleteError(
            `Incoming Exhibition.works reference blocks Delete: ${canonical}`,
            "incoming-reference",
          );
      } else if (
        canonical.startsWith("src/content/news/") &&
        path.basename(file) === "index.yaml"
      ) {
        const item = await readNewsEditorEntry(
          path.basename(path.dirname(file)),
          path.dirname(path.dirname(file)),
        );
        if (!item.data || item.structuralStatus !== "valid")
          throw new Error("invalid News source");
        if (
          item.data.link &&
          new RegExp(`^/works/${contentId}/?(?:[?#].*)?$`).test(item.data.link)
        )
          throw new WorksDeleteError(
            `Incoming News.link reference blocks Delete: ${canonical}`,
            "incoming-reference",
          );
      }
      if (file.endsWith(".md")) {
        const refs = assertClosedDeleteReferenceGraph(
          parseMarkdownDeleteReferences(text),
        );
        if (
          refs.some(
            (item) =>
              item.target?.collection === "works" &&
              item.target.contentId === contentId,
          )
        )
          throw new WorksDeleteError(
            `Incoming Markdown Work reference blocks Delete: ${canonical}`,
            "incoming-reference",
          );
      }
    } catch (error) {
      if (error instanceof WorksDeleteError) throw error;
      throw new WorksDeleteError(
        `Reference parser could not close ${canonical}.`,
        "parser-uncertainty",
        { cause: error },
      );
    }
    const escaped = contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(`(?:^|[\\s\"'(:])/works/${escaped}`, "m").test(text) &&
      !canonical.startsWith(`src/content/works/${contentId}/`)
    )
      throw new WorksDeleteError(
        `Unresolved Work reference blocks Delete: ${canonical}`,
        "parser-uncertainty",
      );
  }
}

async function treeSnapshot(
  root: string,
  relativeRoot: string,
  excludeLock = false,
) {
  const base = path.join(root, relativeRoot);
  const baseStat = await fs.lstat(base).catch(() => undefined);
  if (!baseStat) return sha256("absent");
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink())
    throw new WorksDeleteError(
      `Unsafe snapshot root: ${relativeRoot}`,
      "asset-lifecycle-state",
    );
  const rows: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      const relative = rel(root, file);
      if (
        excludeLock &&
        relative.startsWith(".kiki-editor/asset-lifecycle/repository.lock")
      )
        continue;
      if (entry.isSymbolicLink())
        throw new WorksDeleteError(
          `Unsafe symlink in snapshot: ${relative}`,
          "asset-lifecycle-state",
        );
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile())
        rows.push(`${relative}\0${sha256(await fs.readFile(file))}`);
      else
        throw new WorksDeleteError(
          `Unsupported lifecycle entry: ${relative}`,
          "asset-lifecycle-state",
        );
    }
  };
  await visit(base);
  return sha256(rows.length ? rows.join("\n") : "absent");
}

async function assetState(root: string, targetId: string, imageUrls: string[]) {
  const lifecycleRoot = path.join(root, ".kiki-editor/asset-lifecycle");
  const deletionRoot = path.join(lifecycleRoot, "deletion-manifests");
  for (const name of await fs.readdir(deletionRoot).catch(() => [])) {
    const file = path.join(deletionRoot, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !name.endsWith(".json"))
      throw new WorksDeleteError(
        "Asset deletion evidence is unsafe or unsupported.",
        "asset-lifecycle-state",
      );
    let manifest: { state?: string };
    try {
      manifest = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      throw new WorksDeleteError(
        "Asset deletion evidence is corrupt.",
        "asset-lifecycle-state",
        { cause: error },
      );
    }
    if (manifest.state !== "physically-deleted")
      throw new WorksDeleteError(
        "A pending or unresolved asset deletion must be reconciled before Works Delete.",
        "asset-lifecycle-state",
      );
  }
  const cleanupRecovery = path.join(lifecycleRoot, "quarantine/recovery");
  if ((await fs.readdir(cleanupRecovery).catch(() => [])).length)
    throw new WorksDeleteError(
      "Asset quarantine recovery contains an unresolved operation.",
      "asset-lifecycle-state",
    );
  let inventory;
  try {
    inventory = await readWorksAssetInventory(
      path.join(root, "public/images/works"),
      path.join(root, "src/content/works"),
    );
  } catch (error) {
    throw new WorksDeleteError(
      "Canonical Works assets cannot be completely inventoried.",
      "asset-lifecycle-state",
      { cause: error },
    );
  }
  if (!inventory.referenceGraphComplete || inventory.audit.length)
    throw new WorksDeleteError(
      "Works asset reference graph is incomplete.",
      "asset-lifecycle-state",
    );
  const assets = imageUrls.map((url) => {
    const item = inventory.assets.find(
      (candidate) => candidate.publicUrl === url,
    );
    if (!item)
      throw new WorksDeleteError(
        `Referenced asset is missing: ${url}`,
        "asset-lifecycle-state",
      );
    const currentReferrers = [
      ...new Set(item.references.map((ref) => ref.contentId)),
    ].sort();
    const prospectiveReferrers = currentReferrers.filter(
      (id) => id !== targetId,
    );
    return {
      publicUrl: url,
      path: rel(root, item.path),
      sha256: item.sha256,
      byteSize: item.byteSize,
      currentReferrers,
      prospectiveReferrers,
      consequence: prospectiveReferrers.length
        ? ("still-referenced" as const)
        : ("unreferenced-after-content-delete" as const),
    };
  });
  return {
    assets,
    assetSnapshotHash: await treeSnapshot(root, "public/images/works"),
    lifecycleEvidenceHash: await treeSnapshot(
      root,
      ".kiki-editor/asset-lifecycle",
      true,
    ),
  };
}

async function buildPlan(input: {
  repositoryRoot: string;
  contentId: string;
  backupRoot: string;
  operationId: string;
}) {
  const { entry, preimages } = await workInventory(
    input.repositoryRoot,
    input.contentId,
  );
  let backupProof;
  try {
    backupProof = await provePreDeleteBackup({
      backupRoot: input.backupRoot,
      sourcePreimages: preimages,
      policyCommit: POLICY_COMMIT,
    });
  } catch (error) {
    throw new WorksDeleteError(
      "Backup is missing, invalid, or does not contain the exact current Works bytes.",
      "backup-proof-stale",
      { cause: error },
    );
  }
  await assertNoIncomingReferences(input.repositoryRoot, input.contentId);
  const identity = await repositoryIdentity(input.repositoryRoot);
  const asset = await assetState(
    input.repositoryRoot,
    input.contentId,
    entry.data!.images.map((image) => image.src),
  );
  const recoveryPaths = preimages.map((preimage) =>
    path.posix.join(
      ".kiki-editor/content-lifecycle/recovery",
      input.operationId,
      preimage.path,
    ),
  );
  const body: Omit<WorksDeletePlan, "planHash"> = {
    schemaVersion: 1,
    adapterVersion: ADAPTER_VERSION,
    operation: "works-delete",
    operationId: input.operationId,
    contentId: input.contentId,
    routes: [`/works/${input.contentId}/`],
    ...identity,
    backupRoot: input.backupRoot,
    backupProof,
    preimages,
    recoveryPaths,
    incomingReferences: [],
    outgoingArtist: entry.data!.artist.id,
    ...asset,
    assetPathChanges: [],
    assetByteChanges: [],
    lifecycleEvidenceChanges: [],
    orphanObservationsCreated: [],
    quarantineActions: [],
    physicalDeleteActions: [],
  };
  return { ...body, planHash: sha256(JSON.stringify(body)) };
}

export async function planWorksDelete(input: {
  repositoryRoot?: string;
  contentId: string;
  backupRoot: string;
  pendingAssetState?: boolean;
  unpublishedAssetCount?: number;
}) {
  if (!isContentId(input.contentId))
    throw new WorksDeleteError(
      "Invalid Works Content ID.",
      "invalid-content-id",
    );
  if (!input.backupRoot?.trim())
    throw new WorksDeleteError(
      "Select a verified pre-delete backup generation before review.",
      "backup-proof-required",
    );
  if (input.pendingAssetState)
    throw new WorksDeleteError(
      "Finish or abandon pending asset changes before Delete.",
      "pending-asset-state",
    );
  if ((input.unpublishedAssetCount ?? 0) > 0)
    throw new WorksDeleteError(
      "Publish or reconcile the unpublished asset manifest before Delete.",
      "unpublished-asset-manifest",
    );
  return buildPlan({
    repositoryRoot: path.resolve(input.repositoryRoot ?? "."),
    contentId: input.contentId,
    backupRoot: path.resolve(input.backupRoot),
    operationId: randomUUID(),
  });
}

const comparable = (plan: WorksDeletePlan) => ({
  ...plan,
  operationId: "reviewed",
  planHash: "",
  backupProof: { ...plan.backupProof, verifiedAt: "reviewed" },
  recoveryPaths: plan.recoveryPaths.map((value) =>
    value.replace(plan.operationId, "reviewed"),
  ),
});
const recordFor = (
  plan: WorksDeletePlan,
  state: ContentRecoveryRecord["state"],
): ContentRecoveryRecord => ({
  schemaVersion: 1,
  operation: "content-delete",
  operationId: plan.operationId,
  collection: "works",
  contentId: plan.contentId,
  state,
  planHash: plan.planHash,
  repositoryHead: plan.repositoryHead,
  backupProof: plan.backupProof,
  preimages: plan.preimages,
  recoveryPaths: plan.recoveryPaths,
  publishPaths: plan.preimages.map((item) => item.path),
  preparedAt: new Date().toISOString(),
});

export async function executeWorksDelete(
  reviewed: WorksDeletePlan,
  repositoryRoot = path.resolve("."),
  testHooks?: {
    afterMove?: () => Promise<void>;
    beforeRollback?: () => Promise<void>;
  },
) {
  repositoryRoot = path.resolve(repositoryRoot);
  const body = { ...reviewed } as Partial<WorksDeletePlan>;
  delete body.planHash;
  if (reviewed.planHash !== sha256(JSON.stringify(body)))
    throw new WorksDeleteError(
      "Delete plan identity is invalid.",
      "state-mismatch",
    );
  let locks;
  try {
    locks = await acquireWorksDeleteLocks({
      repositoryRoot,
      operationId: reviewed.operationId,
    });
  } catch (error) {
    throw new WorksDeleteError(
      "Another content or asset lifecycle operation is active or requires reconciliation.",
      "lock-conflict",
      { cause: error },
    );
  }
  let record = recordFor(reviewed, "prepared");
  const canonical = reviewed.preimages.map((item) => path.join(repositoryRoot, item.path));
  const recovery = reviewed.recoveryPaths.map((item) => path.join(repositoryRoot, item));
  let moved = 0;
  try {
    await assertContentLifecycleLock(repositoryRoot, locks.content.identity);
    await assertWorksAssetRepositoryLock(repositoryRoot, locks.asset.identity);
    let rebuilt: WorksDeletePlan;
    try {
      rebuilt = await buildPlan({
        repositoryRoot,
        contentId: reviewed.contentId,
        backupRoot: reviewed.backupRoot,
        operationId: reviewed.operationId,
      });
    } catch (error) {
      if (
        error instanceof WorksDeleteError &&
        (error.code === "incoming-reference" ||
          error.code === "parser-uncertainty")
      )
        throw error;
      throw new WorksDeleteError(
        "Canonical content, backup, Git, asset, or lifecycle state drifted; review again.",
        "plan-stale",
        { cause: error },
      );
    }
    if (
      JSON.stringify(comparable(rebuilt)) !==
      JSON.stringify(comparable(reviewed))
    )
      throw new WorksDeleteError(
        "Canonical content, references, assets, lifecycle evidence, backup, or Git identity drifted; review again.",
        "plan-stale",
      );
    for (const file of recovery)
      if (await fs.lstat(file).catch(() => undefined))
        throw new WorksDeleteError("Recovery destination already exists.", "state-mismatch");
    await fs.mkdir(path.dirname(recovery[0]), { recursive: true, mode: 0o700 });
    await persistContentRecoveryRecord(repositoryRoot, record);
    for (let index = 0; index < canonical.length; index++) {
      await fs.rename(canonical[index], recovery[index]);
      moved++;
    }
    await fs.rm(path.dirname(canonical[0]), { recursive: true });
    await testHooks?.afterMove?.();
    if (await fs.lstat(path.dirname(canonical[0])).catch(() => undefined))
      throw new Error("canonical Work unit remained");
    const postAssetHash = await treeSnapshot(
      repositoryRoot,
      "public/images/works",
    );
    const postLifecycleHash = await treeSnapshot(
      repositoryRoot,
      ".kiki-editor/asset-lifecycle",
      true,
    );
    if (
      postAssetHash !== reviewed.assetSnapshotHash ||
      postLifecycleHash !== reviewed.lifecycleEvidenceHash
    )
      throw new WorksDeleteError(
        "Asset bytes, paths, or lifecycle evidence changed during Delete.",
        "state-mismatch",
      );
    record = {
      ...record,
      state: "completed",
      completedAt: new Date().toISOString(),
    };
    await persistContentRecoveryRecord(repositoryRoot, record);
    await locks.release();
    return {
      operationId: reviewed.operationId,
      state: "deleted-unpublished" as const,
    };
  } catch (error) {
    try {
      await testHooks?.beforeRollback?.();
      if (moved) {
        if (await fs.lstat(path.dirname(canonical[0])).catch(() => undefined))
          throw new Error("canonical destination occupied");
        await fs.mkdir(path.dirname(canonical[0]));
        for (let index = 0; index < moved; index++)
          await fs.rename(recovery[index], canonical[index]);
        const restored = await workInventory(
          repositoryRoot,
          reviewed.contentId,
        );
        if (
          JSON.stringify(restored.preimages) !==
          JSON.stringify(reviewed.preimages)
        )
          throw new Error("restored Work bytes mismatch");
      }
      if (
        (await treeSnapshot(repositoryRoot, "public/images/works")) !==
          reviewed.assetSnapshotHash ||
        (await treeSnapshot(
          repositoryRoot,
          ".kiki-editor/asset-lifecycle",
          true,
        )) !== reviewed.lifecycleEvidenceHash
      )
        throw new Error("asset/lifecycle invariance mismatch");
      record = {
        ...record,
        state: "rolled-back",
        resolution: {
          at: new Date().toISOString(),
          reason: error instanceof Error ? error.message : "Delete failed",
        },
      };
      await persistContentRecoveryRecord(repositoryRoot, record);
      await locks.release();
    } catch (rollbackError) {
      await persistContentRecoveryRecord(repositoryRoot, {
        ...record,
        state: "manual-recovery-required",
        resolution: {
          at: new Date().toISOString(),
          reason:
            "Rollback could not prove content and asset/lifecycle invariance",
        },
      }).catch(() => undefined);
      throw new WorksDeleteError(
        "Works Delete rollback failed; preserve both locks and inspect recovery evidence.",
        "rollback-failed",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    if (error instanceof WorksDeleteError) throw error;
    throw new WorksDeleteError(
      "Works Delete failed and was rolled back.",
      "delete-failed",
      { cause: error },
    );
  }
}

export async function publishWorksDelete(
  operationId: string,
  repositoryRoot = path.resolve("."),
) {
  if (!/^[0-9a-f-]{36}$/i.test(operationId))
    throw new WorksDeleteError(
      "Invalid Delete evidence identity.",
      "state-mismatch",
    );
  let record: ContentRecoveryRecord;
  try {
    record = JSON.parse(
      await fs.readFile(
        path.join(
          repositoryRoot,
          ".kiki-editor/content-lifecycle/operations",
          operationId,
          "operation.json",
        ),
        "utf8",
      ),
    );
  } catch (error) {
    throw new WorksDeleteError(
      "Completed Delete evidence is unavailable.",
      "state-mismatch",
      { cause: error },
    );
  }
  if (record.collection !== "works")
    throw new WorksDeleteError(
      "Delete evidence does not belong to Works.",
      "state-mismatch",
    );
  const files = plannedDeletePublishPaths(record);
  if (
    JSON.stringify(files.sort()) !== JSON.stringify([
      `src/content/works/${record.contentId}/en.md`,
      `src/content/works/${record.contentId}/index.yaml`,
      `src/content/works/${record.contentId}/ja.md`,
    ])
  )
    throw new WorksDeleteError(
      "Delete evidence escaped the three-file Works unit.",
      "state-mismatch",
    );
  const git = (args: string[]) =>
    execFile("git", args, { cwd: repositoryRoot, encoding: "utf8" }).then(
      ({ stdout }) => stdout.trim(),
    );
  if (await git(["diff", "--cached", "--name-only"]))
    throw new WorksDeleteError(
      "Delete Publish requires a clean Git index.",
      "state-mismatch",
    );
  if (
    (await git(["rev-parse", "HEAD"])) !== record.repositoryHead ||
    !(await git(["symbolic-ref", "--quiet", "--short", "HEAD"]))
  )
    throw new WorksDeleteError(
      "Repository identity changed after completed Delete.",
      "state-mismatch",
    );
  try {
    await git(["add", "-A", "--", ...files]);
    const staged = (await git(["diff", "--cached", "--name-only"]))
      .split("\n")
      .filter(Boolean);
    if (
      JSON.stringify(staged.sort()) !== JSON.stringify(files.sort()) ||
      (await git(["diff", "--cached", "--name-status", "--", ...files]))
        .split("\n").some((line) => !line.startsWith("D\t"))
    )
      throw new WorksDeleteError(
        "Staged paths do not exactly match completed Delete evidence.",
        "state-mismatch",
      );
    await git(["commit", "-m", `Delete works: ${record.contentId}`]);
    return {
      state: "committed" as const,
      commit: await git(["rev-parse", "HEAD"]),
      files,
    };
  } catch (error) {
    await git(["reset", "--", files[0]]).catch(() => undefined);
    if (error instanceof WorksDeleteError) throw error;
    throw new WorksDeleteError(
      "Failed to publish Works Delete.",
      "publish-failed",
      { cause: error },
    );
  }
}
