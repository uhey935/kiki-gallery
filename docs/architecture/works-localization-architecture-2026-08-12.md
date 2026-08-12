# Works Localization Architecture

| Property        | Value                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Status          | Implemented current authority                                                                           |
| Date            | 2026-08-12                                                                                             |
| Scope           | Works three-file localization, Production, Editor, routes, references, lifecycle safety, and migration |
| Current runtime | Strict three-file localized repository and Works Production facade                                      |
| Excluded        | Asset mutation and new product features                                                                  |

This is the current implemented authority for Works localization. The reviewed
migration, Production cutover, Editor three-file lifecycle, and isolated Works
browser acceptance are complete. The seven canonical directories and their 21
files are authoritative; legacy flat sources are retained only inside frozen
migration and recovery evidence.

The corrected migration baseline has empty bodies for Reiko Kinoshita 01/02,
the approved Yuka Mori alt, authoritative current image references/order, and
byte-preserved JA size strings, including existing spacing differences.

## 1. Canonical topology and identity

```text
src/content/works/<contentId>/
├── index.yaml
├── ja.md
└── en.md
```

The directory name is the only canonical Content ID. Files do not duplicate it.
Repository and Editor boundaries may use opaque `ja::<contentId>` and
`en::<contentId>` lookup identities, but consumers must not parse them. Routes,
references, asset lifecycle identity, and Publish evidence use only Content ID.

Every unit requires exactly these three regular, non-symlink files. Missing,
extra, nested, case-colliding, symlinked, or non-regular entries fail closed. A
target directory combined with legacy `<contentId>.md` is a mixed inventory and
fails closed. The target loader has no flat fallback.

## 2. Schema ownership

Shared `index.yaml`:

| Field          | Type                | Required | Contract                                          |
| -------------- | ------------------- | -------- | ------------------------------------------------- |
| `artist`       | Artist Content ID   | Yes      | Never a localized Artist entry ID.                |
| `images[].src` | Absolute public URL | Yes      | Ordered, non-empty, unique within the Work.       |
| `year`         | Positive integer    | No       | Existing meaning unchanged.                       |
| `orientation`  | `landscape`         | No       | Never inferred from dimensions.                   |
| `inquiry`      | Existing union      | Yes      | Existing `inquiry`, `shop`, and `none` semantics. |

Localized `ja.md` and `en.md`:

| Field          | Type             | Required         | Contract                               |
| -------------- | ---------------- | ---------------- | -------------------------------------- |
| `title`        | Non-empty string | Yes              | Locale-owned display title.            |
| `images[].alt` | Non-empty string | Per shared image | Index-aligned; no `src`.               |
| `material`     | Non-empty string | No               | Locale-owned display string.           |
| `size`         | Non-empty string | No               | Locale-owned, unparsed display string. |
| `seo_title`    | Non-empty string | No               | Never auto-generated.                  |
| `description`  | Non-empty string | No               | Never auto-generated.                  |
| Markdown body  | Markdown         | No               | Locale-owned statement.                |

Unknown and cross-owned fields fail validation. Shared data cannot contain
localized fields or `alt`; localized data cannot contain shared fields or
`src`. Migration preserves existing meaning. Current JA `material` and `size`
values move exactly to `ja.md`; it does not normalize `W200mm` / `W200 mm`.

## 3. Image localization contract

Shared sources and locale alts correspond by zero-based index. Mandatory
invariants are:

- each localized alt count equals the shared source count;
- every alt is non-empty after trimming;
- shared data stores only `src`, localized data only `alt`;
- count drift, missing/extra alt, duplicate source, or unsafe source fails
  closed;
- reorder moves shared source, JA alt, and EN alt as one logical slot;
- add/remove updates all three states before Save validates;
- replace changes only shared `src` and preserves both alts unless explicitly
  edited; and
- Reiko 01 retains its four sources, exact order, and shared-reference
  semantics.

No persistent image ID is introduced. Ordering is already canonical, no current
consumer references an individual image independently, and a generated ID would
add unsupported migration identity without strengthening asset identity. A
future need for concurrent reorder or external per-image references requires a
separate versioned decision.

## 4. Locale capability and Artist dependency

A locale is capable only when shared data and that locale file are valid,
image/alt alignment is exact, no reserved placeholder remains, the referenced
Artist is capable in the same locale, and route projection succeeds. Shared
failure blocks both locales; locale failure blocks only that locale.

JA-to-EN and EN-to-JA fallback are prohibited. An EN-non-capable Work is omitted
from future EN listings and EN Exhibition projections and receives no EN Detail
route. It does not block the Exhibition route.

`artist` is a canonical Artist Content ID. The locale-specific Artists
Production facade supplies display name and route; Works never duplicates an
Artist name. Missing or non-capable Artist state is an owned Work capability
failure for that locale.

## 5. Routes and consumer projections

- JA Detail: `/works/<contentId>/`
- EN Detail: `/en/works/<contentId>/`

The Route Registry derives paths only from locale and capable Content ID. No
localized internal ID appears in a route. This architecture adds no Works Index
because current site IA has none; an index needs a separate product decision.

Artist Detail resolves `works_layout` IDs through the locale Works facade,
preserves Artist-owned layout/order, and omits locale-non-capable Works without
fallback. Missing references and Artist ownership mismatch remain integrity
errors, not omission rules.

## 6. Exhibition integration

Exhibition `works[]` remains an ordered, non-localized list of Work Content IDs.
JA projects JA-capable Works and EN projects EN-capable Works. Locale capability
failure omits only that Work; missing Work or Artist-ownership mismatch remains
a shared integrity error. A zero-item projection hides the Works section.

The current flat compatibility projection and explicitly empty EN projection
are removed only when Exhibitions consumes the Works Production facade.

## 7. Production target

```text
strict three-file repository
→ owned Issues
→ localized Astro adapter
→ Works Production facade
→ capability/selectors and Route Registry
→ Works Detail / Artist Detail / Exhibitions
```

The repository owns exact inventory, parsing, ownership, placeholder, alignment,
and reference Issues. The adapter transports Issues and emits locale entries.
The facade exposes canonical Content ID, locale, joined ordered images, shared
metadata, localized fields/body, Artist resolution, selectors, and routes.

Cutover removes every Production `getCollection("works")` dependency, including
Works Detail, Artist Detail, and Exhibitions compatibility code. There is no
flat runtime fallback. Migration and consumer cutover must form one verified
milestone so a mixed inventory cannot render partially.

## 8. Editor target

Editor state contains an exact three-file baseline, Shared Draft, independent JA
and EN drafts, scope-aware dirty tracking, independent Preview capability, and
an ordered logical image-slot list joining shared `src`, JA `alt`, and EN `alt`.
Asset Draft/token state belongs to the shared source slot.

Reorder/add/remove operate on logical slots and derive all three serialized
arrays. Replace updates a shared source and retains both alts. Preview joins only
the selected locale alt and never substitutes its sibling. Blocked EN Preview
does not block valid JA Preview.

Save atomically validates and installs the complete unit even if one scope is
dirty. Create prepares all three valid files before exclusive directory install.
Publish, Rename, and Delete consume evidence for the complete unit.

## 9. Save and Asset Manager transaction

Accepted order:

1. acquire content lock, then make one non-stealing asset-lock attempt;
2. verify exact inventory, three-file baseline, identities, and source drift;
3. validate temporary-token ownership, expiry, bytes, metadata, and URL;
4. prepare deterministic `index.yaml`, `ja.md`, and `en.md` bytes;
5. validate the complete prospective unit, alignment, placeholders, references,
   and asset graph;
6. promote only transaction-owned new assets without overwrite;
7. atomically install the three content files with recorded preimages;
8. reread and revalidate content, capability, references, and promoted bytes;
9. finalize only consumed temporary tokens; and
10. create a content-bound Publish manifest for the three files and only proven
    new assets.

On failure after install, restore all three baseline files and verify them
before rolling back transaction-owned assets. Never remove a pre-existing asset.
Unprovable restoration persists manual-recovery evidence, retains the required
stop state, and prevents further mutation.

Before first mutation, durable prepared evidence records preimages. Each asset
promotion and file installation is journaled. Terminal state is `completed`,
`rolled-back`, or `manual-recovery-required`. Recovery distinguishes no
mutation, assets-only promotion, partial content install, installed-not-reread,
and completed Save with unconsumed token/manifest; it never infers ownership.

## 10. Asset lifecycle invariants

Localization does not change `public/images/works/`, normalized URL identity,
URL + SHA-256 + byte length + decoded-format generation identity, shared
references, candidate ledger, quarantine, deletion manifests, retention,
lifecycle locks, or recovery evidence. No in-place overwrite is introduced;
replacement uses a new path. Reference removal remains distinct from physical
deletion, which remains quarantine-only. Publish stages only manifest-proven
assets.

Migration is content-only: asset copy, move, rename, re-encoding, promotion, and
lifecycle evidence mutation are forbidden.

## 11. Rename and Delete

Rename is a reviewed directory-unit transaction. It validates old/prospective
units, uses content-then-asset lock order, and updates Artist `works_layout`,
Exhibition `works[]`, supported News `/works/<id>` links, and structurally
recognized Markdown routes. Asset identity is unchanged. Pending assets,
unpublished asset manifests, lifecycle stop state, collision, ambiguity, or
drift fails closed. Publish evidence is the old directory deletion, three new
files, and exact typed reference edits.

Delete requires exact backup proof, closed incoming-reference graph, both locks,
and no pending/unpublished asset state. It recoverably removes the exact unit,
leaves assets/evidence untouched, and uses evidence-limited Publish. Failure
restores the unit byte-for-byte; uncertainty records manual recovery and stops.
Neither operation is a simple recursive filesystem action.

## 12. Migration contract

Target inventory is seven flat files to seven directories and 21 files.
Artists/Exhibitions repository, converter, manifest, executor, rollback, and
test patterns may be reused, but Works owns its converter and asset evidence.

The frozen manifest records exact sources, SHA-256, byte length,
`originalBase64`, deterministic mappings, target bytes/hashes, rollback bytes,
body evidence, and index-preserving image mapping. Works additionally freezes
pre/post asset inventory, every asset path/SHA-256, reference count/order, and
lifecycle evidence hashes/absence.

The executor rejects content, inventory, asset, or evidence drift before
mutation. It stages and validates all 21 files and cross-references, installs
globally, removes seven sources, rereads through the target boundary, and proves
JA compatibility plus asset invariance. Failure rolls back all seven units and
all source/target paths; partial success is forbidden.

## 13. EN placeholder policy

No authoritative EN translation exists. Migration uses reserved
`__TODO_[A-Z0-9_]+__` tokens such as `__TODO_WORK_TITLE__`,
`__TODO_WORK_IMAGE_ALT_1__`, `__TODO_WORK_MATERIAL__`, and
`__TODO_WORK_SIZE__`. They are never display copy and block EN only.

Required title and every alt receive placeholders. Optional material/size get a
placeholder only when present in JA. A non-empty JA body receives
`__TODO_WORK_BODY__`; an empty JA body produces an empty EN body. All current
corrected Works bodies are empty. Optional SEO fields are omitted. Migration
does not translate from JA, News/Exhibition prose, or existing alts.

Implementation evidence: EN placeholders use the exact
`__TODO_WORK_*__` tokens documented above. The frozen content-and-asset manifest
is `docs/migrations/works-localization-manifest-2026-08-12.json`, SHA-256
`5eddbe7015aa14c5bc6741cf84a5c14ea4d93cc75cebf9a6812c691daca10498`.
Its asset invariance records normalized public URL, repository path, byte
length, SHA-256, decoded byte format, and ordered Work references. The executor
compares that evidence before staging, after installation, and after source
removal. The completed migration installed the exact 21 frozen targets and
removed the seven flat canonical sources. Production now reads the localized
loader and Works Production facade without a flat fallback. The frozen manifest
remains immutable rollback and audit evidence.

## 14. JA compatibility baseline

Before migration, freeze all seven JA Detail routes; Artist Detail Works;
Exhibition Works; image sources, alts, and order; title; material; exact size
spacing; year; inquiry; body; layout behavior; SEO behavior; and routes. After
migration, compare rendered semantics and preserve migrated JA values exactly.
No display change is an implicit migration goal.

## 15. Implemented lifecycle and verification

The implementation includes strict schemas and inventory, localized adapter and
Production facade, locale capability and routes, complete three-file Editor
Create/Load/Preview/Save/Publish/Rename/Delete, asset-safe transactions, frozen
migration evidence, all-seven migration, and Production consumer cutover.

The isolated browser acceptance in
`tests/browser/works-lifecycle.spec.ts` covers Create validation, JA Preview,
first Save and Publish, Edit/Preview/Save/Publish, temporary Asset Replace and
Cancel, directory Rename and Publish, and Delete backup fail-closed behavior.
Known Journal/Home navigation timeouts belong to the global browser suite and
are not Works lifecycle acceptance failures.

Create uncertainty is never treated as success. If post-install verification
fails and rollback cannot be proved, Create writes
`.works-create-recovery-<contentId>.json` with the target paths, intended and
observed hashes/lengths, rollback error, and `manualRecoveryRequired: true`.
The surviving target makes same-ID recreation fail closed. Operators must stop
mutation, inspect the recorded paths and bytes, reconcile the unit manually,
and preserve the evidence until recovery is independently verified.

Each milestone runs focused and full affected tests, Astro check/build,
formatting, and `git diff --check`. Mutating milestones require asset inventory
and SHA-256 proofs.

## 16. Unresolved questions

### Implementation blockers

None. Topology, ownership, alignment, capability, routes, transactions, and
lifecycle boundaries are decided.

### Migration blockers

None at architecture time. A reviewed frozen manifest and JA baseline are
required execution gates, not unresolved human decisions.

### Should-fix

- Preserve historical safety and migration evidence with explicit superseded
  status; do not delete it merely because runtime no longer imports it.

### Future enhancements

Works Index, persistent image IDs, structured numeric dimensions, automated
translation, and locale visibility beyond capability are outside this design.
