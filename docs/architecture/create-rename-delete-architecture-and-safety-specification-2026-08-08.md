# Create / Rename / Delete Architecture & Safety Specification

| Property      | Value                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Status        | Approved design; Journal Create first safe slice implemented          |
| Date          | 2026-08-08                                                            |
| Scope         | Editor-managed Create, Rename, and Delete planning and safety         |
| Compatibility | Preserve Editor v1, canonical content/assets, and Production behavior |

## Decision and authority

This specification defines the safe semantics for future Create, Rename, and
Delete capabilities, in that order. It closes the design gap identified by the
Workflow Architecture Audit without adding an Editor route, filesystem
mutation, Git staging, commit, push, redirect, or Production behavior.

The Content Model Specification remains authoritative for identity, ownership,
and validation. Editor v1 remains the supported implementation boundary:
editing an existing canonical entry through load, validation, Draft Preview,
atomic Save, and minimal Publish. Collection-owned repositories, serializers,
schemas, route helpers, and asset services remain authoritative; this document
does not introduce a universal repository or operation framework.

The first implementation slice authorizes Create only for Journal, the one
current collection whose canonical adapter owns a localized three-file Content
Unit. It adds an Editor-only Draft, Draft Preview through the existing preview
service, and an atomic first Save. The Save serializes and validates all three
files in a sibling staging directory, rechecks exact and case-fold destination
absence, publishes the complete directory, and canonically rereads the result.
Failures remove transaction-owned staging or exact created bytes; a partial
unit is never an accepted result. Existing Journal Save and Publish remain the
post-create boundaries, including Publish support for the three initially
untracked files.

This slice does not authorize Create for flat or singleton collections, asset
upload or mutation, Rename, Delete, reference rewriting, redirects, or any
Production loader change. The broader reviewed-plan, shared lifecycle lock,
and durable operation-journal contract remains required before Rename/Delete
or a wider lifecycle implementation.

For a collection whose approved storage adapter uses a localized Content Unit,
the unit is exactly:

```text
<collection>/<content-id>/
├── index.yaml
├── ja.md
└── en.md
```

The directory name is the Content ID. Neither the three files nor their
frontmatter duplicate it. The three files are one integrity and transaction
boundary: no operation may expose, preview, save, publish, rename, or delete a
partial unit. This rule does not migrate Works, Home, or any other existing
flat collection to three files. Every collection retains its current canonical
format until a separately approved migration changes it.

## Shared safety contract

### Authority, locking, and operation plan

Create, Rename, and Delete are explicit capabilities separate from ordinary
field editing. A caller must first request a read-only operation plan, review
that exact plan, and then execute an authorization bound to the plan identity.
The plan contains:

- operation type and a unique operation ID;
- repository root, branch, `HEAD`, and applicable upstream identity;
- source and destination Content IDs and public routes;
- every content file to create, rewrite, move, or recoverably remove;
- every typed incoming reference and proposed rewrite or blocker;
- every asset classified as exclusive, shared, ambiguous, or unknown;
- baseline tokens for every existing file and absence tokens for every new
  destination; and
- schema/policy versions, validation result, and a deterministic plan hash.

Execution acquires a repository-wide Editor mutation lock shared with future
content lifecycle writers. It must not steal an expired or unverifiable lock.
Asset Lifecycle v2's existing lock and evidence are independent current
authorities; a future implementation must either prove one composed lock order
or consolidate authority in a separately reviewed milestone. Until then,
concurrent content-lifecycle and asset-lifecycle mutation is prohibited.

Under the owned lock, execution rebuilds the plan from canonical repository
state and requires the same repository identity, baselines, destinations,
reference graph, asset classifications, and plan hash. A changed file, `HEAD`,
branch, destination, reference, asset identity, lock, or policy invalidates the
review. The operation fails closed; it does not merge or overwrite external
work.

### Path and filesystem safety

All paths are resolved from fixed collection and asset roots. Content IDs,
routes, references, and asset URLs are untrusted input. Operations reject path
traversal, encoded separators, absolute paths, control characters, unsafe
Unicode lookalikes, case-fold collisions, symlinks, special files, unexpected
nested paths, and paths outside an approved root. Existing and destination
parents are rechecked immediately before every mutation. No operation uses a
recursive delete.

New files are written to sibling temporary files with exclusive creation,
validated and closed, then moved into place in a deterministic order. Existing
destinations are never overwritten. Directory rename alone is not atomic
enough to establish correctness across content, reference, and asset changes.

### Reference and asset inventory

Each collection owns parsers for its structured references. Known internal
News routes are explicit references; generic internal paths and external URLs
are not. Markdown links and images are parsed structurally. Raw substring or
repository-wide search-and-replace is prohibited. The inventory must identify
the source field or Markdown node, locale, target collection and Content ID,
and normalized route where applicable.

An incomplete or invalid source makes the repository reference graph unknown
and blocks Rename and Delete. Create also blocks if uniqueness or proposed
references cannot be proven. Validation must not silently omit a collection,
locale, Markdown body, structured field, asset root, or known route form.

An asset filename, directory, or Content ID prefix is only an ownership hint.
An asset is exclusive only when it is a regular non-symlink file in an allowed
canonical root, every canonical reference is inside the operation set, its
identity is freshly verified, and no parser or inventory uncertainty exists.
Any outside reference makes it shared. Missing, unsafe, inconsistent, or
incompletely inventoried evidence makes it ambiguous/unknown. Shared and
ambiguous assets are never moved or quarantined automatically.

### Validation and transaction recovery

Before first mutation, the operation validates Content ID syntax and
uniqueness, all files against collection-owned strict schemas, shared/localized
alignment, reference existence and collection-specific relationship rules,
route uniqueness, asset existence and identity, and the complete prospective
repository state. For a three-file unit, shared YAML plus both localized
Markdown files must parse and validate together.

Execution records a durable Editor-only operation journal before mutation. It
contains the reviewed plan identity, preimages or recovery locations, hashes,
completed steps, and intended next step. Every step is deterministic and
idempotently inspectable. If a later step fails, rollback reverses only steps
whose current identity still matches the operation journal. It never
overwrites newer external content.

Successful rollback reports a failed operation with the original canonical
state restored. Failed or uncertain rollback is a terminal
`manual-recovery-required` state: preserve the lock, journal, temporary files,
recovery bytes, and repository state; disable further mutation; and provide
exact inspection paths. The Editor must never report success from an uncertain
filesystem state.

### Save, Preview, and Publish boundaries

Planning and Draft Preview are read-only. Create first materializes repository
files only through Save. Rename and Delete execute only through their dedicated
reviewed operations; ordinary Save cannot change Content ID or remove a unit.
None of these operations stages, commits, pushes, or deploys.

After a successful operation, the workspace is `saved-unpublished`. Publish
remains a separate Editor v1 workflow and must recompute repository/Git state,
require a clean pre-existing index, review exact paths including untracked
files and deletions, run repository-wide verification, stage only the reviewed
set, verify staged blobs, commit, and push. A local commit followed by push
failure remains committed and enters the existing terminal recovery state.
No operation implies that a clean working tree is already published.

## 1. Create semantics

### Draft and first Save

A new entry begins only in Editor State. Cancel before first Save leaves no
canonical content, asset, recovery, Git, or route artifact. The operator chooses
a collection and Content ID before authoring; the Content ID is reserved only
by the live, owned execution precondition, not by a persistent placeholder.

Create preview uses an Editor-only Draft identity and derived target routes. It
must not make the entry discoverable to Production loaders, indexes, route
generation, or canonical reference choosers. Preview capability follows the
collection's current rules. In particular, any unresolved localized
placeholder may be saved only where an existing collection contract permits
it, and still blocks the affected Preview and Publish.

First Save rechecks that the Content ID, every canonical path, and every route
are absent. For a three-file unit it creates and validates `index.yaml`,
`ja.md`, and `en.md` as one transaction. The directory becomes canonical only
after all three files are durable and a canonical reread produces the exact
validated Draft. Partial files are rolled back; they are never treated as an
entry.

Flat collections use their current collection-owned serializer and atomic Save
contract. Singleton collections cannot Create a second instance. Create does
not infer a future three-file representation or alter existing file naming.

### References and assets

All references authored by the new Draft must resolve in the prospective
repository and satisfy current cross-collection rules. Create does not rewrite
existing entries or create reciprocal relationships unless the Content Model
explicitly assigns those fields to the new unit. A proposed incoming reference
from another unit is a separate later Save, not part of implicit Create.

New asset handling is allowed only where an existing collection-specific asset
service already authorizes it. Works retains its temporary admission,
no-overwrite promotion, canonical reread, rollback, and saved-manifest rules.
Other collections gain no upload or asset mutation capability. A successfully
created unit does not automatically own assets merely because their filenames
match its Content ID.

### Create evidence

The journal records chosen identity/routes, absence proofs, created file and
asset hashes, validation result, canonical reread result, rollback result, and
timestamps. Successful Create evidence is retained at least until the change is
published or explicitly abandoned and reconciled. It is operational evidence,
not a substitute for Git or an approved backup generation.

## 2. Rename semantics

### Identity and routes

Rename is a Content ID migration, not a field edit. The source ID must exist and
the destination ID, directory, file paths, and derived routes must be absent.
The new directory name becomes the sole Content ID source; no `slug`, alias, or
old ID is written into frontmatter. Astro `entry.id` remains opaque and is
never rewritten as a public identity.

The preview shows every old and new locale route and warns that published URLs
will change. Automatic redirects, aliases, backlinks, search-index updates,
external-link discovery, and deployment invalidation are not part of Rename.
A separate approved redirect policy may later make a published rename safer;
without it, the operator explicitly accepts that external old routes may break.

### Typed reference updates

Every explicit incoming reference must be shown before execution. Rename
rewrites only collection-owned structured reference fields, exact normalized
known-internal News routes, and structurally parsed Markdown links whose target
is the renamed route. It preserves locale, query, and fragment where the route
contract permits them. It does not rewrite prose, asset URLs that are not being
moved, generic internal links, external URLs, opaque Astro entry IDs, or
unrecognized route forms.

After producing prospective files, the operation rebuilds validation and
proves that no explicit reference to the old Content ID or known old route
remains. An unparseable, ambiguous, readonly, or policy-excluded incoming
reference blocks Rename; there is no force or partial mode.

### Content-unit and asset transaction

For a three-file unit, the directory move and every incoming-reference rewrite
form one logical transaction. All source files must match their baselines and
all destinations must be absent. Shared/localized content bytes remain
semantically unchanged except for typed reference fields inside the operation
set. A canonical reread must return the new Content ID in both locale entries
and no old entry.

Exclusively owned assets may be included only if a collection-specific naming
policy requires identity-coupled paths and the plan provides collision-free new
names plus exact reference rewrites. Shared or ambiguous assets remain at their
canonical paths and their valid references remain unchanged. Rename never
quarantines or physically deletes an asset. The initial implementation may
safely rename no assets at all; that restriction does not block content Rename
when existing asset URLs remain valid.

The journal retains source/destination identities, file preimages, each typed
rewrite, asset classifications and hashes, route changes, completed steps, and
rollback status. Recovery restores the old unit and references only when their
current identities still match the journal.

## 3. Delete semantics

### Eligibility and review

Delete is exceptional and requires explicit per-unit confirmation bound to a
fresh plan. Hide remains the normal removal mechanism after visibility is
implemented in its separately approved cross-layer slice. Until then, Delete
must not pretend that an unavailable Hide capability exists.

Any explicit incoming reference blocks Delete. There is no force-delete,
cascade, reference nulling, reciprocal rewrite, or partial Delete. The review
shows the complete unit, all locale routes, every incoming-reference result,
all referenced assets with ownership classification, and every recovery
destination. An incomplete graph, invalid canonical entry, missing unit file,
unsafe path, conflict, or uncertain asset identity blocks execution.

### Recoverable content removal

Delete never unlinks canonical content directly. Under the owned lock it moves
the complete Content Unit—or the current flat canonical file—to an Editor-only
recovery area on the same filesystem and atomically commits a durable deletion
record. For a three-file unit, all three files move together; a missing or
extra unexpected canonical file blocks the operation. Production routes vanish
only as the derived consequence of the canonical unit no longer being present.

If the recovery record cannot be committed, rollback moves the exact verified
content back without overwrite. Failure or uncertainty preserves the lock and
enters manual recovery. Restore is a separate explicit action: it requires the
record, matching hashes, absent canonical destinations, fresh conflict and
reference validation, and no-overwrite restoration of the complete unit.

### Assets, quarantine, and retention

Delete separates content removal from asset disposition. Shared and ambiguous
assets remain canonical. Exclusively owned assets may be moved only into the
existing Asset Lifecycle v2 quarantine through that lifecycle's own fresh
inventory, lock, ledger, retention, record, and rollback contracts; Content
Delete itself never moves or deletes them. Because those current contracts are
Works-specific and require prior orphan observations, the safe initial Delete
implementation leaves all assets canonical and lets the post-Delete lifecycle
classify them later.

Deleting content does not make any asset immediately deletion-eligible. An
orphan must independently satisfy the approved candidate minimum of 30 days
and three distinct observations, then any authorized quarantine must satisfy
the approved minimum of 90 days and three distinct observations. Holds have no
automatic expiry. Physical deletion additionally requires two-person
separation, fresh approval and execution evidence, and an independently stored
verified pre-delete backup generation under the Retention Policy. Automatic
pruning remains prohibited.

Content recovery records and audit evidence are not orphan assets and must not
be fed into asset pruning. Their retention/removal policy requires a future
approved implementation mapping. Until then they are preserved. A Git commit,
push, or later backup may add recovery options but does not authorize removal
of Editor-only recovery evidence.

### Delete evidence and publication

The durable record contains the plan/confirmation identities, collection and
Content ID, old routes, canonical and recovery paths, file hashes and sizes,
reference-graph snapshot, asset classifications, lock identity, policy/schema
versions, timestamps, operation state, and rollback/recovery history. It never
contains absolute-path secrets or claims that retained assets were deleted.

A successful Delete remains an unpublished working-tree deletion until the
separate Publish workflow reviews and commits the exact removed canonical paths
and any separately saved typed changes. `.kiki-editor/` recovery records and
bytes are never staged or consumed by Production. Git deletion and asset
physical deletion are different authorities and must not be presented as one
action.

## Audit and recovery evidence

Every plan, execution, rollback, restore, and manual-recovery transition uses
UTC timestamps and stable operation/result codes. Evidence must be deterministic
where identities are hashed, tamper-evident through SHA-256, schema-versioned,
and sufficient to distinguish `planned`, `executing`, `completed`,
`rolled-back`, and `manual-recovery-required`. Logs alone are not the durable
record.

Before implementation, the Backup & Recovery tooling must be assessed for the
new recovery root. If the root is required for exact recovery, it must be added
to an immutable backup generation as part of the same implementation milestone
or the feature must remain disabled. Git protects only committed canonical
state; it does not protect ignored recovery records, uncommitted Save results,
or unpushed commits. Unavailable or unverifiable backup/recovery state fails
closed for any destructive follow-up.

## Required implementation gates

This design is approved, but no capability is authorized until a separate
implementation milestone supplies and verifies:

1. collection-by-collection scope and adapters, starting with Create before
   Rename and Rename before Delete;
2. repository lock composition and crash-safe operation journal formats;
3. complete typed reference and route parsers with formatting-preservation
   tests;
4. exact conflict, absence, path, symlink, and case-collision checks;
5. prospective strict-schema, cross-collection, asset, Astro, and route
   validation;
6. rollback, restart inspection, no-overwrite restore, and terminal recovery;
7. Editor capability/confirmation UX and stable error guidance;
8. exact Save/Preview/Publish integration without weakening Editor v1;
9. backup coverage and retention authority for new Editor-only evidence; and
10. proof that Production artifacts contain no mutation or recovery endpoint.

Tests must use isolated repositories and cover partial three-file creation,
destination races, external edits at every check-to-use boundary, invalid and
ambiguous references, shared assets, rollback success/failure, restart after
each journal state, exact Publish staging, push failure, and canonical/asset
no-change assertions outside the authorized operation set.

## Explicit non-goals

- Implementing Create, Rename, Delete, Restore, Hide, redirects, or UI routes.
- Changing Editor v1 behavior, schemas, current canonical content, or canonical
  asset bytes/paths.
- Migrating flat collections to three-file units or changing Astro entry ID
  encoding.
- Force-delete, cascade delete, batch operations, duplicate/fork, bulk reference
  replacement, or global text replacement.
- Inferring ownership from filenames, automatically renaming assets, or
  physically deleting an asset as part of content Delete.
- Automatic pruning, scheduling, remote-storage implementation, evidence
  compaction, or retention-policy automation.
- Automatically generating redirects, preserving unknown external backlinks,
  staging, committing, pushing, deploying, or changing Production routes
  outside derived canonical behavior.
- Introducing a generic dependency graph, universal repository, serializer,
  transaction orchestrator, or asset manager before multiple implemented
  consumers prove the same contract.

## Milestone acceptance

This documentation milestone is complete when the specification and
architecture index are formatted, `git diff --check` passes, and one local
milestone commit contains only those documentation changes. It does not modify
canonical content/assets or authorize implementation. The milestone commit is
not pushed without a separate explicit request.
