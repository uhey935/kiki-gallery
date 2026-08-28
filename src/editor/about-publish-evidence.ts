import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const COMMIT = /^[a-f0-9]{40,64}$/;
const HASH = /^[a-f0-9]{64}$/;
const PATHS = new Set([
  "src/content/about/about/en.md",
  "src/content/about/about/index.yaml",
  "src/content/about/about/ja.md",
]);

export type AboutPublishEvidence = {
  version: 1;
  contentId: "about";
  state: "pending" | "committed-push-failed";
  branch: string;
  upstream: string;
  remote: string;
  startingHead: string;
  paths: Array<{ path: string; sha256: string; byteSize: number }>;
  createdAt: string;
  commit?: string;
};

export class AboutPublishEvidenceError extends Error {
  readonly code = "about-publish-evidence-invalid";
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function parseAboutPublishEvidence(
  value: unknown,
): AboutPublishEvidence {
  if (!object(value))
    throw new AboutPublishEvidenceError("About Publish evidence is corrupt");
  const keys = [
    "version",
    "contentId",
    "state",
    "branch",
    "upstream",
    "remote",
    "startingHead",
    "paths",
    "createdAt",
    ...(value.state === "committed-push-failed" ? ["commit"] : []),
  ].sort();
  const paths = Array.isArray(value.paths) ? value.paths : [];
  if (
    Object.keys(value).sort().join("\0") !== keys.join("\0") ||
    value.version !== 1 ||
    value.contentId !== "about" ||
    !["pending", "committed-push-failed"].includes(String(value.state)) ||
    typeof value.branch !== "string" ||
    !value.branch ||
    typeof value.remote !== "string" ||
    !value.remote ||
    value.upstream !== `${value.remote}/${value.branch}` ||
    typeof value.startingHead !== "string" ||
    !COMMIT.test(value.startingHead) ||
    !paths.length ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    (value.state === "committed-push-failed" &&
      (typeof value.commit !== "string" || !COMMIT.test(value.commit)))
  )
    throw new AboutPublishEvidenceError(
      "About Publish evidence schema is invalid",
    );
  for (const item of paths) {
    if (
      !object(item) ||
      Object.keys(item).sort().join("\0") !==
        ["byteSize", "path", "sha256"].join("\0") ||
      typeof item.path !== "string" ||
      !PATHS.has(item.path) ||
      typeof item.sha256 !== "string" ||
      !HASH.test(item.sha256) ||
      !Number.isSafeInteger(item.byteSize) ||
      Number(item.byteSize) < 0
    )
      throw new AboutPublishEvidenceError(
        "About Publish path evidence is invalid",
      );
  }
  if (
    new Set(paths.map((item) => (item as { path: string }).path)).size !==
    paths.length
  )
    throw new AboutPublishEvidenceError(
      "About Publish evidence has duplicate paths",
    );
  return structuredClone(value as AboutPublishEvidence);
}

export class AboutPublishEvidenceStore {
  readonly repositoryRoot: string;
  readonly file: string;
  constructor(repositoryRoot = path.resolve(".")) {
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.file = path.join(
      this.repositoryRoot,
      ".kiki-editor/publish-evidence/about/about.v1.json",
    );
  }
  private async validateParents(create: boolean) {
    let current = this.repositoryRoot;
    for (const part of [".kiki-editor", "publish-evidence", "about"]) {
      current = path.join(current, part);
      let stat = await fs.lstat(current).catch(() => undefined);
      if (!stat && create) {
        await fs.mkdir(current, { mode: 0o700 });
        stat = await fs.lstat(current);
      }
      if (!stat) return false;
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new AboutPublishEvidenceError(
          "About Publish evidence path is unsafe",
        );
    }
    return true;
  }
  async read() {
    if (!(await this.validateParents(false))) return undefined;
    const stat = await fs.lstat(this.file).catch(() => undefined);
    if (!stat) return undefined;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new AboutPublishEvidenceError(
        "About Publish evidence file is unsafe",
      );
    try {
      return parseAboutPublishEvidence(
        JSON.parse(await fs.readFile(this.file, "utf8")),
      );
    } catch (error) {
      if (error instanceof AboutPublishEvidenceError) throw error;
      throw new AboutPublishEvidenceError(
        "About Publish evidence is unreadable",
      );
    }
  }
  async write(value: AboutPublishEvidence) {
    const evidence = parseAboutPublishEvidence(value);
    await this.validateParents(true);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
      const directory = await fs.open(path.dirname(this.file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    return evidence;
  }
  async delete() {
    if (!(await this.validateParents(false))) return;
    const stat = await fs.lstat(this.file).catch(() => undefined);
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new AboutPublishEvidenceError(
        "About Publish evidence file is unsafe",
      );
    await fs.rm(this.file);
  }
}
