import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isContentId } from "./content-id.ts";
import { createExhibitionsEditorDraft, validateExhibitionsEditorDraft, type ExhibitionsEditorDraftState } from "./exhibitions-draft-state.ts";
import { serializeExhibitionsEditorDraft, type ExhibitionsSerializedFiles } from "./exhibitions-serializer.ts";
import { readExhibitionsEditorEntry } from "./exhibitions-state.ts";
const names = ["index.yaml", "ja.md", "en.md"] as const;
const canonicalRoot = path.resolve("src/content/exhibitions");
export class ExhibitionsSaveError extends Error {
  readonly code: "invalid-content-id"|"invalid-draft"|"canonical-mismatch"|"exhibitions-save-rollback-failed"|"save-failed";
  constructor(message: string, code: ExhibitionsSaveError["code"], options?: ErrorOptions) { super(message, options); this.code = code; }
}
export type ExhibitionsSaveFileSystem = Pick<typeof fs, "lstat"|"mkdir"|"readFile"|"rename"|"rm"|"writeFile">;
export async function writeExhibitionsSerializedFiles(contentId: string, files: ExhibitionsSerializedFiles, baseline: ExhibitionsSerializedFiles, root=canonicalRoot, io: ExhibitionsSaveFileSystem=fs) {
  if (!isContentId(contentId)) throw new ExhibitionsSaveError("Invalid Content ID", "invalid-content-id");
  const directory=path.resolve(root, contentId); const stat=await io.lstat(directory).catch(()=>undefined);
  if(path.dirname(directory)!==path.resolve(root)||!stat?.isDirectory()||stat.isSymbolicLink()) throw new ExhibitionsSaveError("Unsafe Exhibition unit", "invalid-content-id");
  const token=`.exhibitions-save-${randomUUID()}`, stage=path.join(directory,`${token}-stage`), backup=path.join(directory,`${token}-backup`); const replaced:string[]=[];
  try { await io.mkdir(stage); await io.mkdir(backup); for(const name of names){ const target=path.join(directory,name); const s=await io.lstat(target); if(!s.isFile()||s.isSymbolicLink()) throw new Error("unsafe source"); const current=await io.readFile(target,"utf8"); if(current!==baseline[name]) throw new ExhibitionsSaveError("Canonical changed", "canonical-mismatch"); await io.writeFile(path.join(stage,name),files[name],{flag:"wx"}); await io.writeFile(path.join(backup,name),current,{flag:"wx"}); }
    for(const name of names){ await io.rename(path.join(stage,name),path.join(directory,name)); replaced.push(name); }
  } catch(error){ const failures=[]; for(const name of replaced.reverse()) try{ await io.rename(path.join(backup,name),path.join(directory,name)); }catch(e){failures.push(e);} if(failures.length) throw new ExhibitionsSaveError("Rollback failed", "exhibitions-save-rollback-failed",{cause:new AggregateError([error,...failures])}); if(error instanceof ExhibitionsSaveError) throw error; throw new ExhibitionsSaveError("Save failed","save-failed",{cause:error}); }
  finally { await Promise.all([io.rm(stage,{recursive:true,force:true}).catch(()=>{}),io.rm(backup,{recursive:true,force:true}).catch(()=>{})]); }
}
export async function saveExhibitionsEditorDraft(draft: ExhibitionsEditorDraftState, baseline: ExhibitionsEditorDraftState, root=canonicalRoot, io: ExhibitionsSaveFileSystem=fs){
  if(!validateExhibitionsEditorDraft(draft).capabilities.save) throw new ExhibitionsSaveError("Invalid draft","invalid-draft");
  if(draft.contentId!==baseline.contentId) throw new ExhibitionsSaveError("Content ID mismatch","canonical-mismatch");
  const entry=await readExhibitionsEditorEntry(draft.contentId,root); const canonical=createExhibitionsEditorDraft(entry);
  const canonicalFiles=serializeExhibitionsEditorDraft(canonical), baselineFiles=serializeExhibitionsEditorDraft(baseline);
  if(names.some(name=>canonicalFiles[name]!==baselineFiles[name])) throw new ExhibitionsSaveError("Canonical changed","canonical-mismatch");
  if(entry.shared.state!=="valid"||entry.locales.ja.state!=="valid"||entry.locales.en.state!=="valid") throw new ExhibitionsSaveError("Canonical unavailable","canonical-mismatch");
  await writeExhibitionsSerializedFiles(draft.contentId,serializeExhibitionsEditorDraft(draft),{"index.yaml":entry.shared.raw,"ja.md":entry.locales.ja.raw,"en.md":entry.locales.en.raw},root,io);
  return createExhibitionsEditorDraft(await readExhibitionsEditorEntry(draft.contentId,root));
}
