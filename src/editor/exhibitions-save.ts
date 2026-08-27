import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createExhibitionsEditorDraft,
  validateExhibitionsEditorDraft,
  type ExhibitionsEditorDraftState,
} from "./exhibitions-draft-state.ts";
import {
  serializeExhibitionsEditorDraft,
  type ExhibitionsSerializedFiles,
} from "./exhibitions-serializer.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
import {
  EXHIBITIONS_HERO_PREFIX,
  ExhibitionsHeroAssetError,
  inspectExhibitionsHeroCandidate,
  temporaryExhibitionsHeroAssetStore,
  type ExhibitionsHeroAssetDraft,
  type TemporaryExhibitionsHeroAssetStore,
} from "./exhibitions-hero-assets.ts";
import {
  exhibitionsContentEvidence,
  createExhibitionsHeroPublishEvidence,
} from "./exhibitions-hero-publish-evidence.ts";
import {
  HeroAssetPublishEvidenceStore,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/exhibitions");
const heroSrc = (draft: ExhibitionsEditorDraftState) =>
  draft.shared.state === "editable" ? draft.shared.value.hero.image : "";
const canonicalFiles = (entry: Awaited<ReturnType<typeof readExhibitionsEditorEntry>>) => {
  if (entry.shared.state !== "valid" || entry.locales.ja.state !== "valid" || entry.locales.en.state !== "valid") return undefined;
  return { "index.yaml": entry.shared.raw, "ja.md": entry.locales.ja.raw, "en.md": entry.locales.en.raw };
};
export class ExhibitionsSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "asset-save-failed"
    | "exhibitions-save-rollback-failed"
    | "save-failed";
  constructor(
    message: string,
    code: ExhibitionsSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExhibitionsSaveError";
    this.code = code;
  }
}
export type ExhibitionsSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function directoryFor(
  contentId: string,
  root: string,
  fileSystem: ExhibitionsSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new ExhibitionsSaveError(
      "Invalid Exhibition Content ID",
      "invalid-content-id",
    );
  const resolvedRoot = path.resolve(root);
  const directory = path.resolve(resolvedRoot, contentId);
  const stat = await fileSystem.lstat(directory).catch(() => undefined);
  if (
    path.dirname(directory) !== resolvedRoot ||
    !stat?.isDirectory() ||
    stat.isSymbolicLink()
  )
    throw new ExhibitionsSaveError("Unsafe Exhibition unit", "invalid-content-id");
  return directory;
}

export async function writeExhibitionsSerializedFiles(
  contentId: string,
  next: ExhibitionsSerializedFiles,
  baseline: ExhibitionsSerializedFiles,
  root = canonicalRoot,
  fileSystem: ExhibitionsSaveFileSystem = fs,
) {
  const directory = await directoryFor(contentId, root, fileSystem);
  const id = `.exhibitions-save-${randomUUID()}`;
  const stage = path.join(directory, `${id}-stage`);
  const backup = path.join(directory, `${id}-backup`);
  const replaced: (typeof files)[number][] = [];
  let manualRecoveryRequired = false;
  try {
    await fileSystem.mkdir(stage);
    await fileSystem.mkdir(backup);
    for (const name of files) {
      const target = path.join(directory, name);
      const stat = await fileSystem.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Unsafe Exhibition source: ${name}`);
      const current = await fileSystem.readFile(target, "utf8");
      if (current !== baseline[name])
        throw new ExhibitionsSaveError(
          "Canonical Exhibition changed during Save",
          "canonical-mismatch",
        );
      await fileSystem.writeFile(path.join(stage, name), next[name], {
        encoding: "utf8",
        flag: "wx",
      });
      await fileSystem.writeFile(path.join(backup, name), current, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    for (const name of files) {
      await fileSystem.rename(
        path.join(stage, name),
        path.join(directory, name),
      );
      replaced.push(name);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of replaced.reverse())
      try {
        await fileSystem.rename(
          path.join(backup, name),
          path.join(directory, name),
        );
      } catch (failure) {
        failures.push(failure);
      }
    if (failures.length) {
      manualRecoveryRequired = true;
      throw new ExhibitionsSaveError(
        "Failed to roll back Exhibition Save",
        "exhibitions-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof ExhibitionsSaveError) throw error;
    throw new ExhibitionsSaveError("Failed to save Exhibition", "save-failed", {
      cause: error,
    });
  } finally {
    if (!manualRecoveryRequired)
      await Promise.all([
        fileSystem
          .rm(stage, { recursive: true, force: true })
          .catch(() => undefined),
        fileSystem
          .rm(backup, { recursive: true, force: true })
          .catch(() => undefined),
      ]);
  }
}

export async function saveExhibitionsEditorDraft(
  draft: ExhibitionsEditorDraftState,
  baseline: ExhibitionsEditorDraftState,
  root = canonicalRoot,
  fileSystem: ExhibitionsSaveFileSystem = fs,
) {
  if (!validateExhibitionsEditorDraft(draft).capabilities.save)
    throw new ExhibitionsSaveError(
      "Exhibition draft has blocking issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new ExhibitionsSaveError(
      "Content baseline mismatch",
      "canonical-mismatch",
    );
  const entry = await readExhibitionsEditorEntry(draft.contentId, root);
  const canonical = createExhibitionsEditorDraft(entry);
  if (
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(baseline) ||
    !canonicalFiles(entry)
  )
    throw new ExhibitionsSaveError(
      "Canonical Exhibition changed after load",
      "canonical-mismatch",
    );
  await writeExhibitionsSerializedFiles(
    draft.contentId,
    serializeExhibitionsEditorDraft(draft),
    canonicalFiles(entry)!,
    root,
    fileSystem,
  );
  const saved = createExhibitionsEditorDraft(
    await readExhibitionsEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new ExhibitionsSaveError("Saved Exhibition is invalid", "save-failed");
  return saved;
}

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function saveExhibitionsEditorDraftWithHero(
  draft: ExhibitionsEditorDraftState,
  baseline: ExhibitionsEditorDraftState,
  hero: ExhibitionsHeroAssetDraft,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryExhibitionsHeroAssetStore;
    fileSystem?: ExhibitionsSaveFileSystem;
    repositoryRoot?: string;
    evidenceStore?: HeroAssetPublishEvidenceStore;
  } = {},
) {
  const repositoryRoot = path.resolve(
    options.repositoryRoot ??
      (options.root ? path.dirname(path.resolve(options.root)) : "."),
  );
  const evidenceStore =
    options.evidenceStore ?? new HeroAssetPublishEvidenceStore(repositoryRoot);
  if (hero.kind !== "temporary") {
    const previousEvidence = await evidenceStore.read(
      "exhibitions",
      draft.contentId,
    );
    const saved = await saveExhibitionsEditorDraft(
      draft,
      baseline,
      options.root,
      options.fileSystem,
    );
    if (!previousEvidence || previousEvidence.state !== "pending") return saved;
    try {
      await evidenceStore.write({
        ...previousEvidence,
        content: await exhibitionsContentEvidence(
          repositoryRoot,
          draft.contentId,
          path.resolve(options.root ?? canonicalRoot),
        ),
      });
      return saved;
    } catch (error) {
      try {
        await writeExhibitionsSerializedFiles(
          draft.contentId,
          serializeExhibitionsEditorDraft(baseline),
          serializeExhibitionsEditorDraft(saved),
          options.root,
          options.fileSystem,
        );
        await evidenceStore.write(previousEvidence);
      } catch (rollback) {
        throw new ExhibitionsSaveError(
          "Failed to roll back Exhibition Save after Publish evidence failure",
          "exhibitions-save-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
      throw new ExhibitionsSaveError(
        "Failed to update Hero Publish evidence",
        "asset-save-failed",
        { cause: error },
      );
    }
  }
  if (
    !validateExhibitionsEditorDraft(draft).capabilities.save ||
    heroSrc(draft) !== hero.proposedSrc
  )
    throw new ExhibitionsSaveError(
      "Exhibition draft has invalid Hero state",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new ExhibitionsSaveError(
      "Content baseline mismatch",
      "canonical-mismatch",
    );

  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/exhibitions");
  const store = options.store ?? (await temporaryExhibitionsHeroAssetStore);
  const fileSystem = options.fileSystem ?? fs;
  const previousEvidence = await evidenceStore.read("exhibitions", draft.contentId);
  const entry = await readExhibitionsEditorEntry(draft.contentId, root);
  const canonical = createExhibitionsEditorDraft(entry);
  if (
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(baseline) ||
    !canonicalFiles(entry)
  )
    throw new ExhibitionsSaveError(
      "Canonical Exhibition changed after load",
      "canonical-mismatch",
    );

  let temporary;
  try {
    temporary = await store.read(hero.token, draft.contentId, hero.workspaceId);
  } catch (error) {
    if (
      error instanceof ExhibitionsHeroAssetError &&
      [
        "asset-temp-not-found",
        "asset-temp-expired",
        "asset-temp-unsafe",
      ].includes(error.code)
    )
      throw new ExhibitionsSaveError(
        error.message,
        error.code as
          "asset-temp-not-found" | "asset-temp-expired" | "asset-temp-unsafe",
        { cause: error },
      );
    throw error;
  }
  if (
    temporary.metadata.proposedSrc !== hero.proposedSrc ||
    temporary.metadata.sha256 !== hero.sha256 ||
    JSON.stringify(temporary.metadata.replaces) !==
      JSON.stringify(hero.replaces)
  )
    throw new ExhibitionsSaveError(
      "Temporary Hero metadata mismatch",
      "asset-temp-unsafe",
    );
  const admitted = await inspectExhibitionsHeroCandidate({
    contentId: draft.contentId,
    declaredMime: temporary.metadata.mime,
    bytes: temporary.bytes,
  });
  if (
    admitted.proposedSrc !== hero.proposedSrc ||
    admitted.sha256 !== hero.sha256
  )
    throw new ExhibitionsSaveError(
      "Temporary Hero failed revalidation",
      "asset-temp-unsafe",
    );

  const assetRootStat = await fileSystem
    .lstat(assetRoot)
    .catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new ExhibitionsSaveError(
      "Exhibitions asset root is unsafe",
      "asset-save-failed",
    );
  const basename = hero.proposedSrc.slice(EXHIBITIONS_HERO_PREFIX.length);
  const target = path.resolve(assetRoot, basename);
  if (
    !hero.proposedSrc.startsWith(EXHIBITIONS_HERO_PREFIX) ||
    path.dirname(target) !== assetRoot ||
    path.basename(target) !== basename
  )
    throw new ExhibitionsSaveError(
      "Exhibitions Hero target is unsafe",
      "asset-save-failed",
    );
  const targetStat = await fileSystem.lstat(target).catch(() => undefined);
  if (hero.replaces) {
    if (
      !targetStat?.isFile() ||
      targetStat.isSymbolicLink() ||
      hash(await fileSystem.readFile(target)) !== hero.replaces.sha256
    )
      throw new ExhibitionsSaveError(
        "Canonical Hero changed before Save",
        "canonical-mismatch",
      );
  } else if (targetStat) {
    throw new ExhibitionsSaveError(
      "Canonical Hero target appeared before Save",
      "canonical-mismatch",
    );
  }

  const directory = await directoryFor(draft.contentId, root, fileSystem);
  const next = serializeExhibitionsEditorDraft(draft);
  const id = `.exhibitions-hero-save-${randomUUID()}`;
  const contentStage = path.join(directory, `${id}-stage`);
  const contentBackup = path.join(directory, `${id}-backup`);
  const assetStage = path.join(assetRoot, `${id}-${basename}`);
  const assetBackup = path.join(assetRoot, `${id}-backup-${basename}`);
  const installedContent: (typeof files)[number][] = [];
  let assetInstalled = false;
  let assetBackedUp = false;
  let recoveryRequired = false;
  try {
    await fileSystem.mkdir(contentStage);
    await fileSystem.mkdir(contentBackup);
    for (const name of files) {
      const current = await fileSystem.readFile(
        path.join(directory, name),
        "utf8",
      );
      if (current !== canonicalFiles(entry)![name])
        throw new ExhibitionsSaveError(
          "Canonical Exhibition changed during Save",
          "canonical-mismatch",
        );
      await fileSystem.writeFile(path.join(contentStage, name), next[name], {
        encoding: "utf8",
        flag: "wx",
      });
      await fileSystem.writeFile(path.join(contentBackup, name), current, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    await fileSystem.writeFile(assetStage, temporary.bytes, { flag: "wx" });
    const stagedBytes = await fileSystem.readFile(assetStage);
    if (hash(stagedBytes) !== hero.sha256)
      throw new Error("Staged Hero hash mismatch");
    await inspectExhibitionsHeroCandidate({
      contentId: draft.contentId,
      declaredMime: temporary.metadata.mime,
      bytes: stagedBytes,
    });
    if (hero.replaces) {
      await fileSystem.rename(target, assetBackup);
      assetBackedUp = true;
    }
    await fileSystem.rename(assetStage, target);
    assetInstalled = true;
    for (const name of files) {
      await fileSystem.rename(
        path.join(contentStage, name),
        path.join(directory, name),
      );
      installedContent.push(name);
    }
    if (hash(await fileSystem.readFile(target)) !== hero.sha256)
      throw new Error("Installed Hero verification failed");
    for (const name of files)
      if (
        (await fileSystem.readFile(path.join(directory, name), "utf8")) !==
        next[name]
      )
        throw new Error("Installed Exhibition content verification failed");
    const evidence = await createExhibitionsHeroPublishEvidence({
      repositoryRoot,
      contentId: draft.contentId,
      src: hero.proposedSrc,
      declaredMime: temporary.metadata.mime,
      operation: "hero-asset-save",
      contentRoot: root,
      assetRoot,
    });
    await evidenceStore.write(evidence);
    await store.release(hero.token, draft.contentId, hero.workspaceId);
  } catch (error) {
    const failures: unknown[] = [];
    for (const name of installedContent.reverse()) {
      try {
        await fileSystem.rename(
          path.join(contentBackup, name),
          path.join(directory, name),
        );
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (assetInstalled)
      await fileSystem
        .rm(target, { force: true })
        .catch((failure) => failures.push(failure));
    if (assetBackedUp)
      await fileSystem
        .rename(assetBackup, target)
        .catch((failure) => failures.push(failure));
    {
      try {
        if (previousEvidence)
          await evidenceStore.write(
            previousEvidence as HeroAssetPublishEvidenceV1,
          );
        else await evidenceStore.delete("exhibitions", draft.contentId);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      recoveryRequired = true;
      throw new ExhibitionsSaveError(
        "Failed to roll back Exhibition Hero Save",
        "exhibitions-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof ExhibitionsSaveError) throw error;
    throw new ExhibitionsSaveError(
      "Failed to save Exhibition Hero",
      "asset-save-failed",
      { cause: error },
    );
  } finally {
    if (!recoveryRequired)
      await Promise.all([
        fileSystem
          .rm(contentStage, { recursive: true, force: true })
          .catch(() => undefined),
        fileSystem
          .rm(contentBackup, { recursive: true, force: true })
          .catch(() => undefined),
        fileSystem.rm(assetStage, { force: true }).catch(() => undefined),
        fileSystem.rm(assetBackup, { force: true }).catch(() => undefined),
      ]);
  }
  const saved = createExhibitionsEditorDraft(
    await readExhibitionsEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new ExhibitionsSaveError("Saved Exhibition is invalid", "save-failed");
  return saved;
}
