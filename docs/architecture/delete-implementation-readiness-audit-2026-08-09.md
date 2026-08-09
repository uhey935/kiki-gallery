# Delete Implementation Readiness Audit

| Property  | Value                                                               |
| --------- | ------------------------------------------------------------------- |
| Status    | Audit complete; implementation not authorized                       |
| Date      | 2026-08-09                                                          |
| Baseline  | `0d3f883` (`Implement safe Works rename`)                           |
| Scope     | Journal, News, Exhibitions, Artists, and Works content Delete       |
| Preserved | Delete behavior, Production loaders, canonical content/assets, ALv2 |

## Decision

Delete is **not ready for a single implementation milestone**. The existing
safety specification remains directionally correct, but it does not yet close
four implementation-level authorities: pre-content-delete backup proof,
content recovery record/retention schema, evidence-exclusive Publish staging,
and a fully specified Works content/asset lock and stop-state protocol.

No Delete route, UI, service, filesystem mutation, staging behavior, Production
loader change, or Asset Lifecycle v2 transition is authorized by this audit.
The safe next slice is the narrow News content Delete design/implementation
after the shared blockers below are resolved. Collection readiness describes
the collection-specific graph and transaction shape; it does not override the
shared implementation hold.

## Reconciled authority

The Create/Rename/Delete specification remains the content-removal authority,
with these post-Rename clarifications:

- Delete uses the implemented content-lifecycle lock and the same durable,
  preimage-backed, prospective-validation transaction discipline as Rename.
- Content is recoverably moved, never unlinked. Asset quarantine and physical
  deletion remain separate Asset Lifecycle v2 operations and are never an
  implicit step, confirmation, or Publish side effect of content Delete.
- Every content Delete plans against the complete canonical reference graph.
  Unknown, unreadable, unsafe, invalid, or unsupported sources fail closed.
- Explicit incoming references block. The currently approved Delete contract
  has no cascade, nulling, array pruning, reciprocal edit, or force mode.
  Rename's byte-preserving rewriters may be reused as parsing primitives, but
  they do not authorize Delete reference edits.
- A Work Delete acquires the content-lifecycle lock and then the Asset
  Lifecycle v2 repository lock, with one immediate fail-closed asset-lock
  attempt and reverse-order release. It preserves asset URLs, bytes, ledgers,
  quarantine records, deletion manifests, and backup evidence byte-for-byte.
- Publish stages only canonical content deletions proven by one completed
  content Delete record. It never stages `.kiki-editor/`, canonical assets, or
  lifecycle evidence, and never treats a Git deletion as physical asset
  deletion.

## Shared state and transaction model

### Plan and confirmation

A displayable plan binds operation ID/type, collection and Content ID, routes,
Git branch/HEAD/upstream, exact canonical files and byte identities, complete
incoming and outgoing reference inventory, asset references and classifications,
recovery destinations, absence proofs, lock/evidence state, schema/policy/
adapter versions, and deterministic plan hash. Execution requires explicit
confirmation for that exact plan and rebuilds it under the owned lock.

Planning and confirmation do not mutate, stage, commit, push, quarantine, or
reserve a path. Dirty Draft state, Save/Preview/Publish in progress, an
unpublished Create/Rename operation affecting the unit, or stale confirmation
blocks execution.

### Recoverable removal and recovery

The transaction writes and durably exposes a prepared Editor-only record before
the first canonical move. It moves exactly one flat file, or the complete
Journal three-file directory, into an operation-owned recovery directory on
the same filesystem without overwrite. It then rereads the prospective
repository, proves the source and routes absent, validates the complete graph,
and records `completed`.

Failure before the visibility point restores only exact transaction-owned
bytes to absent canonical destinations. Successful rollback is byte-for-byte
and records `rolled-back`. Identity drift, missing recovery bytes, occupied
destinations, lock loss, or unverifiable state records
`manual-recovery-required`, preserves both lock and evidence, and disables all
content and interacting asset mutation.

Restore is a separately reviewed operation. It requires a valid completed
record, exact recovery bytes, absent safe canonical destinations, fresh Git,
reference, route, schema, asset, and lock validation, and no overwrite. This
audit does not authorize a Restore implementation.

### Assets, quarantine, and retention

All assets referenced only by the removed content remain canonical after
content Delete. The completed prospective graph may make a Works asset a future
orphan candidate, but it does not create an observation, satisfy retention,
quarantine bytes, or authorize physical deletion. A later lifecycle operator
must start with a new locked complete graph and the unchanged Asset Lifecycle
v2 rules.

Shared, ambiguous, missing, unsafe, or incompletely inventoried assets block
claims of exclusivity and can never be moved by content Delete. Recovery bytes
and Delete records are content evidence, not asset candidates. Until a disposal
policy is implemented, they are preserved indefinitely and excluded from every
asset cleanup and Publish inventory.

### Publish

A successful Delete leaves a saved-unpublished canonical deletion. Publish
must require one matching completed Delete record, a clean pre-existing index,
the same repository identity, exact Git-HEAD preimage blobs, absent canonical
paths, and no extra changed path inside the operation boundary. It stages the
explicit deletion list, proves each index entry absent, proves no path outside
that list was staged, runs the normal repository-wide verification, then
commits and pushes.

Publish must not infer authorization from a missing worktree file. A deletion
without matching completed evidence, mixed Create/Rename/Delete evidence,
changed recovery state, or an asset/lifecycle path in the proposed set fails
closed. Push failure remains `committed-push-failed`; Delete is not rerun.

## Collection readiness matrix

| Collection  | Classification       | Canonical removal                          | Incoming reference disposition                                                                                    | Assets and principal hazards                                                                                                                  |
| ----------- | -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal     | Implementation-ready | Complete `index.yaml + ja.md + en.md` unit | Any recognized Journal route link blocks; incomplete locale/body inventory blocks                                 | Journal hero/body assets remain canonical. Missing/extra unit files, placeholder/invalid locale state, or partial-unit recovery fail closed.  |
| News        | Implementation-ready | One flat Markdown file                     | No typed incoming target exists today; its optional outgoing `link` disappears with the source                    | News image resolution and link target are outgoing only; asset paths remain unchanged. No public detail route is deleted.                     |
| Exhibitions | Implementation-ready | One flat Markdown file                     | Exact News `/exhibitions/<id>` and structurally recognized Markdown links block; no automatic rewrite             | Hero/body assets remain canonical. Derived index/detail/Home/Artist views disappear only from canonical absence.                              |
| Artists     | Implementation-ready | One flat Markdown file                     | Any Work `artist`, Exhibition `artists[]`, News `/artists/<id>`, or recognized Markdown link blocks               | Mandatory Work ownership means many Artists are ineligible. Hero and related Work/Exhibition assets remain canonical.                         |
| Works       | Blocked/deferred     | One flat Markdown file                     | Artist `works_layout[].works[]`, Exhibition `works[]`, and recognized route links block under the no-cascade rule | Requires dual locks, complete ALv2 stop-state inspection, pending upload/manifest gates, and proof that post-delete asset state is untouched. |

“Implementation-ready” means the approved no-reference-update behavior and
transaction boundary are sufficient once the shared gates are implemented. It
does not mean every current entry is eligible. “Blocked/deferred” means a
collection-specific design/acceptance slice is still required.

No collection is classified `ready-with-defined-reference-updates`: removing
an Artist or Exhibition reference, pruning a Work from an Artist layout or
Exhibition, or replacing a News link changes editorial meaning. The current
Delete authority explicitly prohibits those changes. Such behavior requires a
separate reviewed specification and cannot be inferred from Rename rewriters.

## Fail-closed matrix

Delete planning or execution stops for:

- invalid/missing source, partial Journal unit, unexpected nested file, unsafe
  root/path, symlink, special file, or case-fold ambiguity;
- dirty or pending workspace state; in-flight Save, Preview, Publish, Create,
  Rename, Delete, Restore, quarantine, or physical delete;
- branch, HEAD, upstream, canonical bytes, Git index, plan, confirmation,
  schema/policy/adapter, route, reference graph, or asset inventory drift;
- any explicit incoming reference, unsupported internal route/Markdown node,
  invalid canonical entry, unresolved typed reference, or incomplete graph;
- missing/changed/unsafe referenced asset bytes or an unsupported asset root;
- content lock conflict, or for Works any active, stale, corrupt, lost, or
  unverifiable Asset Lifecycle lock/evidence state;
- pending Works upload/Draft asset mutation, non-empty unpublished asset
  manifest, unmatched quarantine bytes/record, prepared or
  `manual-recovery-required` physical-delete manifest, or recovery-inspector
  finding;
- unavailable/unverified required backup, recovery destination collision,
  evidence write failure, prospective validation failure, canonical reread
  mismatch, rollback uncertainty, or attempted asset/evidence mutation; and
- Publish without exact completed evidence, with a dirty index, with an extra
  staged path, or with any `.kiki-editor/` or asset path.

There is no force, cascade, best-effort, partial-unit, auto-quarantine,
auto-publish, or lock-stealing mode.

## Unresolved shared implementation gates

These gaps prevent implementation even for collection-ready slices:

1. **Pre-content-delete backup proof.** Define whether exact source bytes must
   already exist in pushed Git or in a newly verified generation, and require a
   verified generation for uncommitted/unpushed source or unresolved Editor
   state. Bind its manifest identity and policy commit to the Delete record.
2. **Content recovery evidence schema.** Fix repository-relative recovery root,
   prepared/completed/rolled-back/manual-recovery states, preimages, hashing,
   fsync/visibility point, restart inspection, idempotency, restore linkage,
   and indefinite-preservation behavior. Confirm the existing whole
   `.kiki-editor/` backup/restore boundary captures it without selective restore.
3. **Publish evidence exclusivity.** Existing collection publishers understand
   Create/Rename working-tree shapes. Delete must add a distinct completed
   evidence contract so an arbitrary missing canonical file cannot be staged as
   an authorized Delete.
4. **Cross-writer lock conformance.** Prove Save, Create, all Rename paths,
   Publish, future Delete/Restore, and interacting Asset Lifecycle writers
   cannot cross the content visibility point. Define restart behavior for a
   retained content lock before exposing Delete.
5. **Reference-parser closure.** Turn each collection's audited incoming forms,
   including structurally recognized Markdown links and unsupported-route
   reporting, into complete versioned adapters with deletion-specific tests.
6. **Works Delete milestone.** Specify and browser-test pending manifest/Draft
   gates, content-then-asset lock order, lifecycle evidence snapshot, unchanged
   asset/lifecycle assertions, rollback with both locks, and asset-free Publish.

## Milestone recommendation

Resolve gates 1–5 as a narrow shared foundation and implement **News Delete**
first. News proves flat recoverable removal, durable evidence, restart/rollback,
Restore separation, and evidence-exclusive Publish without route or incoming
reference edits. Journal should follow to prove complete-unit recovery;
Exhibitions and Artists then reuse the complete blocking inventory. Works stays
last and requires its own Asset Lifecycle coordination milestone.

## Audit acceptance

This audit changes documentation only. Completion requires Prettier and
`git diff --check`, a clean code diff, and no changes under `src/content/` or
`public/`. The readiness commit is local and is not pushed without explicit
instruction.
