# Asset Lifecycle v2 — First Milestone

| Property | Value                                                |
| -------- | ---------------------------------------------------- |
| Status   | Implemented first-slice specification                |
| Date     | 2026-08-07                                           |
| Scope    | Works orphan detection and deferred-cleanup evidence |
| Mutation | None                                                 |

## Decision

The first v2 milestone is **Orphan Detection / Deferred Cleanup semantics**. It inventories canonical Works sources and canonical Works assets, identifies evidence-backed orphan candidates only when the repository-wide reference graph is complete, and emits a deterministic snapshot. It does not delete, move, rename, stage, commit, publish, or otherwise mutate a canonical asset.

This order is safer than batch Replace, cross-collection expansion, derivatives, or storage migration because every later physical lifecycle operation depends on trustworthy reference discovery and fail-closed evidence. It preserves all Editor v1 invariants: canonical no-overwrite; Replace as new materialization plus reference substitution; Save/Preview/Publish boundaries; terminal manual recovery; no Production-to-Editor dependency; no Production mutation endpoint; and atomic canonical content mutation.

## Audit classification

### Blocker

None. Physical deletion is not authorized by this milestone.

### Should-fix-before-v2-first-slice

- **Resolved:** the existing inventory did not report a canonical source reference whose target asset file was missing. Such a reference now makes the graph incomplete, records `asset-reference-missing`, and changes every orphan result to `unknown`.
- **Resolved:** orphan observations had no stable evidence envelope. The new pure report helper records URL, filename, SHA-256, byte size, decoded format, compatibility warnings, zero-reference state, and a deterministic snapshot SHA-256.

### Follow-up-after-v2-first-slice

- retention duration and the clock/authority that starts it;
- durable candidate ledger and comparison of independent observations;
- repository/workspace lock and fresh pre-action reference scan;
- Git index/worktree conflict policy;
- quarantine/trash design and restore procedure;
- explicit operator confirmation and dry-run UI;
- deletion Publish manifest, exact-path staging, commit/push recovery;
- crash behavior and manual-recovery evidence;
- batch Replace;
- asset upload/replace outside Works;
- derivatives, storage migration, locale split, and content create/delete/rename;
- migration policy for grandfathered filename/format mismatches.

## Semantics and safety boundary

### Ownership and reference discovery

An asset filename never proves ownership. References are rebuilt from every regular, non-symlink canonical Works Markdown file. Shared references are valid. Client counts and draft state are not authoritative. Invalid sources, unsafe filesystem entries, decode failures, or references to missing canonical assets are audit uncertainty and make the graph incomplete.

### Candidate rule

A candidate exists only when all canonical Works sources parsed successfully, all discovered Works asset references resolve to an inventoried canonical regular file, and the candidate has exactly zero canonical references. If the graph is incomplete, the report emits no candidates. A candidate remains observation only: `eligibleForDeletion` is always `false` and its disposition is always `deferred-no-delete`.

Grandfathered filename/format mismatches may be reported as candidates because compatibility does not create a reference. Their warnings are preserved in evidence, but this milestone never migrates or deletes them.

### Race, rollback, and Publish timing

The report is a point-in-time observation, not a capability. Any future action must acquire an approved repository/workspace lock, rebuild the entire reference graph, compare path identity and bytes against the recorded hash/size, inspect Git state, and fail closed on any change. A cleanup action must occur only as its own post-Save lifecycle transaction; it must never be folded into the Save visibility point.

Because this milestone performs no mutation, it has no rollback path and cannot enter a partial deletion state. Future physical cleanup must prefer recoverable quarantine, define restoration, stage exact deletion paths only through an explicit Publish manifest, and enter terminal manual recovery after an irreversible or ambiguous failure. Push failure after a cleanup commit must be treated as committed state, not retried as another deletion.

### Dry run and evidence

Every first-slice result is a dry run. The deterministic snapshot SHA-256 binds the sorted asset identity, bytes metadata, decoded format, references, compatibility warnings, orphan classification, and audit findings. Wall-clock time and retention are deliberately excluded until a durable ledger and clock authority are designed.

## Explicit non-goals

No physical delete, automatic cleanup, quarantine, retention timer, Editor cleanup button, mutation route, Publish deletion, batch Replace, cross-collection generalization, derivative generation, storage migration, locale split, or filename/format migration is included.

## Completion criteria

- missing referenced assets make detection fail closed;
- complete inventories produce deterministic evidence-only candidates;
- incomplete inventories produce zero candidates;
- the implementation has no filesystem write/delete capability;
- current canonical content and assets remain byte-identical;
- existing Editor, Journal, build, Production-boundary, dependency-direction, and cycle checks remain green.
