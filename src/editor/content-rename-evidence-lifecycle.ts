import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const OPERATION_ID = /^[0-9a-f-]{36}$/i;
const COMMIT = /^[a-f0-9]{40,64}$/;

export type RenameEvidenceCollection = "artists" | "exhibitions" | "works";
export type RenameEvidenceRecord = {
  state: string;
  operation?: string;
  plan?: {
    operation: string;
    operationId: string;
    sourceContentId: string;
    destinationContentId: string;
    repositoryBranch: string;
    repositoryUpstream: string;
    sourceFile?: { file: string };
    sourceFiles?: Array<{ file: string }>;
    [key: string]: unknown;
  };
  publication?: {
    commit: string;
    branch: string;
    upstream: string;
  };
  [key: string]: unknown;
};

export type LocatedRenameEvidence = {
  operationId: string;
  directory: string;
  file: string;
  record: RenameEvidenceRecord;
};

type PublicationMarker = {
  version: 1;
  operationId: string;
  operation: string;
  sourceContentId: string;
  destinationContentId: string;
  phase: "commit-intent" | "committed" | "push-intent" | "published-confirmed";
  branch: string;
  upstream: string;
  commit?: string;
};

const markerFile = (located: LocatedRenameEvidence) =>
  path.join(located.directory, "rename-publication.json");

async function atomicWrite(file: string, value: unknown) {
  const staged = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(staged, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(staged, file);
  } catch (error) {
    await fs.rm(staged, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readMarker(located: LocatedRenameEvidence) {
  const file = markerFile(located);
  const stat = await fs.lstat(file).catch(() => undefined);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Rename publication marker is unsafe");
  let marker: PublicationMarker;
  try {
    marker = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error("Rename publication marker is malformed", { cause: error });
  }
  if (
    marker?.version !== 1 ||
    marker.operationId !== located.operationId ||
    typeof marker.operation !== "string" ||
    typeof marker.sourceContentId !== "string" ||
    typeof marker.destinationContentId !== "string" ||
    !["commit-intent", "committed", "push-intent", "published-confirmed"].includes(marker.phase) ||
    typeof marker.branch !== "string" ||
    typeof marker.upstream !== "string" ||
    (marker.phase !== "commit-intent" &&
      (!marker.commit || !COMMIT.test(marker.commit)))
  ) throw new Error("Rename publication marker identity is invalid");
  return marker;
}

const writeMarker = (located: LocatedRenameEvidence, marker: PublicationMarker) =>
  atomicWrite(markerFile(located), marker);

function markerIdentity(located: LocatedRenameEvidence) {
  const plan = located.record.plan;
  if (!plan) throw new Error("Rename operation plan is unavailable");
  return {
    version: 1 as const,
    operationId: located.operationId,
    operation: plan.operation,
    sourceContentId: plan.sourceContentId,
    destinationContentId: plan.destinationContentId,
  };
}

const operationName = (collection: RenameEvidenceCollection) =>
  `${collection}-rename`;

function operationsRoot(repositoryRoot: string) {
  return path.join(
    path.resolve(repositoryRoot),
    ".kiki-editor/content-lifecycle/operations",
  );
}

async function readLocated(
  repositoryRoot: string,
  operationId: string,
): Promise<LocatedRenameEvidence> {
  if (!OPERATION_ID.test(operationId)) throw new Error("Invalid Rename operation identity");
  const root = operationsRoot(repositoryRoot);
  const rootStat = await fs.lstat(root).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("Rename operations root is unsafe");
  const directory = path.join(root, operationId);
  const directoryStat = await fs.lstat(directory).catch(() => undefined);
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error("Rename operation directory is missing or unsafe");
  const file = path.join(directory, "operation.json");
  const fileStat = await fs.lstat(file).catch(() => undefined);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink())
    throw new Error("Rename operation record is missing or unsafe");
  let record: RenameEvidenceRecord;
  try {
    record = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error("Rename operation record is malformed", { cause: error });
  }
  if (!record || typeof record !== "object" || typeof record.state !== "string")
    throw new Error("Rename operation record identity is invalid");
  return { operationId, directory, file, record };
}

export async function findRenameEvidence(
  repositoryRoot: string,
  collection: RenameEvidenceCollection,
  contentId: string,
) {
  const root = operationsRoot(repositoryRoot);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const active: LocatedRenameEvidence[] = [];
  const retry: LocatedRenameEvidence[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!OPERATION_ID.test(entry.name)) continue;
    const located = await readLocated(repositoryRoot, entry.name);
    const { record } = located;
    const declaredOperation = record.operation ?? record.plan?.operation;
    if (declaredOperation !== operationName(collection)) continue;
    if (
      !record.plan ||
      record.plan.operation !== operationName(collection) ||
      record.plan.operationId !== entry.name
    )
      throw new Error("Rename operation record identity is invalid");
    if (record.plan.destinationContentId !== contentId) continue;
    const marker = await readMarker(located);
    if (marker) {
      if (
        marker.operation !== record.plan.operation ||
        marker.sourceContentId !== record.plan.sourceContentId ||
        marker.destinationContentId !== record.plan.destinationContentId ||
        marker.branch !== record.plan.repositoryBranch ||
        marker.upstream !== record.plan.repositoryUpstream
      ) throw new Error("Rename publication marker does not match its plan");
      if (record.publication) {
        if (
          !COMMIT.test(record.publication.commit) ||
          record.publication.branch !== record.plan.repositoryBranch ||
          record.publication.upstream !== record.plan.repositoryUpstream ||
          (marker.commit && marker.commit !== record.publication.commit)
        ) throw new Error("Rename publication identities contradict each other");
      }
      if (record.state === "published" || marker.phase === "published-confirmed") continue;
      if (marker.phase === "commit-intent")
        throw new Error("Rename publication commit identity requires manual recovery");
      located.record.state = marker.phase === "push-intent"
        ? "push-outcome-uncertain"
        : "committed-push-failed";
      located.record.publication = {
        commit: marker.commit!, branch: marker.branch, upstream: marker.upstream,
      };
      retry.push(located);
      continue;
    }
    if (record.state === "published") continue;
    if (record.state === "committed-push-failed") {
      if (
        !record.publication ||
        !COMMIT.test(record.publication.commit) ||
        record.publication.branch !== record.plan.repositoryBranch ||
        record.publication.upstream !== record.plan.repositoryUpstream
      )
        throw new Error("Rename push recovery evidence is invalid");
      retry.push(located);
      continue;
    }
    if (record.state !== "completed")
      throw new Error("Rename operation state requires manual recovery");
    const source = record.plan.sourceFile?.file ?? record.plan.sourceFiles?.[0]?.file;
    if (typeof source !== "string") throw new Error("Rename source identity is invalid");
    const sourceStillInHead = await execFile("git", ["cat-file", "-e", `HEAD:${source}`], {
      cwd: repositoryRoot,
    }).then(() => true, () => false);
    if (sourceStillInHead) active.push(located);
  }
  if (active.length + retry.length > 1)
    throw new Error("Multiple active Rename operation records match this content");
  return retry[0] ?? active[0];
}

export async function assertNoActiveRenameEvidence(
  repositoryRoot: string,
  collection: RenameEvidenceCollection,
  contentId: string,
) {
  if (await findRenameEvidence(repositoryRoot, collection, contentId))
    throw new Error("Publish the active Rename before another Rename or Delete");
}

async function writeRecord(located: LocatedRenameEvidence) {
  await atomicWrite(located.file, located.record);
}

export async function prepareRenamePublication(
  located: LocatedRenameEvidence, branch: string, upstream: string,
) {
  await atomicWrite(markerFile(located), {
    ...markerIdentity(located), phase: "commit-intent", branch, upstream,
  } satisfies PublicationMarker);
}

export async function abandonRenamePublicationIntent(located: LocatedRenameEvidence) {
  const marker = await readMarker(located);
  if (marker?.phase === "commit-intent") await fs.rm(markerFile(located));
}

export async function bindRenamePublicationCommit(
  located: LocatedRenameEvidence, commit: string, branch: string, upstream: string,
) {
  if (!COMMIT.test(commit)) throw new Error("Invalid Rename Publish commit");
  const marker = { ...markerIdentity(located), phase: "committed", branch, upstream, commit } satisfies PublicationMarker;
  try {
    await atomicWrite(markerFile(located), marker);
    located.record.state = "committed-push-failed";
    located.record.publication = { commit, branch, upstream };
  } catch (error) {
    located.record.state = "manual-recovery-required";
    located.record.publication = { commit, branch, upstream };
    await writeRecord(located).catch(() => undefined);
    throw new Error("Rename commit identity could not be durably bound", { cause: error });
  }
}

export async function recordRenamePushFailure(
  located: LocatedRenameEvidence,
  commit: string,
  branch: string,
  upstream: string,
  persist: (located: LocatedRenameEvidence) => Promise<void> = writeRecord,
) {
  if (!COMMIT.test(commit)) throw new Error("Invalid Rename Publish commit");
  await atomicWrite(markerFile(located), {
    ...markerIdentity(located), phase: "committed", branch, upstream, commit,
  } satisfies PublicationMarker);
  located.record.state = "committed-push-failed";
  located.record.publication = { commit, branch, upstream };
  await persist(located);
}

export async function publishRecordedRenameCommit(
  located: LocatedRenameEvidence,
  repositoryRoot: string,
  branch: string,
  upstream: string,
  push: (commit: string, branch: string) => Promise<void>,
  isAlreadyPublished?: (commit: string, branch: string) => Promise<boolean>,
  persistPushIntent: (located: LocatedRenameEvidence, marker: PublicationMarker) => Promise<void> = writeMarker,
) {
  const publication = located.record.publication;
  if (
    !["committed-push-failed", "push-outcome-uncertain"].includes(located.record.state) ||
    !publication ||
    publication.branch !== branch ||
    publication.upstream !== upstream ||
    !COMMIT.test(publication.commit)
  )
    throw new Error("Rename push recovery identity does not match repository context");
  const head = (
    await execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" })
  ).stdout.trim();
  if (head !== publication.commit)
    throw new Error("Rename push recovery commit does not match HEAD");
  await execFile("git", ["cat-file", "-e", `${publication.commit}^{commit}`], {
    cwd: repositoryRoot,
  });
  const alreadyPublished = await isAlreadyPublished?.(publication.commit, branch);
  if (alreadyPublished)
    return publication.commit;
  if (located.record.state === "push-outcome-uncertain")
    throw new Error("Rename push outcome is uncertain and requires manual recovery");
  await persistPushIntent(located, {
    ...markerIdentity(located), phase: "push-intent", branch, upstream, commit: publication.commit,
  } satisfies PublicationMarker);
  located.record.state = "push-outcome-uncertain";
  try {
    await push(publication.commit, branch);
  } catch (error) {
    try {
      await recordRenamePushFailure(located, publication.commit, branch, upstream);
    } catch (transitionError) {
      throw new Error("Rename push failed and its definitive failure could not be recorded", {
        cause: new AggregateError([error, transitionError]),
      });
    }
    throw error;
  }
  return publication.commit;
}

export async function finalizePublishedRename(
  located: LocatedRenameEvidence,
  remove: (directory: string) => Promise<void> = async (directory) => {
    await fs.rm(directory, { recursive: true });
  },
  persist: (located: LocatedRenameEvidence) => Promise<void> = writeRecord,
  persistMarker: (located: LocatedRenameEvidence, marker: PublicationMarker) => Promise<void> = writeMarker,
) {
  const publication = located.record.publication;
  const plan = located.record.plan;
  const commit = publication?.commit;
  const branch = publication?.branch ?? plan?.repositoryBranch;
  const upstream = publication?.upstream ?? plan?.repositoryUpstream;
  if (!commit || !COMMIT.test(commit) || !branch || !upstream)
    throw new Error("Published Rename identity is unavailable");
  located.record.state = "published";
  try {
    await persistMarker(located, {
      ...markerIdentity(located), phase: "published-confirmed", branch, upstream, commit,
    } satisfies PublicationMarker);
  } catch (markerError) {
    try {
      await persist(located);
    } catch (recordError) {
      throw new Error("Published Rename could not be durably finalized", {
        cause: new AggregateError([markerError, recordError]),
      });
    }
    return {
      cleaned: false as const,
      error: markerError instanceof Error ? markerError.message : "Rename publication marker finalization failed",
    };
  }
  try {
    await persist(located);
  } catch (error) {
    return { cleaned: false as const, error: error instanceof Error ? error.message : "Rename evidence finalization failed" };
  }
  try {
    await remove(located.directory);
    return { cleaned: true as const };
  } catch (error) {
    return {
      cleaned: false as const,
      error: error instanceof Error ? error.message : "Rename evidence cleanup failed",
    };
  }
}
