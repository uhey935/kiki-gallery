# Works Delete Asset Lifecycle Semantics Finalization

| Property  | Value                                                                      |
| --------- | -------------------------------------------------------------------------- |
| Status    | Design finalized; implementation-ready, implementation remains unavailable |
| Date      | 2026-08-09                                                                 |
| Baseline  | `43a6f66` (`Implement safe Artists delete`)                                |
| Scope     | Works content Delete coordination with Works Asset Lifecycle v2            |
| Preserved | Canonical assets, ALv2 transitions/evidence, Production loaders, Delete UI |

## Decision

Works Delete is a content-removal transaction only. It recoverably moves one
`src/content/works/<content-id>.md` into the existing content-lifecycle recovery
area after exact backup proof, complete no-cascade reference analysis, reviewed
plan, and explicit confirmation.

Works Delete never moves, renames, copies, materializes, quarantines, restores,
unlinks, stages, or otherwise mutates an asset file. It also never creates,
advances, resolves, or rewrites an Asset Lifecycle v2 candidate, observation,
quarantine record, deletion manifest, or retention clock. Even an asset
referenced only by the deleted Work remains byte- and path-identical under
`public/images/works/`.

The completed prospective graph may show that an asset will have zero Works
references. That is a reviewed consequence, not an orphan observation and not
cleanup authority. A later, separately initiated Asset Lifecycle v2 scan must
acquire its own lock, build a fresh complete graph from the post-Delete canonical
repository, and create the first audit-clean orphan observation. Only that later
observation starts candidate retention. Existing candidate, quarantine, restore,
and physical-delete rules remain unchanged.

This milestone finalizes design only. It adds no Works Delete service, route,
button, Publish behavior, asset operation, schema transition, Production loader
change, or canonical content/asset mutation. Works Delete remains unavailable
until a separate implementation and browser-acceptance milestone proves this
contract.

## Authority and identity model

| State                        | Identity and Works Delete disposition                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical Work               | Markdown filename / Content ID. The one file is recoverably removed.                                                                                                    |
| Work route                   | `/works/<content-id>`. It becomes absent through canonical content absence; no redirect is created.                                                                     |
| Work references              | Artist `works_layout[].works[]`, Exhibition `works[]`, known News links, and structurally recognized Markdown routes. Any incoming reference blocks; none is rewritten. |
| Canonical asset              | Normalized `/images/works/<filename>` URL plus current bytes. Path and bytes remain unchanged.                                                                          |
| Pending upload               | Editor-only token and proposed URL. Any pending or temporary state blocks Delete.                                                                                       |
| Saved asset Publish manifest | Content ID, Markdown baseline, and exact newly materialized assets. Any non-empty unpublished manifest blocks Delete and is never consumed or rebound.                  |
| Candidate generation         | Asset URL plus SHA-256, size, and decoded format. Existing generations and histories remain byte-identical.                                                             |
| Orphan observation           | Complete audit-clean graph at an explicit observation time. Delete creates none; a later scan may start a new streak.                                                   |
| Quarantine/deletion evidence | Record/manifest identities and immutable evidence. Preserved byte-for-byte; active or uncertain state blocks Delete.                                                    |
| Content recovery evidence    | Content operation ID, exact Work preimage, recovery path, backup proof, and Publish path. It does not contain or authorize asset bytes.                                 |

Asset ownership is never inferred from a Work ID, filename prefix, directory
proximity, or the fact that the deleted Work was the last known referrer. Shared
and formerly exclusive references use the same handoff: leave the asset canonical
and let a later complete scan classify it.

## No-cascade Works reference graph

Planning reads every canonical collection through its strict current contract and
closes the complete incoming graph for the target Work. It must detect:

- every Artist `works_layout[].works[]` occurrence, including its exact section
  and array position;
- every Exhibition optional `works[]` occurrence;
- known News links targeting `/works/<content-id>`; and
- structurally recognized Markdown inline links, reference definitions, and
  autolinks targeting the Work route.

One explicit incoming reference blocks the operation. Delete never prunes an
array, removes an empty Artist layout section, nulls an Exhibition field, edits a
News link, rewrites Markdown, or performs a reciprocal update. Unsupported local
routes, malformed supported routes, unreadable/invalid sources, or parser
uncertainty make the graph incomplete and fail closed.

The outgoing `artist` relationship and ordered `images[]` references disappear
only because the Work source disappears. Their targets are not mutation targets.
Prospective validation must still prove all remaining typed references resolve and
all remaining canonical sources satisfy their collection contracts.

## Workspace, manifest, and temporary-state gates

Delete begins only from the current saved canonical Work and a quiescent Works
workspace. The following block planning and execution:

- a pending upload token, temporary upload bytes, replacement awaiting Save,
  Draft-only add/remove/reorder/alt edit, or any Draft differing from the saved
  canonical Work;
- Preview creation, upload, Save, Publish, Rename, Delete, Restore, candidate
  ledger write, quarantine, restore, or physical delete in progress;
- a non-empty Works asset Publish manifest, regardless of whether its files are
  tracked or whether its baseline appears to match; or
- a manifest whose content ID/baseline is corrupt, stale, foreign, or cannot be
  proven empty.

The operator must Publish or explicitly abandon/reconcile pending asset state and
then request a new Delete plan. Delete cannot discard a manifest, release an
upload token, infer that materialized assets are safe, or stage those assets as a
convenience. An empty manifest has no asset consequence but its absence/emptiness
must be freshly proven under execution locks.

## Asset Lifecycle stop-state inspection

Planning records a read-only snapshot of the complete Asset Lifecycle state.
Execution rebuilds it under both locks. The snapshot binds:

- the candidate-ledger hash or proven absence, schema and policy versions;
- every quarantine record identity/hash/state and matching quarantine-byte
  identity or valid terminal absence;
- every physical-delete manifest identity/hash/state;
- recovery-inspector findings and unexpected temporary/evidence entries; and
- a complete canonical Works asset inventory with URL, SHA-256, size, decoded
  format, and repository-wide references.

Completed historical records do not block when their complete evidence set is
valid. A corrupt ledger; unmatched record/bytes; unsafe or symlinked path;
unexpected temporary artifact; `prepared` or `manual-recovery-required` deletion
manifest; incomplete quarantine/restore transaction; retained, stale, malformed,
or unverifiable lock; or any recovery-inspector finding blocks Delete. Delete does
not repair, normalize, compact, or migrate evidence.

## Composed lock protocol and cross-writer exclusion

Execution uses the already accepted fixed order:

1. acquire the repository-wide content-lifecycle lock as writer `delete`;
2. make one immediate non-stealing attempt to acquire the Asset Lifecycle v2
   repository lock;
3. while holding both, assert both owner identities, rebuild the content,
   reference, asset, manifest, and lifecycle plan, and require the reviewed plan
   hash to match;
4. persist prepared content recovery evidence, recoverably move the Work, run
   prospective and installed-state validation, and persist terminal evidence;
5. release the asset lock first, then the content lock, after completion or a
   fully verified rollback.

There is no waiting while holding the content lock. If asset-lock acquisition
fails, the newly acquired content lock is released without mutation. Expiry never
permits lock stealing. Loss of either owner identity after mutation begins is a
manual-recovery stop state.

All Asset Lifecycle writers, including candidate-ledger persistence, participate
in the asset repository lock. Before implementation, every Works Save, Create,
Rename, Publish, future Delete/Restore, and other content writer must either
acquire the shared content lock or be proven excluded by the same server-side
mutation gate for the complete visibility window; UI disabled state alone is not
proof. The implementation milestone must close any uncovered writer before
exposing Delete. With that conformance, the dual lock prevents a lifecycle scan
or asset mutation from observing the Work between its visibility point and
completed validation, while also preventing a content writer from changing the
graph. This design does not silently claim that unchanged legacy writers have
already been migrated.

## Reviewed plan and asset consequences

The displayable plan binds the shared Delete fields plus:

- Work ID, route, branch/HEAD/upstream, exact Work bytes, backup generation ID,
  backup manifest hash, Retention Policy commit, recovery destination, and
  explicit content Publish path;
- the complete incoming no-cascade inventory and the outgoing Artist and ordered
  image references;
- for every referenced asset, URL, byte generation, all current referrers, and
  prospective remaining referrers;
- `prospectiveReferenceCount` and a consequence of `still-referenced` or
  `unreferenced-after-content-delete`;
- explicit `assetPathChanges: []`, `assetByteChanges: []`,
  `lifecycleEvidenceChanges: []`, `orphanObservationsCreated: []`,
  `quarantineActions: []`, and `physicalDeleteActions: []`;
- the asset/lifecycle snapshot and proof of no pending upload, Draft mutation,
  non-empty manifest, or in-flight writer; and
- schema, policy, parser/adapter versions and a deterministic plan hash.

The UI must say that an unreferenced consequence is only eligible for future
independent observation. It must not say that the asset is deleted, scheduled,
retention-started, quarantined, safe to delete, or owned by the Work.

## Backup, transaction, rollback, and recovery

`provePreDeleteBackup` must verify that the immutable generation contains the
exact current Work preimage. The generation continues to cover
`src/content/`, `public/images/`, and `.kiki-editor/` as a coherent recovery
boundary, but the Works Delete record binds only the content preimage and the
reviewed hashes of asset/lifecycle state. Backup presence never expands Delete's
asset mutation authority.

Before the canonical move, the content operation record is durably `prepared`
at the existing content-lifecycle location and the exact Work bytes have an
operation-owned, non-overwriting recovery destination. The visibility point is
the same-filesystem move of the Work into recovery. The transaction writes no
asset or Asset Lifecycle path.

On a catchable failure, rollback restores the Work byte-for-byte to an absent
canonical destination using only transaction-owned recovery bytes. It then proves:

- the Work path and bytes and the complete content/reference graph equal the
  pre-operation state;
- every inventoried canonical asset path and byte identity equals the reviewed
  state; and
- the candidate ledger, quarantine records/bytes, deletion manifests, and all
  other pre-existing lifecycle metadata are byte-for-byte unchanged.

Because Delete has no authority to overwrite asset/lifecycle drift, any mismatch,
lost lock, occupied destination, missing recovery byte, content rollback mismatch,
or uncertain state becomes `manual-recovery-required`. Preserve both lock
directories, content operation record/preimage, backup generation, lifecycle
evidence, quarantine bytes, and repository state. Do not report success or resume
any writer until manual reconciliation.

## Post-Delete handoff and retention timing

A completed content Delete creates no candidate-ledger entry and does not update
an existing entry. It may make an old observation snapshot stale as current-action
evidence, but historical observations remain immutable history.

The handoff is intentionally pull-based:

1. Works Delete completes and releases both locks with assets/evidence unchanged.
2. At a later operator-chosen time, an ordinary Asset Lifecycle scan acquires its
   repository lock and inventories the post-Delete repository.
3. If the graph is complete, audit-clean, and an asset has zero references, that
   scan records the first qualifying orphan observation under the existing byte
   generation.
4. Candidate retention starts at that observation's time, not at Delete plan,
   confirmation, execution, completion, Publish, or deployment time.
5. Later observations, quarantine, restore, and physical deletion follow existing
   ALv2 and Retention Policy rules without special Works Delete credit.

There is no automatic scan, queue, timer, candidate creation, quarantine, or
cleanup notification required for Delete completion. If no later scan is run, the
asset simply remains canonical.

## Completed evidence and Publish

Successful Works Delete leaves a saved-unpublished content deletion. Publish may
stage only the exact `src/content/works/<content-id>.md` deletion returned by
`plannedDeletePublishPaths` for the matching completed `content-delete` record.
It must begin with a clean index and verify repository identity, original HEAD
blob, absent canonical path, unchanged recovery record/bytes, and exact staged
name set.

Publish must not stage `public/`, `.kiki-editor/`, an asset whose reference count
became zero, an old saved-asset manifest, or any inferred directory/path. It does
not run an orphan observation or represent a Git content deletion as asset
deletion. A missing Work without exact completed evidence, mixed lifecycle
evidence, changed recovery state, extra staged path, or asset/lifecycle diff fails
closed. `committed-push-failed` remains a push-retry state; Delete is not rerun.

## Fail-closed states

There is no force, cascade, best-effort, auto-cleanup, evidence-repair, or
lock-stealing mode. Planning or execution stops for:

- invalid/missing Work, unsafe root/path, symlink/special file, invalid canonical
  source, or case-fold ambiguity;
- missing/stale exact backup proof or backup/Retention Policy identity drift;
- any incoming typed, News, or Markdown route reference; unsupported local route;
  parser uncertainty; invalid remaining relationship; or incomplete graph;
- missing, changed, unsafe, undecodable, or incompletely inventoried referenced
  asset bytes;
- pending/temporary upload, dirty Asset Draft, non-empty or unverifiable asset
  Publish manifest, or any in-flight workspace action;
- Git branch/HEAD/upstream/index, canonical bytes, plan/confirmation, schema,
  policy, parser, recovery, asset inventory, or lifecycle evidence drift;
- content or asset lock conflict, stale/corrupt/unverifiable owner, ownership
  loss, active lifecycle transaction, corrupt/unmatched evidence, or recovery
  finding;
- recovery destination collision, prepared-evidence failure, move or validation
  failure, rollback uncertainty, or any attempted asset/lifecycle mutation; and
- Publish without the exact completed record, with a dirty index, an extra staged
  path, or any asset/Editor-only path.

## Implementation readiness and acceptance gate

The collection-specific semantic blocker recorded by the Delete readiness audit
is closed. Works Delete is **implementation-ready** under this design, but remains
unimplemented and unavailable. Implementation must reuse the shared exact-backup,
content-recovery, reference-parser, no-cascade, content-lock, and evidence-only
Publish contracts; compose them with the existing asset lock and lifecycle
inspection rather than changing Asset Lifecycle v2.

A separate milestone must add focused service/UI tests and real-browser acceptance
for reviewed consequences, explicit confirmation, incoming-reference refusal,
pending upload/Draft/manifest refusal, both lock conflicts, lifecycle stop states,
byte-exact rollback, unchanged asset/evidence hashes, content-only Publish, success
navigation, and zero browser-console errors. It must also run the full Editor and
Journal suites, Astro check, production build, Prettier, `git diff --check`, and
prove no unintended `src/content/` or `public/` change.
