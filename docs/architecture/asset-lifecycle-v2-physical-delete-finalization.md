# Asset Lifecycle v2 — Physical Delete & Finalization

| Property | Value                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Status   | Implemented final milestone specification                                                                               |
| Date     | 2026-08-07                                                                                                              |
| Scope    | Explicit per-asset confirmation, quarantine retention, final locked re-audit, physical deletion, durable final evidence |
| Mutation | One verified file inside Editor-only quarantine; never canonical content or a canonical asset path                      |

## Decision and capability boundary

This milestone adds the only physical-delete capability in Asset Lifecycle v2. It is deliberately narrow: one already-quarantined Works asset, one reviewed evidence generation, one explicit confirmation, and one repository lock. There is no automatic cleanup, timer, batch operation, HTTP action route, Publish action, or canonical-content rewrite.

Physical deletion is not inferred from orphan state, ledger retention, quarantine state, age, or an earlier user choice. All conditions are independently necessary. The caller first obtains a displayable deletion review from a locked final re-audit, presents that exact review to the operator, obtains an explicit per-asset confirmation, and submits both to a second locked execution. The execution rebuilds and compares all evidence again. A confirmation cannot authorize another asset or another ledger, record, or snapshot generation.

## Explicit confirmation contract

The review contains the candidate identity, public URL, canonical source path, quarantine record ID and SHA-256, asset SHA-256/size/format, quarantine time and age, current ledger SHA-256, final audit snapshot SHA-256, and retention observations. `reviewIdentity` is a deterministic hash of that complete review.

Explicit confirmation creates a second deterministic identity bound to the review identity, candidate identity, quarantine record hash, ledger hash, final snapshot hash, and confirmation time. The delete API rejects a missing confirmation, a malformed identity, a confirmation for another review/asset, and any confirmation whose bound evidence is no longer current. Merely preparing or displaying a review never deletes bytes.

No browser-level confirmation UI is introduced here. The typed review/confirmation contract is the application boundary for a future UI; exposing the delete function through an HTTP endpoint is prohibited by this milestone.

## Quarantine retention policy

Immediate deletion after quarantine is invalid. The policy requires both a positive minimum age and at least two distinct matching quarantine observations. Each observation is bound to the quarantine record SHA-256 and asset SHA-256 and must fall between `quarantinedAt` and the caller-supplied current time. Duplicate timestamps, observations for another record generation, observations for another asset identity, and future observations do not count.

Retention calculation is a pure function. Wall-clock access is not hidden inside it: the caller supplies an ISO time, enabling boundary tests without clock mocking. The implementation provides policy mechanics but does not choose or schedule an operational expiry. An operator-owned policy must set the actual minimum duration before use.

## Final locked re-audit

Review preparation and deletion execution each acquire the existing repository lifecycle lock. Under the lock they reload the durable ledger and quarantine record, rebuild canonical Works inventory and the reference graph, and verify:

- the graph is complete and its audit is empty;
- the ledger still contains the exact retained identity generation;
- ledger and quarantine record hashes match the reviewed generation;
- the record is valid and still `quarantined`;
- the canonical source path is absent; any replacement identity at that path stops deletion;
- the quarantined identity agrees with the retained ledger entry;
- retention age and observations remain satisfied;
- execution snapshot equals the reviewed snapshot;
- explicit confirmation is authentic and bound to all current evidence;
- lock acquisition/ownership remains valid.

A reference to the quarantined URL normally produces a missing-reference audit finding and therefore fails closed. If a same-URL canonical file appears, deletion stops regardless of whether it has the same or a different byte identity. Snapshot drift requires a new review and confirmation even when the target itself appears unchanged.

## Physical deletion and file safety

The capability resolves only the quarantine path encoded by a valid record. It requires repository-contained paths, regular non-symlink parent directories, and a regular non-symlink target. Immediately before unlink it rereads the bytes and verifies SHA-256, byte size, decoded image format, and the format recorded at quarantine. Unsafe paths, missing files, symlinks, corrupt records, changed bytes, and unexpected file types stop before deletion.

The function never unlinks `public/images/works`, never writes a canonical content unit, and never invokes a Production consumer or Publish. Production has no import or route to this capability.

## Durable manifest, idempotency, and recovery

Before unlink, the operation atomically writes an Editor-only `prepared` manifest under `.kiki-editor/asset-lifecycle/deletion-manifests/`. It records target identity, public/canonical/quarantine paths, quarantine record hash, ledger hash, final snapshot hash, confirmation identity, lock identity, retention evidence, preparation time, expected deleted hash/size/format, and result state. Serialization and manifest hashing are deterministic.

After successful unlink it atomically replaces the manifest with `physically-deleted`, an explicit `deletedAt`, and the final result. Repeating the same confirmed operation returns the matching completed manifest without attempting another unlink. A failure before unlink leaves the asset intact and releases the lock. A failure after unlink is never presented as rollback: the operation best-effort records `manual-recovery-required`, preserves the repository lock, record, manifest, and temporary evidence, and requires manual reconciliation.

The quarantine record remains immutable historical evidence rather than being rewritten after the irreversible action. The completed deletion manifest is the authoritative `physically-deleted` history state. This avoids making a failed record update look like a failed delete and avoids mutating the earlier reversible-cleanup milestone's evidence contract.

Physical deletion destroys the quarantined asset body. Restore is impossible after successful unlink unless a separately governed backup contains the bytes. The manifest, ledger, hashes, and quarantine record prove what was deleted but cannot reconstruct it.

## Audit classification

### Blocker

None after implementation and focused hardening.

### Should-fix-before-Physical-Delete-final

- **Resolved:** deletion could occur from retention or quarantine state without a contemporaneous human decision. Execution now requires an explicit confirmation bound one-to-one to the reviewed target and evidence generation.
- **Resolved:** quarantine could be deleted immediately. A positive age and at least two distinct matching observations are mandatory and pure-clock tested.
- **Resolved:** review could become stale before unlink. Execution repeats the locked ledger/record/inventory/reference audit and exact snapshot comparison.
- **Resolved:** deletion could lose before/after evidence or hide a partial result. A prepared manifest precedes unlink; completed/manual-recovery states follow it, and post-delete failure preserves the lock.
- **Resolved:** a path swap or byte/type change could redirect deletion. Parent, symlink, regular-file, SHA-256, size, and decoded-format checks occur immediately before unlink.
- **Resolved:** retry could misreport a missing file. The same completed confirmation is idempotent; other missing-file states fail closed.

### Follow-up-after-v2

- approved backup policy and shared repository/lock authority;
- operational quarantine expiry and retention-duration governance;
- ledger, record, and manifest compaction plus schema migration;
- cross-collection asset ownership and shared-asset authority;
- browser-level destructive-action confirmation harness;
- storage migration, derivatives, locale split, and batch Replace semantics.

These are not v2 blockers because v2 provides no automation, shared writer, browser endpoint, cross-collection inference, or storage migration. Its complete claim is intentionally limited to manually initiated, individually confirmed Works assets in one local repository authority.

## Operational procedure

1. Confirm the candidate ledger generation has completed its orphan retention stage and the asset has already been quarantined through Reversible Cleanup.
2. Apply an explicit operational quarantine policy with a positive minimum age and at least two independent observations.
3. Prepare a locked deletion review and display every review field to the operator.
4. Obtain explicit confirmation for that exact review. Do not reuse a prior confirmation after any evidence drift.
5. Execute the single-target delete. Preserve the completed manifest with the ledger and quarantine record.
6. If `manual-recovery-required` or a retained lock appears, stop all lifecycle mutation. Preserve evidence and reconcile the actual quarantine file and manifest state manually. Do not steal a stale lock.

No production operation should depend on, stage, publish, or consume `.kiki-editor/` evidence. Do not operate physical deletion without an approved backup decision when loss of the source bytes would be unacceptable.

## Completion criteria

Focused tests cover confirmation generation and binding, missing/stale confirmation, retention failure/success, successful and rejected final re-audit, graph/reference/identity/ledger/record/snapshot drift, lock conflict, successful delete, unsafe symlink, hash mismatch, double delete, post-delete manual recovery, and deterministic manifest serialization/hash. Full Editor and Journal tests, Astro check, production build/artifact boundaries, canonical diffs, dependency direction, cycles, Prettier, and `git diff --check` must remain clean before the milestone is committed.
