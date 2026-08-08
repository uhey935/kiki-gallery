# Retention Policy Finalization

| Property      | Value                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Status        | Approved design                                                                                  |
| Approved      | 2026-08-08                                                                                       |
| Scope         | Retention, deletion authority, holds, evidence preservation, and remote-storage requirements     |
| Change budget | Documentation and policy decisions only; no Editor v1, Asset Lifecycle v2, or canonical mutation |

## Decision

KiKi Gallery adopts manual preservation by default. Time, observation count,
or an expiry calculation never authorizes deletion by itself. This milestone
sets minimum floors and operator controls; it does not add a scheduler, prune
command, remote transport, new deletion route, or any create/delete/rename
feature.

The authoritative policy record is this document at its reviewed Git commit.
An operator must record the policy commit, affected identities, evidence
generation, decision, approver, operation time, and result with the applicable
backup or lifecycle evidence. A later policy may increase a floor immediately.
It may not shorten a floor for evidence already created without a separately
reviewed migration and disposal decision.

## Roles and separation of authority

| Role                  | Authority                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Repository Maintainer | Approves policy changes, holds and releases, backup expiry, quarantine-byte deletion, and exceptional disposal.   |
| Recovery Operator     | Creates, verifies, copies, inventories, and restores generations; records results; cannot approve their deletion. |
| Lifecycle Operator    | Runs candidate observations, quarantine/review, and an already-approved single-asset physical delete.             |

One person may fill more than one role during normal backup creation or
recovery. Destructive disposal requires two distinct recorded decisions: a
Repository Maintainer approval and a subsequent operator execution. The
approver must not execute that disposal. If two people are not available,
expiry is deferred; lack of staffing is not an exception to the preservation
floor.

Physical deletion remains the narrow Asset Lifecycle v2 capability: one
quarantined asset, one current locked review, and one explicit confirmation
bound to the exact evidence generation. The Repository Maintainer's recorded
approval is an additional operational prerequisite and does not replace those
technical checks.

## Approved retention schedule

All durations are elapsed UTC time from the event named below. Counts mean
complete, independently stored, successfully verified generations. Both the
duration and count floor apply; satisfying one does not satisfy the other.

| Class                      | Event that starts the clock                          | Minimum floor                                                                                                      | Required evidence and deletion authority                                                                                            |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Candidate observation      | First complete, audit-clean orphan observation       | 30 days and 3 distinct complete, audit-clean observations on at least 3 separate UTC dates                         | Preserve the ledger and observation identities. A candidate may advance to review, never directly to deletion.                      |
| Quarantined asset bytes    | `quarantinedAt` in the immutable quarantine record   | 90 days and 3 distinct matching observations on at least 3 separate UTC dates; the final observation within 7 days | Maintainer approval, current locked re-audit and confirmation, plus the independent backup proof below are all required.            |
| Milestone/manual backup    | Successful generation verification                   | 365 days and at least 4 newer verified generations                                                                 | Dry-run inventory, Maintainer approval, Recovery Operator execution, and disposal result.                                           |
| Pre-quarantine backup      | Successful generation verification                   | 180 days and at least 3 newer verified generations                                                                 | Same backup-disposal record; never prune while its asset or evidence is active, quarantined, held, or in manual recovery.           |
| Pre-physical-delete backup | Successful generation verification                   | 7 years after the related completed deletion                                                                       | Preserve with the deletion evidence. Disposal after the floor requires an explicit end-of-life review and the two-person procedure. |
| Manual-recovery backup     | Resolution is recorded and a replacement is verified | 365 days after resolution and at least 4 newer verified generations                                                | Unresolved or ambiguous recovery evidence is held indefinitely. Disposal uses the two-person procedure.                             |
| Lifecycle evidence         | Last related lifecycle event                         | Rules below                                                                                                        | Evidence is never automatically deleted or selectively pruned.                                                                      |

Required trigger backups are manual and offline. Create and verify a generation
at each milestone close, immediately before quarantine, immediately before
physical deletion, and before manual recovery that may replace or reconcile
state. A Recovery Operator records the trigger and verification. A periodic
generation is also required at least every 30 days while there is uncommitted
canonical work, Editor-only state, quarantined bytes, or unresolved recovery
state. When none exists, pushed Git remains the periodic protection for
canonical state; milestone triggers still apply.

The preservation floor is always the greater of the applicable rules. A single
generation may satisfy several trigger classes, but it inherits the longest
duration, count, hold, and disposal requirements. The last known-good verified
generation in an independent failure domain cannot be removed until a verified
replacement exists there.

## Lifecycle evidence preservation

Evidence is kept as a coherent set: applicable Git context and backup manifest,
candidate ledger, lock-owner record, quarantine record and bytes, deletion
manifest, and manual-recovery artifacts. A deletion manifest proves an action;
it cannot restore bytes. Selective copying or deletion is not an approved
consistency model.

- Candidate and restored-quarantine history is retained for at least 365 days
  after the candidate is resolved, restored, or conclusively abandoned.
- Quarantine records and bytes are retained together while the record is
  `quarantined`. Restored records are retained under the preceding 365-day
  rule.
- Prepared, completed, and manual-recovery deletion manifests, their referenced
  ledger and quarantine records, approval record, and independently stored
  pre-delete backup are retained for 7 years after completed physical deletion.
- Active locks are never removed by retention processing. Captured lock records
  and unresolved or corrupt/manual-recovery evidence are retained until an
  explicit resolution is recorded, then for at least 365 more days unless the
  7-year deletion-evidence rule applies.
- History compaction, schema migration, or format conversion must preserve
  identities, timestamps, hashes, decision records, and continuity. Because no
  such tooling is approved, current ledger and evidence files remain intact.

Evidence disposal after its floor is exceptional, not routine. It requires a
complete dry-run inventory, confirmation that every related asset and recovery
case is closed, confirmation that no hold applies, Maintainer approval, separate
operator execution, and a durable result record retained for 7 years. Corrupt,
incomplete, uncertain, or selectively missing evidence fails closed and is not
disposable.

## Holds

A hold suspends every expiry and count-based disposal rule for the named asset,
generation, incident, or evidence set. Holds apply to source bytes, copies,
manifests, ledgers, records, approvals, and disposal results as one scope.

A Repository Maintainer may place a hold for legal, security, audit, ownership,
recovery, corruption, or operational investigation. Any operator who discovers
uncertainty must apply an operational hold immediately and request Maintainer
review. A hold record contains a stable ID, scope and identities, reason,
creator, UTC creation time, status, and release approval. It need not contain
sensitive case detail.

Holds have no automatic expiry. Release requires a Repository Maintainer's
recorded decision. The retention clock continues to measure elapsed time while
held, but release never causes immediate deletion: a new inventory,
verification, approval, and separate execution are required. Missing or
unreadable hold authority means preserve.

## Independent backup proof for physical deletion

Before quarantine bytes may be physically deleted, a Recovery Operator must
create or identify a pre-physical-delete generation that:

1. contains the exact quarantined bytes and complete related evidence set;
2. passes the existing manifest verification after transfer;
3. resides outside the repository and workstation in the approved independent
   failure domain;
4. is protected by the 7-year pre-physical-delete retention rule; and
5. has its generation identity, verification result, storage location, policy
   commit, and operator recorded in the deletion approval.

Unavailable storage, failed verification, incomplete upload, uncertain
identity, expired credentials, capacity exhaustion, or an untested recovery
path forbids physical deletion. Local source removal is never proof that the
remote copy is complete.

## Remote-storage boundary

The Git remote is authoritative only for pushed canonical content/assets and
commit history. It does not protect ignored Editor state, quarantined bytes,
uncommitted Save results, or unpushed commits. A separate backup/evidence
failure domain is therefore mandatory before any new physical deletion, but
provider selection and transport implementation are intentionally deferred.

The Repository Maintainer owns the remote-storage account and access policy.
An acceptable service must provide:

- encryption in transit and at rest, with recovery credentials stored outside
  the repository;
- least-privilege operator credentials, multi-factor protection for
  administration, access logging, and prompt credential revocation;
- versioning or immutable retention that prevents an ordinary operator from
  rewriting or deleting a generation inside its floor;
- separation from the repository host and workstation failure domain;
- capacity monitoring and a documented export path that avoids provider lock-in;
- verification after every transfer, a quarterly sample restore, and a full
  restore rehearsal before the first physical deletion and at least annually;
- recorded restore results, including generation identity, verifier, date,
  recovered roots, and failures.

A locally attached directory remains useful for generation creation and restore
testing but does not satisfy independent remote proof by itself. Copying only
`.kiki-editor/` or only `manifest.json` is not a backup. The complete immutable
generation (`manifest.json` and `payload/`) is the transfer and verification
unit.

## Recovery objectives

These are operational targets, not claims of continuous replication:

| State                                  | Recovery point objective                                       | Recovery time objective |
| -------------------------------------- | -------------------------------------------------------------- | ----------------------- |
| Pushed canonical content/assets        | Latest successfully pushed commit                              | 1 business day          |
| Unpushed or uncommitted canonical work | Latest required generation; at most 30 days while work exists  | 2 business days         |
| Editor-only state and quarantine       | Latest required trigger generation; no destructive trigger gap | 2 business days         |
| Physically deleted quarantined bytes   | Exact independently stored pre-delete generation               | 2 business days         |

If these objectives cannot be met, stop quarantine, physical deletion, and
recovery mutation until protection is restored. Successful restore is followed
by the existing Editor, Journal, Astro, build, and evidence reconciliation
checks before normal mutation resumes.

## Implementation gate

This approved design closes the policy-definition gate but does **not** approve
implementation. Existing manual backup creation, verification, restore, and
single-asset lifecycle controls remain the only tooling. Operators may follow
this policy manually, except that physical deletion is prohibited until an
independent storage service satisfying the remote requirements has been
selected and a full restore rehearsal has passed.

Any future implementation requires a separate milestone and review. Its design
must map each policy row to deterministic inputs and durable output evidence;
define atomicity, idempotency, interruption recovery, dry-run inventory, hold
evaluation, policy/schema versioning, access control, and failure behavior; and
prove that unavailable or uncertain state fails closed. Only then may the
project choose among bounded inventory/policy-evaluation tooling, remote-copy
verification, infrastructure automation, or pruning assistance.

Automatic deletion remains prohibited. A future automatic-pruning proposal
requires separate explicit approval and must not include quarantine-byte
physical deletion. Production and browser surfaces receive no lifecycle,
backup, approval, hold, or remote-storage mutation authority.

## Intentionally deferred

The following choices are deferred because they require provider, threat-model,
capacity, staffing, and restore-test evidence that this repository-only design
milestone cannot supply:

- remote provider, region, storage class, replication topology, billing owner,
  key-management product, and credential-delivery mechanism;
- packaging, encryption, upload, download, capacity monitoring, access-log
  collection, and restore-orchestration implementation;
- scheduler, retention evaluator, inventory UI, hold registry, approval system,
  history compaction, schema migration, and prune command;
- automatic deletion of any backup, quarantine bytes, lifecycle evidence, or
  disposal record; and
- create/delete/rename product features, batch cleanup, Production routes, and
  changes to Editor v1, Asset Lifecycle v2, or canonical content/assets.

Deferral is deliberate: fixed retention floors and fail-closed manual controls
are safe without pretending that unavailable infrastructure exists. Provider
and automation decisions become justified only after observed growth, recovery
objectives, authority boundaries, and restore evidence can be evaluated in
their own milestones.
