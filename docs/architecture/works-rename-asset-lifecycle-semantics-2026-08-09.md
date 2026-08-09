# Works Rename Asset Lifecycle Semantics Finalization

| Property  | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| Status    | Approved design; implementation and browser acceptance deferred           |
| Date      | 2026-08-09                                                                |
| Scope     | Works Content ID Rename coordination with Works Asset Lifecycle v2        |
| Preserved | Canonical asset bytes/paths, Asset Lifecycle v2 behavior, Delete, loaders |

## Decision

Works Rename is a content-identity and typed-reference transaction only. It
moves `src/content/works/<old-id>.md` to
`src/content/works/<new-id>.md` without changing that file's bytes and rewrites
every typed incoming Artist `works_layout[].works[]` and Exhibition `works[]`
reference as one reviewed transaction. The public route changes from
`/works/<old-id>` to `/works/<new-id>`.

Rename does **not** move, rename, copy, materialize, quarantine, restore, or
delete an asset. Every `images[].src` value and every file under
`public/images/works/` remains byte- and path-identical. A filename resembling
the old Content ID is only a naming hint. Changing it would be a separate asset
storage migration and is not approved by this design.

This decision completes the design gate only. It authorizes no Works Rename
route, UI, mutation service, serializer change, schema change, Delete behavior,
Production loader change, or asset migration.

## Audited identity model

The current authorities are intentionally different:

| State                                 | Authoritative identity                                                                   | Works Rename disposition                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Canonical Work                        | Markdown filename / Content ID                                                           | old path becomes absent; byte-identical new path becomes canonical            |
| Work route                            | Derived Content ID                                                                       | changes to the new route; no redirect is created                              |
| Canonical asset                       | Normalized `/images/works/<filename>` URL                                                | unchanged                                                                     |
| Asset byte generation                 | URL, SHA-256, byte size, decoded format                                                  | unchanged                                                                     |
| Pending upload                        | Editor-only pending token and proposed URL                                               | blocks Rename                                                                 |
| Save/Publish asset manifest           | `contentId`, canonical Markdown baseline SHA-256, exact newly materialized asset entries | any non-empty unpublished manifest blocks Rename                              |
| Candidate ledger entry                | URL plus asset byte generation                                                           | preserved byte-for-byte                                                       |
| Cleanup observation                   | observation time plus complete inventory snapshot                                        | preserved as historical evidence; never rewritten to claim a post-Rename scan |
| Quarantine record                     | record ID, URL, byte generation, ledger/snapshot hashes, lock identity                   | preserved byte-for-byte                                                       |
| Deletion review/confirmation/manifest | asset, record, ledger, snapshot, confirmation and lock identities                        | preserved byte-for-byte; prepared/manual-recovery state blocks Rename         |
| Lifecycle repository lock             | random operation owner identity                                                          | coordinated as described below; never translated to a Content ID              |
| Backup/recovery record                | repository-relative paths and byte identities                                            | preserved; future generations naturally record the new content path           |

Asset ownership means reference evidence, not Work membership. A referenced
asset can be shared by multiple Works. Rename changes neither its URL nor its
reference count and never assigns it to the new Content ID. Existing ledger,
quarantine, deletion, backup, and recovery schemas contain no Work-owner field;
the implementation must not invent one or rewrite historical evidence.

## Pending and unpublished asset state

Rename starts only from a canonically saved, clean Works workspace. Pending
uploads, Draft-only replacements/removals/reordering, an asset Save in progress,
Preview creation in progress, Save or Publish in progress, and any non-empty
unpublished Works asset Publish manifest block plan execution. The operator
must finish Publish or explicitly abandon/reconcile that workspace state before
requesting a fresh plan.

The manifest is the one current state that is explicitly Content-ID-bound. It
must not be silently rebound from old to new: doing so would authorize asset
staging under a plan the operator never reviewed, while discarding it would
lose Publish evidence. An empty manifest carries no asset consequence and need
not become durable Rename state. After successful Rename, later ordinary Saves
create manifests under the new Content ID and new canonical baseline.

## Composed lock protocol

Execution uses both existing authorities in one fixed order:

1. acquire the repository-wide content-lifecycle lock;
2. acquire the Asset Lifecycle v2
   `.kiki-editor/asset-lifecycle/repository.lock` without stealing it;
3. verify ownership of both locks, rebuild the complete plan and asset graph,
   and perform the content/reference transaction while holding both;
4. release the asset lock, then release the content lock, only after success or
   verified rollback and durable evidence update.

An asset operation already holding its lock makes Rename fail with a stable
lock conflict; Rename releases its content lock without mutation. Holding the
content lock while waiting is forbidden: asset-lock acquisition is one
immediate fail-closed attempt. Asset operations remain unchanged and continue
to acquire only their existing repository lock. Because Rename holds that lock
through its visibility point, no quarantine, restore, physical delete, ledger
writer participating in the lifecycle authority, or future conforming asset
mutation can race the graph transition.

The current candidate-ledger store uses optimistic hash comparison but does not
acquire the repository lock. Before Works Rename can be implemented, every
ledger write and any other Asset Lifecycle writer must participate in the
existing asset repository lock (or an equivalent shared mutation gate proven
to exclude Rename). This adds coordination, not a schema, retention, identity,
or state-transition change. A pre/post hash check alone is insufficient because
it can detect a race only after the content visibility point.

An expired, corrupt, missing-owner, replaced, or unverifiable lifecycle lock is
manual-recovery evidence, not permission to proceed. A prepared or
`manual-recovery-required` deletion manifest, incomplete quarantine
transaction, unmatched quarantine bytes/record, or other recovery-inspector
finding also blocks Rename. Completed historical records do not block when all
current state validates.

## Reviewed plan

The displayable plan binds the existing Rename safety envelope plus:

- old/new Work IDs, old/new `/works/<id>` routes, Git branch/HEAD/upstream, and
  exact source bytes;
- the destination exact- and case-fold-absence proofs;
- each Artist section Work reference and Exhibition optional Work reference,
  with file, field path, old/new scalar, baseline SHA-256, and rewrite adapter
  version;
- any recognized Markdown or known internal route occurrence, either as an
  exact supported rewrite or an explicit blocker;
- the unchanged ordered `images[].src` list, each resolved canonical asset's
  URL, SHA-256, byte size, format, and complete repository-wide reference set;
- an explicit `assetPathChanges: []`, `assetByteChanges: []`, and
  `lifecycleEvidenceChanges: []` consequence;
- the candidate-ledger SHA-256 or proven absence; hashes and states of every
  quarantine record and deletion manifest; recovery-inspector findings; and
  the Asset Lifecycle schema/policy versions;
- proof that no pending asset token, non-empty unpublished asset manifest, or
  in-flight workspace action exists; and
- the prospective reference/inventory snapshot and deterministic plan hash.

Asset lists are consequences to review, not mutation targets. Shared assets are
shown as shared. Missing, unsafe, symlinked, undecodable, or ambiguously
referenced assets make the graph unknown and block planning.

## Prospective validation and execution

Under both locks, execution rebuilds the plan from canonical bytes and requires
the reviewed hash to match. A typed, byte-preserving YAML rewrite changes only
the exact scalar Work IDs in Artists and Exhibitions. It does not serialize an
entire unrelated file. The source Work bytes move unchanged.

Before installation, validation constructs the complete prospective repository
and proves:

- the new Work exists exactly once and the old Work no longer exists;
- all Works, Artists, Exhibitions, News, Home, and Journal canonical sources
  parse under their current collection contracts;
- every Artist/Exhibition Work reference resolves, preserves order and
  duplicates policy, and no typed old ID or recognized old Work route remains;
- the Work's artist relationship and all unrelated relationships remain valid;
- every unchanged `images[].src` resolves to the same regular non-symlink
  canonical bytes and the full asset reference graph is complete;
- recomputing the asset inventory changes no target URL or byte generation;
- durable ledger, quarantine, deletion, lock, and recovery evidence still
  parses, hashes to the reviewed identities, and contains no active ambiguous
  transaction; and
- no lifecycle evidence claims to be newly observed after Rename. Historical
  snapshots remain historical; a later lifecycle scan creates a new
  observation rather than rewriting an old one.

Snapshot drift caused solely by the reviewed content ID/reference transition is
represented by the prospective plan, never written into the existing ledger.
Any later quarantine or deletion action still performs its normal fresh locked
re-audit. If its reviewed snapshot no longer matches, that action fails and
must obtain new evidence under existing Asset Lifecycle v2 rules.

## Transaction, rollback, and recovery

Rename's durable operation journal is written before the first canonical
mutation. It contains exact preimages for the Work and every reference file,
absence evidence for the new path, reviewed asset inventory/evidence hashes,
both lock identities, completed step markers, and the next intended step.

Only content and reference files are staged and installed. Asset and lifecycle
paths are read-only invariants. On failure, rollback restores the old Work path
and every reference file byte-for-byte and removes only the exact
transaction-created new path when its identity matches. It then verifies that
all canonical asset bytes and all pre-existing lifecycle metadata are
byte-for-byte identical to their pre-operation identities.

Because Rename never writes lifecycle metadata, any lifecycle metadata change
during the held lock is external drift and rollback cannot overwrite it. Such
a state, any content rollback mismatch, lost lock ownership, or uncertain path
identity enters `manual-recovery-required`: preserve both lock directories,
Rename journal/preimages, lifecycle evidence, quarantine bytes, and repository
state; disable further mutation; and reconcile from the combined evidence and
an approved backup when required.

Backup generations continue to capture `src/content/`, `public/images/`, and
`.kiki-editor/` together. Rename does not create a backup automatically. A
pre-operation generation is operationally advisable but does not replace
transaction rollback or relax the retention policy.

## Preview, Save, and Publish after Rename

Successful execution returns the new saved-unpublished Works workspace.
Preview and ordinary Save continue under the new Content ID. Existing asset
URLs remain previewable without copying or re-materialization.

Publish must recognize exactly one byte-identical old Work deletion/new Work
addition plus the reviewed Artist/Exhibition/route-reference edits. Its allowed
set comes from successful Rename evidence, not a directory scan. It stages no
asset path for Rename. In particular it must not infer assets from
`images[].src`, replay a pre-Rename manifest, stage a matching filename, remove
an apparent old-ID asset, restore quarantine bytes, or stage `.kiki-editor/`.
It verifies the old index entry is absent, the new staged Work blob equals the
old bytes, and every staged reference blob equals the prospective bytes before
commit/push.

A later Save may materialize a genuinely new asset and produce a new-ID-bound
manifest; the existing Works Publish contract then stages that explicit asset
normally. This is separate from Rename Publish.

## Fail-closed states

There is no force, partial, metadata-repair, or asset-migration mode. Planning
or execution stops for:

- invalid IDs; missing/invalid source; exact or case-fold destination/route
  collision; unsafe root, path, symlink, or special file;
- Git, canonical byte, reference graph, schema/policy, plan, asset inventory,
  ledger, record, manifest, recovery evidence, or lock drift;
- incomplete parsing or an unsupported/ambiguous incoming Work reference or
  known old route;
- missing, changed, unsafe, undecodable, or incompletely inventoried referenced
  asset bytes;
- pending upload/Draft asset state, non-empty unpublished asset manifest, or
  in-flight Save, Preview, Publish, quarantine, restore, or deletion;
- any lifecycle lock conflict/stale/corrupt owner, prepared or
  `manual-recovery-required` deletion, incomplete quarantine evidence, or
  recovery-inspector finding; and
- install failure, canonical reread mismatch, lock ownership loss, rollback
  mismatch, or any attempted lifecycle metadata mutation.

## Implementation and acceptance gate

A later milestone may implement Works Rename only after tests prove the typed
Artist/Exhibition inventory, byte-preserving rewrite, dual-lock protocol,
pending-manifest gate, complete prospective content/asset/evidence validation,
byte-exact rollback, renamed-workspace continuity, and evidence-limited Publish.
Browser acceptance must visibly confirm reference edits and unchanged asset
URLs, exercise a lifecycle lock conflict and unpublished-manifest rejection,
and verify that the isolated commit contains no asset or `.kiki-editor/` path.

Works Delete, Production loaders/consumers, Asset Lifecycle v2 schemas and
behavior, canonical asset naming, and asset ownership remain unchanged.
