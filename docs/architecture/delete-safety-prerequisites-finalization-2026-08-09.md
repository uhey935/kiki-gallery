# Delete Safety Prerequisites Finalization

| Property  | Value                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| Status    | Shared contracts finalized; collection Delete remains unimplemented                 |
| Date      | 2026-08-09                                                                          |
| Baseline  | `6399b3a` (`Audit Delete implementation readiness`)                                 |
| Preserved | no-cascade Delete, Production loaders, canonical content/assets, Asset Lifecycle v2 |

## Decision

The common Delete safety boundary is now a versioned implementation contract. This milestone adds no Delete route, UI, canonical move, Git staging, commit, push, restore action, or asset transition. Collection Delete execution must consume these contracts rather than reproduce them.

## Closed prerequisites

### Verified pre-delete backup proof

`provePreDeleteBackup` verifies the existing immutable generation with the Backup & Recovery verifier, then requires every planned canonical preimage to match the manifest path, SHA-256, and byte size. The durable proof binds backup ID, the hash of `manifest.json`, verification time, exact source identities, and the reviewed Retention Policy commit. A pushed Git blob is useful recovery context, but is not a substitute once Delete is planned.

The generation remains outside the repository. Content recovery evidence records its identity but does not copy, prune, or selectively restore it. Content Delete evidence and its generation are preserved indefinitely until a separately reviewed content-disposal policy exists.

### Stable content recovery evidence

Schema v1 fixes the operation record at `.kiki-editor/content-lifecycle/operations/<operationId>/operation.json` and recovery bytes at `.kiki-editor/content-lifecycle/recovery/<operationId>/...`.

The record binds operation, Collection, Content ID, plan hash, repository HEAD, backup proof, exact preimages, recovery destinations, explicit Publish paths, and timestamps. `prepared` may become `completed`, `rolled-back`, or `manual-recovery-required`; terminal states cannot be rewritten into another state. Persistence uses a same-directory exclusive temporary file, rename, and directory sync. Missing, corrupt, unknown, or manual-recovery evidence is a restart stop state. Restore remains a separate, unimplemented review boundary.

The existing complete `.kiki-editor/` backup boundary captures operation records and recovery bytes. Selective restore or lifecycle pruning remains prohibited.

### Delete evidence-exclusive Publish

`plannedDeletePublishPaths` grants authority only for a completed `content-delete` record whose Publish paths exactly equal its canonical preimages. `.kiki-editor/` and `public/` paths are invalid. A future collection publisher must begin with a clean index, stage this returned list explicitly, prove every index entry absent, prove the complete staged-name set equals the list, and run the existing repository checks. It must never infer Delete authority from a missing worktree file or reuse Create/Rename evidence.

### Cross-writer locking

Schema v1 establishes one non-stealable content lifecycle lock at `.kiki-editor/content-lifecycle/repository.lock`. Its writer identity covers Save, Create, Rename, Publish, Delete, and Restore. Existing Rename implementations already use this location; new and migrated writers use the shared owner/assert/release contract. An expired, malformed, retained, or ownership-lost lock is a manual-reconciliation stop state, never permission to steal it.

Asset Lifecycle v2 keeps its distinct repository lock. The accepted Works Delete acquisition is content lifecycle lock first, then one immediate Asset Lifecycle lock attempt, with asset release first and content release last. Failure to acquire the asset lock releases the newly acquired content lock without changing content or asset state. This helper is acceptance infrastructure only and does not alter Works Delete behavior.

### Incoming-reference parser closure

`delete-reference-graph-v1` recognizes inline links, reference-definition links, and autolinks, and classifies supported canonical detail routes for Journal, Exhibitions, Artists, and Works. External URLs and fragments are non-targets. Any other local destination, malformed supported route, unreadable source, invalid typed Collection record, or incomplete definition blocks Delete. Typed adapters from existing Artist, Exhibition, Work, and News Rename inventories remain required inputs; Delete consumes their identities but never their rewriters.

No cascade, nulling, pruning, reciprocal edit, or force mode is authorized.

## Reconciliation

- **Backup & Recovery:** complete immutable generations and the existing verifier remain authoritative; no archive, remote transport, or Restore authority is added.
- **Retention Policy:** the proof records the policy commit. Content recovery evidence has indefinite preservation because the approved policy defines no disposal path for it.
- **Asset Lifecycle v2:** content Delete cannot quarantine or physically delete assets. Works dual locking only creates a stable future inspection window.
- **Rename:** the content lock location and durable preimage/evidence discipline are shared. Rename evidence never authorizes Delete Publish.
- **Publish:** current Create, Save, and Rename behavior is unchanged. Delete must use its distinct completed record and exact deletion list.

## Readiness record

| Gate                            | Result                            | Evidence                                                                |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| Pre-delete backup proof         | Closed                            | generation verification plus exact preimage binding test                |
| Recovery format/persistence     | Closed                            | schema, terminal transitions, atomic visibility and sync test           |
| Evidence-exclusive Publish plan | Closed                            | exact canonical preimage list and asset/evidence rejection test         |
| Cross-writer lock contract      | Closed for Delete foundation      | shared writer enum, non-stealable lock, Works dual-lock acceptance test |
| Reference parser closure        | Closed for shared Markdown syntax | supported-route classification and unsupported-local fail-closed test   |
| Works dual-lock order           | Accepted; behavior unchanged      | content-first acquisition and reverse-release test                      |

Journal/News Delete implementation may start next, provided its service acquires the shared lock and combines this Markdown inventory with the existing complete typed graph reader. Existing writer behavior is unchanged in this milestone because no Delete execution exists yet. Migrating duplicated Rename lock code to the helper is a mechanical follow-up, not a prerequisite for the first Delete slice. The subsequent Works Delete Asset Lifecycle Semantics Finalization closes its collection-specific lifecycle design gate: Works is implementation-ready but remains unavailable pending a separate implementation and browser acceptance milestone.

## Acceptance

Focused common-contract tests, full Editor tests, Journal tests, Astro check, production build, Prettier, and `git diff --check` must pass. `src/content/` and `public/` must remain byte-identical to the baseline. The milestone is committed once and is not pushed without explicit instruction.
