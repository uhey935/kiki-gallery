# Rename Dependency and Reference Audit

| Property | Value                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Status   | News implemented; Exhibitions, Artists, and Works deferred               |
| Date     | 2026-08-08                                                               |
| Scope    | Incoming/outgoing references, route coupling, assets, and Rename hazards |

## Classification

| Collection  | Classification                        | Audit result                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| News        | Safe to rename now                    | A News ID is a canonical filename and Editor workspace identity only. News has no public detail route and is not a typed reference target. Its optional `link` is outgoing content and remains byte-identical. Rename moves one Markdown file and no asset. |
| Exhibitions | Safe with reference updates; deferred | Exhibition IDs own `/exhibitions/<id>` routes. News `link` fields contain recognized incoming routes. A safe operation needs typed News-link parsing, prospective route rewrites, multi-file validation, and rollback.                                      |
| Artists     | Safe with reference updates; deferred | Artist IDs are targets of Works `artist`, Exhibitions `artists`, and known News `/artists/<id>` links. Rename needs coordinated typed-reference updates and repository-wide relationship validation. Artist image filenames are ownership hints only.       |
| Works       | Deferred/blocked                      | Work IDs are targets of Artists section `works` and optional Exhibitions `works`. Work images are governed by Asset Lifecycle v2 draft state, ledgers, manifests, evidence, and independent locking. ID-keyed state semantics require a separate decision.  |

## Implemented News boundary

News reuses the Journal reviewed-plan → execute lifecycle without treating the
storage formats as identical. Its plan binds the attached Git branch and HEAD,
source/destination IDs, exact source SHA-256, destination absence, and explicitly
empty old/new route sets. Execution rebuilds the plan under the repository-wide
content lifecycle lock, refuses an active Asset Lifecycle v2 lock, writes durable
operation evidence, moves the single regular non-symlink Markdown file, rereads
it through the News schema, and verifies unchanged bytes.

Failure after the move rolls back only when the destination still has the exact
reviewed bytes and the source has not been recreated. Otherwise evidence enters
`manual-recovery-required` and the lock is preserved. Assets, optional outgoing
News links, Preview, Save, Production loader behavior, and production routes do
not change. The result is a saved-unpublished workspace.

News Publish detects at most one byte-identical deleted source for the new
canonical file, stages the exact delete/add pair with rename detection disabled
for boundary verification, verifies the new staged blob and absence of the old
index entry, then uses the existing commit/push workflow.

Stable failures cover invalid ID, missing or invalid source, case-fold collision,
unsafe root/repository, stale plan or canonical drift, lifecycle lock conflict,
rollback requiring manual recovery, and generic rename failure. Guidance tells
the operator to choose a new ID, fix validation, review a fresh plan, resolve a
lock, or preserve and inspect durable evidence.

## Deferred acceptance criteria

Exhibitions and Artists may advance when collection-owned parsers inventory and
rewrite every typed reference and recognized internal News route as reviewed
multi-file steps, validate the prospective graph, and roll all files back by
identity. Works additionally requires an approved decision for all Asset
Lifecycle v2 state keyed by Content ID and a composed lock order. No deferred
collection has a Rename API or browser UI in this slice.
