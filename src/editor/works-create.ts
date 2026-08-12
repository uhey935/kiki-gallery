import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadWorkUnit } from "../content-loaders/works/repository.ts";
import { isContentId } from "./content-id.ts";
import {
  createWorksEditorDraft,
  validateWorksEditorDraft,
  type WorksEditorDraftState,
} from "./works-draft-state.ts";
import { serializeWorksEditorUnit } from "./works-serializer.ts";
import { readWorksEditorEntry } from "./works-state.ts";

const canonicalRoot = path.resolve("src/content/works");

export class WorksCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "unsafe-works-root"
    | "canonical-mismatch"
    | "works-create-rollback-failed"
    | "create-failed";
  constructor(message: string, code: WorksCreateError["code"], options?: ErrorOptions) {
    super(message, options);
    this.name = "WorksCreateError";
    this.code = code;
  }
}

export type WorksCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;

const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

async function persistRecoveryEvidence(
  root: string,
  contentId: string,
  destination: string,
  output: { shared: string; ja: string; en: string },
  rollbackError: unknown,
) {
  const expected = [
    ["index.yaml", output.shared],
    ["ja.md", output.ja],
    ["en.md", output.en],
  ] as const;
  const observed = await Promise.all(
    expected.map(async ([name]) => {
      const file = path.join(destination, name);
      try {
        const bytes = await fs.readFile(file);
        return { path: file, state: "present", sha256: sha256(bytes), byteLength: bytes.byteLength };
      } catch (error) {
        return { path: file, state: "absent", readError: String(error) };
      }
    }),
  );
  const evidence = {
    schemaVersion: 1,
    operation: "works-create",
    failureCode: "works-create-rollback-failed",
    contentId,
    intendedTargetDirectory: destination,
    affectedContentPaths: expected.map(([name]) => path.join(destination, name)),
    expectedTargetState: "absent",
    intendedFiles: Object.fromEntries(
      expected.map(([name, bytes]) => [name, { sha256: sha256(bytes), byteLength: Buffer.byteLength(bytes) }]),
    ),
    observedCurrentPaths: observed,
    promotedAssets: [],
    tempTokenState: [],
    rollbackState: "failed",
    rollbackError: String(rollbackError),
    manualRecoveryRequired: true,
  };
  const file = path.join(root, `.works-create-recovery-${contentId}.json`);
  await fs.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  return file;
}

async function absent(id: string, root: string, io: WorksCreateFileSystem) {
  if (!isContentId(id))
    throw new WorksCreateError("Invalid Work Content ID", "invalid-content-id");
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new WorksCreateError("Unsafe Works root", "unsafe-works-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved)
    throw new WorksCreateError("Invalid Work Content ID", "invalid-content-id");
  const folded = id.toLocaleLowerCase("en-US");
  if (
    (await io.readdir(resolved)).some((name) => {
      const candidate = name.toLocaleLowerCase("en-US");
      return candidate === folded || candidate === `${folded}.md`;
    })
  )
    throw new WorksCreateError("Work Content ID exists", "content-id-collision");
  return destination;
}

export async function createWorksThreeFileEntry(
  draft: WorksEditorDraftState,
  root = canonicalRoot,
  io: WorksCreateFileSystem = fs,
  hooks?: { reread?: typeof readWorksEditorEntry },
) {
  const prospective = structuredClone(draft);
  if (!prospective.localized || !prospective.sourceRaw) {
    prospective.localized = {
      ja: {
        title: prospective.data.title,
        images: prospective.data.images.map(({ alt }) => ({ alt })),
        ...(prospective.data.material ? { material: prospective.data.material } : {}),
        ...(prospective.data.size ? { size: prospective.data.size } : {}),
        ...(prospective.data.seo_title ? { seo_title: prospective.data.seo_title } : {}),
        ...(prospective.data.description ? { description: prospective.data.description } : {}),
        body: prospective.body,
      },
      en: {
        title: "__TODO_WORK_TITLE__",
        images: prospective.data.images.map((_, index) => ({
          alt: `__TODO_WORK_IMAGE_ALT_${index + 1}__`,
        })),
        ...(prospective.data.material ? { material: "__TODO_WORK_MATERIAL__" } : {}),
        ...(prospective.data.size ? { size: "__TODO_WORK_SIZE__" } : {}),
        body: prospective.body ? "__TODO_WORK_BODY__" : "",
      },
    };
  }
  if (!validateWorksEditorDraft(prospective).capabilities.save)
    throw new WorksCreateError("Invalid Work draft", "invalid-draft");
  const destination = await absent(prospective.contentId, root, io);
  const output = serializeWorksEditorUnit(prospective);
  const stageRoot = path.join(path.resolve(root), `.works-create-${randomUUID()}`);
  const stage = path.join(stageRoot, draft.contentId);
  let committed = false;
  try {
    await io.mkdir(stageRoot);
    await io.mkdir(stage);
    for (const [key, name] of [["shared", "index.yaml"], ["ja", "ja.md"], ["en", "en.md"]] as const)
      await io.writeFile(path.join(stage, name), output[key], { flag: "wx" });
    const unit = await loadWorkUnit(stage);
    if (
      unit.shared.state !== "valid" ||
      unit.locales.ja.state !== "valid" ||
      unit.locales.en.state !== "valid"
    )
      throw new WorksCreateError("Serialized Work unit is invalid", "canonical-mismatch");
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination);
    committed = true;
    const saved = createWorksEditorDraft(
      await (hooks?.reread ?? readWorksEditorEntry)(draft.contentId, root),
    );
    if (!saved || JSON.stringify(saved.sourceFiles) !== JSON.stringify(output))
      throw new WorksCreateError("Created Work did not match its draft", "canonical-mismatch");
    return saved;
  } catch (error) {
    if (committed)
      try {
        for (const [key, name] of [["shared", "index.yaml"], ["ja", "ja.md"], ["en", "en.md"]] as const)
          if ((await io.readFile(path.join(destination, name), "utf8")) !== output[key])
            throw new Error("created bytes changed before rollback");
        await io.rm(destination, { recursive: true, force: false });
      } catch (rollbackError) {
        const evidencePath = await persistRecoveryEvidence(
          path.resolve(root), draft.contentId, destination, output, rollbackError,
        );
        throw new WorksCreateError(`Works Create rollback failed; recovery evidence: ${evidencePath}`, "works-create-rollback-failed", {
          cause: new AggregateError([error, rollbackError]),
        });
      }
    if (error instanceof WorksCreateError) throw error;
    throw new WorksCreateError("Works Create failed", "create-failed", { cause: error });
  } finally {
    await io.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
