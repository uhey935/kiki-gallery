# Asset Lifecycle v2 — Second Milestone

| Property | Value                                                 |
| -------- | ----------------------------------------------------- |
| Status   | Implemented second-slice specification                |
| Date     | 2026-08-07                                            |
| Scope    | Durable candidate ledger and retention semantics      |
| Mutation | Editor-only ledger persistence; no canonical mutation |

## Decision and safety boundary

This milestone turns read-only cleanup reports into durable, reviewable observation history. A single orphan scan is never sufficient. A candidate can reach only `retention-satisfied`, and only after the configured elapsed duration **and** at least two independent, complete, audit-clean observations. `eligibleForDeletion` remains `false` at ledger and entry level. No physical delete, quarantine, restore, deletion Publish manifest, automatic cleanup, or canonical asset mutation exists in this slice.

The ledger is Editor evidence, not Production content and not a capability token. Its canonical local copy is `.kiki-editor/asset-lifecycle/works-candidate-ledger.v1.json` under the repository root. The directory is ignored by Git, is never imported by Production, and is written only by the Editor-side store using a staged file, atomic rename, and optimistic hash comparison. A team that needs shared durability must later select an approved non-Production storage authority; copying this local file is not an implicit distributed-consistency protocol.

## Schema and identity

Schema version `1` is an observation-only JSON document with a retention policy, immutable observation envelopes, candidate generations, and `eligibleForDeletion: false`. Unknown schema versions fail closed; migration is explicit and out of scope.

- Entry identity is SHA-256 of canonical public URL, asset SHA-256, byte size, and decoded format. Replacing bytes at the same URL creates a new generation and supersedes the active old generation.
- Cleanup snapshot identity remains the first-slice `snapshotSha256`, binding inventory and audit evidence.
- Observation identity is SHA-256 of canonical UTC observation time plus snapshot SHA-256. Replaying the exact envelope is idempotent. A later scan of unchanged content is a distinct observation, but time alone cannot satisfy retention because the complete-observation count must also be met.
- `firstSeen` starts the current uninterrupted complete-observation streak; `lastSeen` is its latest complete observation. `completeObservationCount` counts unique complete observations in that streak. Observation IDs provide the evidence link.
- Compatibility warnings are copied and sorted on every confirmed observation. They do not make an orphan referenced and never authorize migration or deletion.

## State transitions and re-audit rules

`observing` begins with the first complete, audit-clean orphan observation. Further unique complete observations update `lastSeen` and the count. The state becomes `retention-satisfied` only when both policy thresholds pass. It still has no deletion eligibility.

Any incomplete graph or any audit finding is treated as unreliable, recorded in the observation history, changes active candidates to `unknown-graph-incomplete`, and resets their continuity count. The next complete orphan observation starts a new streak. A complete report in which the URL is no longer a candidate changes it to `resolved-referenced`; history is retained. If the same identity later becomes orphan again, the existing generation starts a new streak. If the URL remains orphan but its bytes identity changes, the active generation becomes `superseded-identity-changed` and a new generation starts at count one.

Exact observation duplicates do nothing. Different complete observations may share the same cleanup snapshot when canonical state is unchanged; they remain independent scans because their explicit UTC observation times differ. Callers must supply the time, so all retention logic is pure and testable and never reads the wall clock internally.

## Corruption, concurrency, and manual recovery

Malformed JSON, invalid fields, unsupported schema versions, unsafe storage paths, symlinks, and stale-writer hash mismatches fail closed. Corrupt state is never silently reset or overwritten. Manual recovery means preserving the corrupt file as evidence, diagnosing or restoring a known-good ledger, then explicitly restarting observation if continuity cannot be proven. No candidate may inherit retention from unverifiable data.

Ledger persistence does not acquire a repository-wide lifecycle lock; therefore it is not sufficient for physical action. A future action must still lock, freshly rebuild the complete reference graph, compare identity and bytes, inspect Git state, and obtain explicit confirmation.

## Audit classification

### Blocker

None. This slice cannot delete, quarantine, publish deletion, or mutate canonical content/assets.

### Should-fix-before-v2-ledger-final

- **Resolved:** a single scan or elapsed time alone could otherwise mature a candidate. Retention requires both elapsed duration and at least two complete observations.
- **Resolved:** incomplete graphs, audit findings, stale writers, unsupported schema, and corrupt storage now fail closed without silently preserving continuity or overwriting evidence.
- **Resolved:** re-reference and same-URL identity replacement now retain history while ending the prior active candidate generation.
- **Resolved:** timestamps are caller-supplied and normalized; transition and retention evaluation are pure and deterministic.

### Follow-up-after-ledger

- approved shared/durable authority and backup policy if local Editor persistence is insufficient;
- repository/workspace locking and fresh pre-action re-audit;
- quarantine/restore semantics, recovery directory ownership, and expiry;
- explicit confirmation UI and dry-run review;
- deletion Publish manifest, exact-path staging, Git recovery, and crash evidence;
- ledger compaction/history retention and schema migration tooling;
- cross-collection asset ownership, batch Replace, derivatives, and storage migration.

## Explicit non-goals

No physical deletion, canonical asset auto-delete, quarantine, restore, deletion Publish manifest, cleanup route/button, automatic scheduling, Production endpoint, canonical content or asset write, batch Replace, compatibility migration, or cross-collection generalization is included.

## Completion criteria

- first, repeated, interrupted, duplicate, re-referenced, and identity-changed observations have deterministic tests;
- retention needs both time and multiple complete observations;
- corrupt/unsupported ledger and concurrent writes fail closed;
- serialization and ledger SHA-256 round-trip deterministically;
- durable writes remain in ignored Editor-only state;
- `eligibleForDeletion` is always false;
- Production dependency direction, route artifacts, canonical bytes, and existing test/build boundaries remain unchanged.
