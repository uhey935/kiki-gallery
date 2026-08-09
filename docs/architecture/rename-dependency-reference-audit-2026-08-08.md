# Rename Dependency and Reference Audit

| Property | Value                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Status   | Journal, News, Exhibitions, Artists, and Works complete                  |
| Date     | 2026-08-08                                                               |
| Scope    | Incoming/outgoing references, route coupling, assets, and Rename hazards |

## Classification

| Collection  | Classification                        | Audit result                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| News        | Safe to rename now                    | A News ID is a canonical filename and Editor workspace identity only. News has no public detail route and is not a typed reference target. Its optional `link` is outgoing content and remains byte-identical. Rename moves one Markdown file and no asset. |
| Exhibitions | Safe with reference updates; complete | Exhibition IDs own `/exhibitions/<id>` routes. Implemented Rename rewrites recognized incoming News `link` fields with prospective validation and exact rollback.                                                                                           |
| Artists     | Safe with reference updates; complete | Artist IDs are targets of Works `artist`, Exhibitions `artists`, and known News `/artists/<id>` links. Implemented Rename updates the complete bounded graph; Artist-like asset filenames remain hints only.                                                |
| Works       | Complete                              | Work IDs are targets of Artists section `works` and optional Exhibitions `works`. Asset paths and durable lifecycle evidence remain unchanged; pending asset state blocks Rename, and execution holds both lifecycle locks.                                 |

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

## Exhibitions / Artists design disposition

The bounded reference-update design is now approved in
`exhibitions-artists-rename-reference-update-architecture-2026-08-08.md`.
It defines collection-owned typed inventory and byte-preserving rewrites,
reviewed multi-file plans, complete prospective graph validation, durable
staging, exact rollback, and Publish staging for the old/new path pair plus all
reference edits. No Rename API or UI is implemented by that milestone.

## Approved Works disposition

The Works-specific decision is approved in
`works-rename-asset-lifecycle-semantics-2026-08-09.md`. Works Rename changes the
flat Markdown Content ID/path, derived Work route, and every typed Artist and
Exhibition Work reference. It changes no asset URL or byte and rewrites no
candidate ledger, quarantine record, deletion manifest, or recovery evidence.

Asset identity is URL plus verified byte generation, never the Work Content ID.
A non-empty unpublished asset Save manifest, pending upload/Draft asset state,
active or stale lifecycle lock, incomplete recovery evidence, or lifecycle
metadata drift blocks Rename. Execution must acquire the content-lifecycle lock
and then the existing Asset Lifecycle repository lock, hold both through
prospective validation and the content/reference visibility point, and release
in reverse order only after success or verified rollback.

## Closed Works acceptance criteria

Works advanced in commit `0d3f883` after the approved design was covered by
typed-reference, dual-lock, pending-manifest, prospective asset/evidence,
rollback, and exact Publish tests. Its browser acceptance is recorded in
`works-rename-browser-acceptance-2026-08-09.md`.

Journal and News workspaces expose only their collection-owned reviewed-plan →
explicit-confirmation → execute flow. The browser does not calculate safety or
rewrite content; it displays the server plan, gates against dirty/in-progress
workspace state, transports stable failure guidance, and follows the returned
renamed-workspace URL. Publish remains a separate verified operation.
