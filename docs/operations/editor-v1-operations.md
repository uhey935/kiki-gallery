# Editor v1 Operations

## Journal, News, Exhibitions, and Artists Delete; remaining Works safety hold

Journal Delete is available only from a saved Journal workspace and requires the absolute path of a complete verified backup generation containing the exact current three-file unit. Review the server plan, confirm it explicitly, execute, then use the separate Delete Publish action. Delete Publish commits but does not push.

Do not remove incoming references, assets, locks, recovery bytes, or evidence as part of Delete. `backup-proof-stale`, `incoming-reference`, `parser-uncertainty`, `plan-stale`, `state-mismatch`, and `lock-conflict` require correction followed by a fresh plan. If `rollback-failed` is reported, stop all Editor mutation, preserve `.kiki-editor/content-lifecycle/repository.lock`, and inspect the operation record plus recovery directory. Never delete or steal the lock to retry.

News Delete follows the same reviewed-plan and explicit-confirmation boundary for its one canonical Markdown file. It has no public detail route, retains all assets, and Delete Publish stages only the completed-evidence News deletion before returning to the News list.

Exhibitions Delete follows the same one-file lifecycle and includes its public detail route in the reviewed plan. Any supported Markdown route, known News `link`, malformed Exhibition route, or unresolved canonical reference blocks Delete. After completed recovery evidence is durable, the separate Delete Publish action commits only the Exhibition Markdown deletion and returns to the Exhibitions list. It never moves or stages the hero or any other asset.

Artists Delete follows the same one-file lifecycle and additionally closes typed `Works.artist` and `Exhibitions.artists[]` references plus known News links. It never cascades, rewrites references, or moves assets. Works Delete remains unavailable. Never infer authorization from a missing file, stage `.kiki-editor/` or assets, or repair references automatically.

Works Delete additionally requires the content lifecycle lock before the Asset Lifecycle repository lock. Release is asset first, content last. Its design is finalized, but no Works Delete implementation exists; this ordering grants no operator action until implementation and browser acceptance are complete.

## Safe start

1. Use Node.js 22.12.0 or newer and run `npm ci`.
2. Confirm `git status --short` is empty, the intended branch is checked out,
   and it has the intended upstream.
3. Run `npm run dev`, then open `/editor/`.
4. Select one existing Content ID. Check the initial values and confirm the
   action status is saved, not dirty.
5. Use Draft Preview before Save. Preview tokens expire, are bound to their
   Content ID and locale, and are local development state only.
6. Save first, review the repository diff, then Publish. Publish stages only
   the selected Content Unit and the exact saved Works asset manifest.

Create is supported for Journal, Works, Artists, Exhibitions, and News. A new
entry remains Editor-only until first Save. Choose a lowercase hyphenated
Content ID and complete the collection-owned required fields. First Save fails
closed if the ID, a case-fold equivalent, or target path exists. Journal then
creates `index.yaml`, `ja.md`, and `en.md` as one validated unit; each flat
collection creates its one existing-format Markdown source through exclusive
staging and a canonical reread. The normal saved workspace opens afterward.
Publish remains separate and includes only the exact new untracked source (and
only an already-authorized Works saved-asset manifest). Create itself never
uploads, moves, or infers ownership of assets.

Home is the canonical `home.md` singleton and has no Create capability. A
service/API slice supports reviewed Journal and News Rename; the normal
workspace does not yet expose a Rename control. Delete remains unavailable for
every collection.

Command/Ctrl+S invokes Save when Save is available. While Save, Preview,
Upload, or Publish is pending, the full form and every action are locked.

## Publish and recovery

Publish requires a clean safe repository, attached branch, matching upstream,
no unrelated staged files, a saved baseline, and publishable validation.

- `canonical-mismatch`: stop and reload. Reconcile the external change before
  reapplying the draft.
- `content-id-collision`: choose a different ID or inspect the existing path;
  never remove or overwrite it merely to retry Create.
- `unsafe-journal-root`: stop Create and inspect the canonical Journal root for
  a symlink, missing directory, or other unsafe filesystem substitution.
- `unsafe-collection-root`: stop Create and inspect the named flat collection
  root for a symlink, missing directory, or other unsafe substitution.
- `source-unavailable`: stop Rename and inspect the complete Journal three-file
  unit or schema-valid News file; do not remove files merely to retry.
- `unresolved-references`: review the reported incoming Journal route link.
  This first slice does not rewrite references and has no force mode.
- `lock-conflict`: stop mutation and inspect both content-lifecycle and
  asset-lifecycle evidence. A stale or unverifiable lock is not stolen.
- commit failure before a commit exists: preserve the working tree, inspect Git
  state, and retry only after the cause is understood.
- `committed-push-failed`: the commit exists locally. Stop using that workspace,
  record the commit shown by the UI, inspect branch/upstream state, and push the
  existing commit manually. Do not Save or Publish again from the stale page.
- `journal-create-rollback-failed`, `collection-create-rollback-failed`,
  `journal-save-rollback-failed`, or
  `asset-save-rollback-failed`: stop all Editor mutation. Preserve the working
  tree and `.kiki-editor` evidence, compare the selected canonical files/assets
  with Git and the recorded baseline, restore a consistent unit manually, then
  reload.
- `journal-rename-rollback-failed`: stop all Editor mutation and preserve
  `.kiki-editor/content-lifecycle/operations/` plus the repository lock. Compare
  both old and new Journal paths with the recorded hashes before recovery.
- `news-rename-rollback-failed`: use the same stop-and-preserve procedure for
  the recorded old/new News paths and exact source hash.

Never discard or overwrite recovery evidence merely to clear a lock.

## Backup and recovery

Stop the Editor and lifecycle writers. Before quarantine, physical delete, or
manual recovery, create and verify a generation outside the repository:

```bash
npm run backup -- create ../kiki-backup-YYYYMMDD-HHMMSS
npm run backup -- verify ../kiki-backup-YYYYMMDD-HHMMSS
```

It binds `src/content`, `public/images`, and `.kiki-editor` in one SHA-256
inventory. Git protects committed canonical files; this generation additionally
protects ignored Editor state, quarantine bytes, and uncommitted or unpushed
canonical work.

After recovering the repository from Git, restore Editor-only state by default:

```bash
npm run backup -- restore ../kiki-backup-YYYYMMDD-HHMMSS
```

Use `--include-canonical` only for reviewed disaster recovery when backup
content and images must exactly replace the Git checkout. Restore refuses a
current lifecycle lock. A captured lock is verified but not reactivated;
inspect it with ledger, quarantine, manifests, and actual bytes before resuming.

The CLI does not prune, upload, encrypt, schedule, or authorize deletion. See
`docs/architecture/backup-and-recovery-architecture-2026-08-07.md` for the
integrity model, retention boundary, and disaster-recovery procedure.

## `.kiki-editor` and Asset Lifecycle v2

`.kiki-editor/` is ignored by Git and is never production input. It may contain
temporary uploads and durable asset-lifecycle state: candidate ledgers, locks,
quarantine records and bytes, and deletion manifests.

- Keep it on reliable local storage with repository-scoped access.
- Back it up together with the repository before any quarantine or physical
  delete operation. A ledger or manifest proves history but cannot reconstruct
  physically deleted bytes.
- Preserve durable ledger, quarantine record, deletion manifest, and lock as
  one evidence set. Do not copy only selected files between repositories.
- A retained lock or `manual-recovery-required` manifest stops all lifecycle
  mutation until an operator reconciles actual bytes and evidence.
- Physical delete has no browser UI or HTTP route in v2. It remains an explicit
  operator procedure with a positive retention period, two observations, a
  fresh locked review, and per-asset confirmation. Do not perform destructive
  asset operations during ordinary browser acceptance.

## Release check

Before a release milestone, run Editor and Journal tests, Astro check, a
production build, Prettier check, and `git diff --check`. Confirm `dist/`
contains no Editor mutation/API routes or Draft Preview artifacts, and compare
canonical content/assets with the captured pre-check hashes.

## Documentation reading order

1. This operations guide.
2. `docs/architecture/editor-v1-finalization-2026-08-07.md`.
3. `docs/architecture/editor-v1-release-readiness-2026-08-07.md`.
4. `docs/architecture/journal-architecture-current.md` for Journal.
5. `docs/architecture/works-asset-manager-architecture-and-safety-specification.md`.
6. The three Asset Lifecycle v2 milestone documents for quarantine and delete
   details. Older prototype and migration documents are historical evidence.
7. `docs/architecture/backup-and-recovery-architecture-2026-08-07.md` for
   backup scope, verification, restore, and disaster recovery.

# Create operator flow

Works, Artists, Exhibitions, News, and Journal expose **Create** from their
collection list. Home is a singleton and never exposes Create.

1. Open the collection and choose **Create**.
2. Enter a lowercase, hyphenated Content ID and complete the collection's
   required fields. Preview and First Save remain blocked while validation is
   incomplete.
3. Use **Draft Preview** to inspect the unsaved Draft where the collection
   supports Preview. This does not create Production content.
4. Choose **First Save**. A collision (including a case-fold equivalent) leaves
   the Create screen and canonical files unchanged. Other failures follow the
   displayed retry, review, reload, or stop guidance.
5. After success, the Editor opens the normal saved workspace. Confirm the
   entry is saved and unpublished, then use that workspace's existing Publish
   action separately. Publish includes the newly untracked canonical file(s)
   and stages no unrelated path.

Works Create accepts an existing canonical image reference only. Asset upload,
replacement, admission, and promotion behavior is unchanged and remains an
existing-workspace operation. Artists and Exhibitions similarly reference
existing asset paths; News has no asset operation.

Cancel before First Save by leaving the page. No canonical content, asset,
commit, or Production route is created.

## Journal and News Rename v1

Open a saved Journal or News workspace and use **Rename Content ID**. Save draft
changes first. Enter the new ID and choose **Review Rename plan**. Review the
old/new identity, attached Git branch and HEAD, canonical file set, and route
effect. Execution stays disabled until the operator confirms that exact plan.
Execution changes no frontmatter or Markdown bytes, moves no assets, and does
not stage Git.

The operation is allowed only when the source is a valid exact three-file unit,
the new lowercase hyphenated ID and its case-fold equivalent are absent, Git
HEAD/branch and all source hashes still match, both lifecycle locks are clear,
and the canonical Markdown inventory contains no recognized incoming link to
the old Journal route. Any uncertainty fails closed.

After success, the Editor opens the new workspace and retains the existing
Preview/Save semantics. Publish remains separate and must show the three old deletions plus
the three new files. It stages and verifies that exact rename set; unrelated
working-tree changes remain untouched. Do not delete lifecycle evidence or a
retained lock to make a retry possible.

## News Rename safe expansion

News Rename uses the same reviewed browser flow backed by the localhost
`POST /editor/api/news-rename` plan/execute API. Review its IDs, repository
identity, source hash, and explicitly empty route sets before executing the
same plan. News has no detail route and is not a typed reference target, so the
operation moves one schema-valid Markdown file without changing its bytes,
outgoing `link`, or assets.

Success opens the new saved-unpublished workspace. Publish is separate and
must show and stage the exact old deletion plus new addition. On a collision,
choose another ID; on canonical mismatch, review a fresh plan; on lock conflict,
finish or recover the lifecycle operation. A rollback failure requires stopping
all Editor mutation and inspecting the durable operation record while leaving
the lock intact.

## Exhibitions reference-aware Rename

Exhibitions Rename uses `POST /editor/api/exhibitions-rename` and the same
reviewed-plan confirmation gate. The plan inventories the complete canonical
graph, identifies every exact News `link` to the old Exhibition route, and
shows those required edits before execution. The Exhibition source is one flat
Markdown file; that source and all listed News files are one logical
multi-file transaction. The dedicated rewriter changes only the proven link
scalar bytes and preserves every other byte, including quote style, whitespace,
line endings, body text, and asset paths.

Execution rechecks Git identity, destination absence/case-fold safety, the full
graph hash, source/reference hashes, both lifecycle locks, and the exact plan
identity before mutation. Durable evidence retains byte-exact preimages and
prospective hashes. A mutation failure restores every touched file exactly; if
that cannot be proven, the repository lock and recovery evidence remain for
manual recovery.

Success transitions to the new saved-unpublished workspace. Preview and Save
remain unchanged. Publish separately consumes the completed evidence and stages
only the old Exhibition deletion, new Exhibition addition, and exact News edits
listed by the reviewed plan. Any HEAD/canonical/evidence mismatch blocks
staging. Delete, Production loaders, and asset ownership remain unchanged.

## Artists reference-aware Rename

Artists Rename uses `POST /editor/api/artists-rename`. Its reviewed plan lists
the old/new Artist paths plus every byte-preserving `Works.artist`,
`Exhibitions.artists[]`, and recognized News-link edit. Execute requires the
exact confirmed plan and opens the new Artist workspace. Publish stages only
the completed evidence path set. Collision, graph, drift, symlink, lock,
rewrite, validation, and evidence mismatch failures have no force mode.

## Works reference-aware Rename

Works Rename uses `POST /editor/api/works-rename`. Start only from a clean,
canonically saved Works workspace with no temporary asset, in-flight action, or
non-empty unpublished asset manifest. Enter the new ID, review the exact old/new
routes, source identity, Artist/Exhibition edits, and unchanged asset
consequences, then select the exact-plan confirmation before Execute.

Execution acquires the content lifecycle lock and then the Asset Lifecycle v2
repository lock. A collision, stale/corrupt/held lock, canonical or Git drift,
unsafe path or symlink, incomplete graph, unsupported reference, recovery state,
or rewrite mismatch fails closed. Do not remove a lock to retry; inspect the
durable operation/recovery evidence first.

Success changes the workspace URL to the new Work ID. Existing image URLs and
bytes remain unchanged and Preview/Save continue normally. Publish immediately
after Rename consumes the completed Rename evidence and stages only the old Work
deletion, new byte-identical Work addition, and exact Artist/Exhibition edits.
It must contain no asset or `.kiki-editor/` path. A later ordinary Save is a
separate operation. Delete remains unavailable.

# Artists Delete

Artists Delete requires a verified canonical backup generation, a reviewed no-cascade plan, and explicit confirmation. Resolve every incoming `Works.artist`, `Exhibitions.artists[]`, known News link, or uncertain reference before retrying. A successful execution retains every asset and creates recovery evidence; use the separate Delete Publish action to commit only the evidence-authorized Artist deletion. On `manual-recovery-required`, stop all Editor mutation and preserve the lifecycle lock until the recorded bytes are reconciled.
