import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import {
  createJournalEditorDraft,
  validateJournalEditorDraft,
  type JournalEditorDraftState,
} from "./journal-draft-state.ts";
import {
  serializeJournalEditorDraft,
  type JournalSerializedFiles,
} from "./journal-serializer.ts";
import { readJournalEditorEntry } from "./journal-state.ts";
import {
  JOURNAL_HERO_PREFIX,
  JournalHeroAssetError,
  inspectJournalHeroCandidate,
  temporaryJournalHeroAssetStore,
  type JournalHeroAssetDraft,
  type TemporaryJournalHeroAssetStore,
} from "./journal-hero-assets.ts";
import {
  journalContentEvidence,
  createJournalHeroPublishEvidence,
} from "./journal-hero-publish-evidence.ts";
import { assertJournalMutationAdmitted } from "./journal-manual-recovery.ts";
import {
  HeroAssetPublishEvidenceStore,
  type HeroAssetPublishEvidenceV1,
} from "./hero-asset-publish-evidence.ts";

const files = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/journal");
const heroSrc = (draft: JournalEditorDraftState) =>
  draft.shared.state === "editable" ? draft.shared.value.hero.image : "";
const canonicalFiles = (
  entry: Awaited<ReturnType<typeof readJournalEditorEntry>>,
) => {
  if (
    entry.shared.state !== "valid" ||
    entry.locales.ja.state !== "valid" ||
    entry.locales.en.state !== "valid"
  )
    return undefined;
  return {
    "index.yaml": entry.shared.raw,
    "ja.md": entry.locales.ja.raw,
    "en.md": entry.locales.en.raw,
  };
};
export class JournalSaveError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "canonical-mismatch"
    | "asset-temp-not-found"
    | "asset-temp-expired"
    | "asset-temp-unsafe"
    | "asset-save-failed"
    | "journal-save-rollback-failed"
    | "save-failed";
  constructor(
    message: string,
    code: JournalSaveError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JournalSaveError";
    this.code = code;
  }
}
export type JournalSaveFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "rename" | "rm" | "writeFile"
>;

async function directoryFor(
  contentId: string,
  root: string,
  fileSystem: JournalSaveFileSystem,
) {
  if (!isContentId(contentId))
    throw new JournalSaveError(
      "Invalid Journal Content ID",
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
    throw new JournalSaveError("Unsafe Journal unit", "invalid-content-id");
  return directory;
}

export async function writeJournalSerializedFiles(
  contentId: string,
  next: JournalSerializedFiles,
  baseline: JournalSerializedFiles,
  root = canonicalRoot,
  fileSystem: JournalSaveFileSystem = fs,
) {
  const directory = await directoryFor(contentId, root, fileSystem);
  const id = `.journal-save-${randomUUID()}`;
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
        throw new Error(`Unsafe Journal source: ${name}`);
      const current = await fileSystem.readFile(target, "utf8");
      if (current !== baseline[name])
        throw new JournalSaveError(
          "Canonical Journal changed during Save",
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
      throw new JournalSaveError(
        "Failed to roll back Journal Save",
        "journal-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof JournalSaveError) throw error;
    throw new JournalSaveError("Failed to save Journal", "save-failed", {
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

export async function saveJournalEditorDraft(
  draft: JournalEditorDraftState,
  baseline: JournalEditorDraftState,
  root = canonicalRoot,
  fileSystem: JournalSaveFileSystem = fs,
) {
  await assertJournalMutationAdmitted(draft.contentId, root);
  if (!isContentId(draft.contentId))
    throw new JournalSaveError(
      "Invalid Journal Content ID",
      "invalid-content-id",
    );
  if (!validateJournalEditorDraft(draft).capabilities.save)
    throw new JournalSaveError(
      "Journal draft has blocking issues",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new JournalSaveError(
      "Content baseline mismatch",
      "canonical-mismatch",
    );
  const entry = await readJournalEditorEntry(draft.contentId, root);
  const canonical = createJournalEditorDraft(entry);
  if (
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(baseline) ||
    !canonicalFiles(entry)
  )
    throw new JournalSaveError(
      "Canonical Journal changed after load",
      "canonical-mismatch",
    );
  await writeJournalSerializedFiles(
    draft.contentId,
    serializeJournalEditorDraft(draft),
    canonicalFiles(entry)!,
    root,
    fileSystem,
  );
  const saved = createJournalEditorDraft(
    await readJournalEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new JournalSaveError("Saved Journal is invalid", "save-failed");
  return saved;
}

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export async function saveJournalEditorDraftWithHero(
  draft: JournalEditorDraftState,
  baseline: JournalEditorDraftState,
  hero: JournalHeroAssetDraft,
  options: {
    root?: string;
    assetRoot?: string;
    store?: TemporaryJournalHeroAssetStore;
    fileSystem?: JournalSaveFileSystem;
    repositoryRoot?: string;
    evidenceStore?: HeroAssetPublishEvidenceStore;
  } = {},
) {
  await assertJournalMutationAdmitted(
    draft.contentId,
    path.resolve(options.root ?? canonicalRoot),
  );
  const repositoryRoot = path.resolve(
    options.repositoryRoot ??
      (options.root ? path.dirname(path.resolve(options.root)) : "."),
  );
  const evidenceStore =
    options.evidenceStore ?? new HeroAssetPublishEvidenceStore(repositoryRoot);
  if (hero.kind !== "temporary") {
    const baselineHero = heroSrc(baseline);
    if (hero.kind !== "existing" || !hero.src || heroSrc(draft) !== hero.src)
      throw new JournalSaveError(
        "Journal Hero requires a validated replacement before Save",
        "invalid-draft",
      );
    if (hero.src !== baselineHero) {
      const match = hero.src.match(
        new RegExp(
          `^${JOURNAL_HERO_PREFIX.replaceAll("/", "\\/")}${draft.contentId}\\.(avif|jpg|png|webp)$`,
        ),
      );
      const format = match?.[1] as "avif" | "jpg" | "png" | "webp" | undefined;
      const mime = format
        ? (
            {
              avif: "image/avif",
              jpg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
            } as const
          )[format]
        : undefined;
      const assetRoot = path.resolve(
        options.assetRoot ?? "public/images/journal",
      );
      const target = format
        ? path.join(assetRoot, `${draft.contentId}.${format}`)
        : "";
      const stat = target
        ? await (options.fileSystem ?? fs).lstat(target).catch(() => undefined)
        : undefined;
      if (!mime || !stat?.isFile() || stat.isSymbolicLink())
        throw new JournalSaveError(
          "Journal Hero reuse target is unavailable or unsafe",
          "invalid-draft",
        );
      const bytes = await (options.fileSystem ?? fs).readFile(target);
      const inspected = inspectJournalHeroCandidate({
        contentId: draft.contentId,
        declaredMime: mime,
        bytes,
      });
      if (inspected.proposedSrc !== hero.src)
        throw new JournalSaveError(
          "Journal Hero reuse target failed decoded validation",
          "invalid-draft",
        );
    }
    const previousEvidence = await evidenceStore.read(
      "journal",
      draft.contentId,
    );
    const saved = await saveJournalEditorDraft(
      draft,
      baseline,
      options.root,
      options.fileSystem,
    );
    if (!previousEvidence || previousEvidence.state !== "pending") return saved;
    try {
      await evidenceStore.write({
        ...previousEvidence,
        content: await journalContentEvidence(
          repositoryRoot,
          draft.contentId,
          path.resolve(options.root ?? canonicalRoot),
        ),
      });
      return saved;
    } catch (error) {
      try {
        await writeJournalSerializedFiles(
          draft.contentId,
          serializeJournalEditorDraft(baseline),
          serializeJournalEditorDraft(saved),
          options.root,
          options.fileSystem,
        );
        await evidenceStore.write(previousEvidence);
      } catch (rollback) {
        throw new JournalSaveError(
          "Failed to roll back Journal Save after Publish evidence failure",
          "journal-save-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
      throw new JournalSaveError(
        "Failed to update Hero Publish evidence",
        "asset-save-failed",
        { cause: error },
      );
    }
  }
  if (
    !validateJournalEditorDraft(draft).capabilities.save ||
    heroSrc(draft) !== hero.proposedSrc
  )
    throw new JournalSaveError(
      "Journal draft has invalid Hero state",
      "invalid-draft",
    );
  if (draft.contentId !== baseline.contentId)
    throw new JournalSaveError(
      "Content baseline mismatch",
      "canonical-mismatch",
    );

  const root = path.resolve(options.root ?? canonicalRoot);
  const assetRoot = path.resolve(options.assetRoot ?? "public/images/journal");
  const store = options.store ?? (await temporaryJournalHeroAssetStore);
  const fileSystem = options.fileSystem ?? fs;
  const previousEvidence = await evidenceStore.read("journal", draft.contentId);
  const entry = await readJournalEditorEntry(draft.contentId, root);
  const canonical = createJournalEditorDraft(entry);
  if (
    !canonical ||
    JSON.stringify(canonical) !== JSON.stringify(baseline) ||
    !canonicalFiles(entry)
  )
    throw new JournalSaveError(
      "Canonical Journal changed after load",
      "canonical-mismatch",
    );

  let temporary;
  try {
    temporary = await store.read(hero.token, draft.contentId, hero.workspaceId);
  } catch (error) {
    if (
      error instanceof JournalHeroAssetError &&
      [
        "asset-temp-not-found",
        "asset-temp-expired",
        "asset-temp-unsafe",
      ].includes(error.code)
    )
      throw new JournalSaveError(
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
    throw new JournalSaveError(
      "Temporary Hero metadata mismatch",
      "asset-temp-unsafe",
    );
  const admitted = inspectJournalHeroCandidate({
    contentId: draft.contentId,
    declaredMime: temporary.metadata.mime,
    bytes: temporary.bytes,
  });
  if (
    admitted.proposedSrc !== hero.proposedSrc ||
    admitted.sha256 !== hero.sha256
  )
    throw new JournalSaveError(
      "Temporary Hero failed revalidation",
      "asset-temp-unsafe",
    );

  const assetRootStat = await fileSystem
    .lstat(assetRoot)
    .catch(() => undefined);
  if (!assetRootStat?.isDirectory() || assetRootStat.isSymbolicLink())
    throw new JournalSaveError(
      "Journal asset root is unsafe",
      "asset-save-failed",
    );
  const basename = hero.proposedSrc.slice(JOURNAL_HERO_PREFIX.length);
  const target = path.resolve(assetRoot, basename);
  if (
    !hero.proposedSrc.startsWith(JOURNAL_HERO_PREFIX) ||
    path.dirname(target) !== assetRoot ||
    path.basename(target) !== basename
  )
    throw new JournalSaveError(
      "Journal Hero target is unsafe",
      "asset-save-failed",
    );
  const targetStat = await fileSystem.lstat(target).catch(() => undefined);
  if (hero.replaces) {
    if (
      !targetStat?.isFile() ||
      targetStat.isSymbolicLink() ||
      hash(await fileSystem.readFile(target)) !== hero.replaces.sha256
    )
      throw new JournalSaveError(
        "Canonical Hero changed before Save",
        "canonical-mismatch",
      );
  } else if (targetStat) {
    throw new JournalSaveError(
      "Canonical Hero target appeared before Save",
      "canonical-mismatch",
    );
  }

  const directory = await directoryFor(draft.contentId, root, fileSystem);
  const next = serializeJournalEditorDraft(draft);
  const id = `.journal-hero-save-${randomUUID()}`;
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
        throw new JournalSaveError(
          "Canonical Journal changed during Save",
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
    inspectJournalHeroCandidate({
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
        throw new Error("Installed Journal content verification failed");
    const evidence = await createJournalHeroPublishEvidence({
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
        else await evidenceStore.delete("journal", draft.contentId);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) {
      recoveryRequired = true;
      throw new JournalSaveError(
        "Failed to roll back Journal Hero Save",
        "journal-save-rollback-failed",
        { cause: new AggregateError([error, ...failures]) },
      );
    }
    if (error instanceof JournalSaveError) throw error;
    throw new JournalSaveError(
      "Failed to save Journal Hero",
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
  const saved = createJournalEditorDraft(
    await readJournalEditorEntry(draft.contentId, root),
  );
  if (!saved)
    throw new JournalSaveError("Saved Journal is invalid", "save-failed");
  return saved;
}
