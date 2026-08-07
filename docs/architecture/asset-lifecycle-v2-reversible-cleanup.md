# Asset Lifecycle v2 — Reversible Cleanup

| Property | Value                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Status   | Implemented milestone specification                                     |
| Date     | 2026-08-07                                                              |
| Scope    | Fresh re-audit, repository lock, quarantine, restore, retention recheck |
| Mutation | Reversible canonical-to-Editor move only; no physical delete            |

## Decision and boundary

This milestone completes the reversible stage between durable orphan observation and any future physical deletion. Only an existing `retention-satisfied` ledger generation can be considered. The locked action reloads the durable ledger, requires the caller's ledger SHA-256 to still match, rebuilds the complete Works reference graph from canonical content and assets, and compares the new cleanup snapshot with the reviewed source snapshot. Any incomplete graph, audit finding, re-reference, same-URL identity change, snapshot change, corrupt state, or stale writer stops before mutation.

Quarantine is not deletion eligibility. Every record and every existing ledger entry keeps `eligibleForDeletion: false`; a quarantined asset is recoverable evidence, not `deletion-ready`. Production content is never rewritten, Publish is not invoked, and no Production mutation route or scheduled action is added.

## Repository lock

The Editor lifecycle lock is an atomically created directory at `.kiki-editor/asset-lifecycle/repository.lock`, outside Git and Production inputs. Its owner record contains a random identity, process ID, acquisition time, and expiry time. An operation must verify the same identity immediately before moving an asset and before restore. A second writer fails with `lock-conflict`.

Expiry does not grant automatic lock stealing. An expired lock fails as `stale-lock` and requires manual recovery: stop possible writers, preserve and inspect the owner and quarantine evidence, reconcile canonical/quarantine/record state, then remove the lock explicitly. An abnormal exit deliberately leaves the lock as a visible stop signal. Release also checks ownership; an unverifiable or replaced owner fails closed.

## Fresh re-audit and retention recheck

The end-to-end quarantine service acquires the lock before reading action inputs. Under that lock it reloads the candidate ledger with optimistic SHA-256 comparison, rebuilds inventory and reference evidence, creates a new cleanup report, and checks:

- the exact URL and identity generation is still `retention-satisfied`;
- the graph is complete and the audit is empty;
- the URL remains an orphan candidate with zero references;
- SHA-256, byte size, and decoded format still match the retained generation;
- the fresh report snapshot matches the reviewed source snapshot.

This is intentionally stricter than merely finding the same file. A changed snapshot requires review and a new action even if the particular candidate appears unchanged.

## Quarantine evidence and atomicity

The source stays under `public/images/works` until all locked checks pass. It is then moved by same-repository rename to `.kiki-editor/asset-lifecycle/quarantine/assets/<record-id>/<filename>`. The record in `quarantine/records/<record-id>.json` contains the original relative path, quarantine relative path, SHA-256, byte size, decoded format, quarantine time, source snapshot and ledger hashes, lock identity, reason, state, and fixed false deletion eligibility.

Record identity and JSON serialization are deterministic. The record is staged with exclusive creation and atomically renamed. If a catchable failure occurs after the asset move but before record commit, the implementation attempts to rename the asset back and reports `transaction-failed`. Failure to roll back is a manual-recovery terminal state; the lock and Editor-only evidence must be preserved. Temporary artifacts and quarantined asset directories without matching records are discoverable by the recovery inspector and must never be treated as valid records.

## Restore

Restore requires an owned repository lock and a valid `quarantined` record. Both stored paths must remain repository-relative and traverse only regular, non-symlink directories. The quarantined file must be a regular non-symlink file whose SHA-256 and byte size match the record. The original canonical path must not exist; no-overwrite applies even when existing bytes happen to match.

Restore renames the verified bytes back and atomically replaces the record with `state: restored`, an explicit UTC timestamp, and the restore lock identity while preserving the original quarantine lock identity. A record-write failure attempts to move the bytes back into quarantine. Corrupt records, unsafe paths, symlinks, hash/size mismatch, missing evidence, and destination conflicts fail closed. Restore does not modify content or automatically re-establish ledger retention.

## Audit classification

### Blocker

None after hardening and verification.

### Should-fix-before-Reversible-Cleanup-final

- **Resolved:** action could otherwise use reviewed-but-stale evidence. The locked action reloads ledger state, rebuilds the canonical graph, and compares ledger, snapshot, URL, and byte identity.
- **Resolved:** concurrent action or automatic stale-lock takeover could obscure ownership. Atomic lock acquisition, ownership checks, expiry classification, and manual recovery are explicit.
- **Resolved:** partial quarantine/restore could strand bytes silently. Staged records, rollback attempts, retained lock evidence, and recovery inspection define the terminal behavior.
- **Resolved:** restore could overwrite a newly created canonical identity. Destination existence always fails closed.

### Follow-up-after-Reversible-Cleanup

- physical deletion and final deletion audit;
- deletion Publish manifest and exact Git staging contract;
- explicit confirmation/review UI;
- quarantine retention, expiry, and operator policy;
- approved backup/shared ledger and lock authority;
- ledger/record compaction and schema migration;
- cross-collection asset ownership and manager generalization.

## Explicit non-goals

No physical delete, deletion manifest, automatic or scheduled cleanup, quarantine expiry, Production content rewrite, Publish, Editor HTTP action route, other-Collection manager, or cross-collection ownership inference is included.

## Completion criteria

Focused tests cover retained and rejected re-audits, re-reference, identity/snapshot change, incomplete graph, lock conflict and stale lock, quarantine and rollback, crash evidence discovery, restore and no-overwrite, hash mismatch, corrupt record, unsafe/symlink paths, and deterministic record serialization/hash. Full Editor and Journal tests, Astro check, Production build/artifact boundaries, canonical diffs, dependency direction, cycles, formatting, and `git diff --check` must remain clean.
