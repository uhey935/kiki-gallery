import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadNewsUnit } from "../content-loaders/news/repository.ts";
import { isContentId } from "./content-id.ts";
import {
  createNewsEditorDraft,
  validateNewsEditorDraft,
  type NewsEditorDraftState,
} from "./news-draft-state.ts";
import { serializeNewsEditorDraft } from "./news-serializer.ts";
import {
  readNewsEditorEntry,
  type NewsEditorEntryState,
} from "./news-state.ts";

const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/news");
export class NewsCreateError extends Error {
  readonly code:
    | "invalid-content-id"
    | "invalid-draft"
    | "content-id-collision"
    | "unsafe-news-root"
    | "canonical-mismatch"
    | "news-create-rollback-failed"
    | "create-failed";
  constructor(
    message: string,
    code: NewsCreateError["code"],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NewsCreateError";
    this.code = code;
  }
}
export type NewsCreateFileSystem = Pick<
  typeof fs,
  "lstat" | "mkdir" | "readFile" | "readdir" | "rename" | "rm" | "writeFile"
>;
export type NewsCreateReader = (
  contentId: string,
  root: string,
) => Promise<NewsEditorEntryState | undefined>;

async function absent(id: string, root: string, io: NewsCreateFileSystem) {
  if (!isContentId(id))
    throw new NewsCreateError("Invalid News Content ID", "invalid-content-id");
  const resolved = path.resolve(root);
  const stat = await io.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new NewsCreateError("Unsafe News root", "unsafe-news-root");
  const destination = path.resolve(resolved, id);
  if (path.dirname(destination) !== resolved)
    throw new NewsCreateError("Invalid News Content ID", "invalid-content-id");
  if (
    (await io.readdir(resolved)).some(
      (name) =>
        name.toLocaleLowerCase("en-US") === id.toLocaleLowerCase("en-US") ||
        name.toLocaleLowerCase("en-US") ===
          `${id}.md`.toLocaleLowerCase("en-US"),
    )
  )
    throw new NewsCreateError(
      "News Content ID already exists",
      "content-id-collision",
    );
  return destination;
}

export async function createNewsThreeFileEntry(
  draft: NewsEditorDraftState,
  root = canonicalRoot,
  io: NewsCreateFileSystem = fs,
  reread: NewsCreateReader = readNewsEditorEntry,
) {
  if (!validateNewsEditorDraft(draft).capabilities.save)
    throw new NewsCreateError(
      "News draft has blocking issues",
      "invalid-draft",
    );
  const destination = await absent(draft.contentId, root, io);
  const output = serializeNewsEditorDraft(draft);
  const stageRoot = path.join(
    path.resolve(root),
    `.news-create-${randomUUID()}`,
  );
  const stage = path.join(stageRoot, draft.contentId);
  let committed = false;
  try {
    await io.mkdir(stageRoot);
    await io.mkdir(stage);
    for (const name of names)
      await io.writeFile(path.join(stage, name), output[name], {
        encoding: "utf8",
        flag: "wx",
      });
    const unit = await loadNewsUnit(stage);
    if (
      unit.shared.state !== "valid" ||
      unit.locales.ja.state !== "valid" ||
      unit.locales.en.state !== "valid"
    )
      throw new NewsCreateError(
        "Serialized News failed validation",
        "canonical-mismatch",
      );
    await absent(draft.contentId, root, io);
    await io.rename(stage, destination);
    committed = true;
    const rereadEntry = await reread(draft.contentId, root);
    const saved = rereadEntry ? createNewsEditorDraft(rereadEntry) : undefined;
    if (!saved)
      throw new NewsCreateError(
        "Created News failed reread",
        "canonical-mismatch",
      );
    return saved;
  } catch (error) {
    if (committed)
      try {
        for (const name of names)
          if (
            (await io.readFile(path.join(destination, name), "utf8")) !==
            output[name]
          )
            throw new Error("created bytes changed");
        await io.rm(destination, { recursive: true, force: false });
      } catch (rollback) {
        throw new NewsCreateError(
          "Failed to roll back News Create",
          "news-create-rollback-failed",
          { cause: new AggregateError([error, rollback]) },
        );
      }
    if (error instanceof NewsCreateError) throw error;
    throw new NewsCreateError("Failed to create News", "create-failed", {
      cause: error,
    });
  } finally {
    await io
      .rm(stageRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
