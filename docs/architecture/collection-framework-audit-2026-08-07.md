# Collection Framework Audit

| Property      | Value                                        |
| ------------- | -------------------------------------------- |
| Status        | Reassessed after the Works read-only slice   |
| Last reviewed | 2026-08-07                                   |
| Scope         | Editor v1 boundaries after Journal and Works |

## Purpose

This audit first identified the smallest reusable boundary required before the first Works Editor implementation. It now records the reassessment after the read-only Works vertical slice. It does not approve a generic collection repository, a universal Content Unit shape, or a Works storage migration. Journal production output and the implemented Journal Editor v1 remain unchanged.

The governing rule is to share stable Editor/platform behavior while keeping collection data shape, validation, serialization, routes, and render models owned by each collection.

## Current finding

Journal and Works now prove two materially different read paths behind one small collection adapter boundary. The previous blocker is resolved: the generic collection page resolves an explicit registry entry and calls that collection's list reader. It no longer imports or invokes the Journal reader directly.

No new blocker was found. The evidence favors a thin shared control plane and collection-owned data planes. Journal's directory-based three-file repository and Works' flat Markdown reader do not expose a useful common repository beyond `readState`; their Draft roots, validation results, field topology, and future serialized file sets also differ. Generalizing those shapes now would encode Journal or transitional Works storage into the framework.

The registry has no Journal/Works `if` or `switch` dispatch. A third collection requires a new adapter plus its collection-owned workspace route; the current literal ID union also requires an explicit type update, which is acceptable compile-time friction rather than a framework blocker. Workspace loading is intentionally not forced through a universal entry-state type.

## A. Share now or define as the minimum shared boundary

### Editor shell and UI contracts

- `EditorLayout`, Dashboard, collection navigation, Editor CSS tokens, panel/status presentation, and route builders are collection-agnostic.
- `ActionBar` and `ValidationPanel` presentation are reusable after their Journal-specific selectors and prop types become neutral. Action names remain Save, locale Preview, and Publish only for collections whose adapter declares those capabilities.
- Workspace behaviors are reusable UI behavior: pending-action lock, accessible status announcements, failure guidance, Save shortcut, dirty warning, issue-to-field navigation, textarea auto-resize, field/section Modified display, and focus/caret/page-scroll restoration.
- Field metadata should be data supplied by a collection form definition: field key, label, scope, requirement badge, control kind, and optional issue target. It must not become a schema language or generate domain schemas.

### Shared Editor state vocabulary

The following shapes are stable enough to share as small types/helpers:

- `EditableSource<T> = editable(value) | unavailable(sourceState)`;
- an Editor entry summary containing Content ID, display label, issue count/status, and action capabilities;
- immutable clone/update and whole-draft dirty comparison helpers;
- field-level dirty comparison over explicit field accessors/metadata, not recursive assumptions about `hero`;
- generic Issue display location and issue target resolution from `locale`, `fieldPath`, `recovery.fieldPath`, and `params.fields`.

The shared type must not require exactly `shared + ja + en`, nor assume that every value is a string. Works introduces arrays, references, numbers, discriminated inquiry objects, and image records.

### Platform safety and operation vocabulary

- Move the Content ID rule to one collection-neutral module before Works accepts a Content ID. Journal currently repeats the same pattern in repository read, Editor read, Save, Publish, and canonical schema code.
- Keep path containment, regular-file/symlink rejection, baseline comparison, transactional replacement/rollback, Git repository inspection, staged-path isolation, staged-blob comparison, and committed-push-failed handling as reusable platform invariants.
- Reuse stable failure codes where their meaning is identical (`invalid-content-id`, `invalid-request`, `canonical-mismatch`, `dirty-draft`, `unsafe-repository`, `nothing-to-publish`). Collection adapters may add domain-specific codes.
- Keep all mutation and Preview endpoints injected only for `astro dev`. Route registration may become descriptor-driven, but production exclusion remains a platform invariant.
- Capability results and Issue facts remain separate. UI consumes normalized booleans/results; it does not infer permission from issue text.

These items should be extracted only when the first Works slice uses them. Moving Journal code into generic files before there is a second consumer would add churn without new evidence.

## B. Decide after the first Works implementation

- A common repository interface. Journal reads a directory-based three-file unit; Works currently uses Astro's flat Markdown loader. The second implementation must first reveal the useful read boundary.
- A common Draft root shape. Works may eventually use Shared and Localized sources, but current canonical storage is one Markdown file and the migration unit is not approved.
- Generic schema-driven forms. Reuse field presentation metadata, but keep hand-authored collection forms until repeated control and nested-array behavior is proven.
- Serializer composition and a universal file transaction. Reuse safety primitives, while each collection owns its exact file set, ordering, optional omission rules, and byte-equivalence fixture.
- A collection-neutral Save/Preview/Publish orchestrator. The operation sequence is similar, but capability policy, render model, target paths, commit message, and locale behavior remain collection-owned.
- Shared preview storage. The TTL/token store is technically reusable, but a collection-neutral record type and route should wait until Works has a preview model.
- Shared capability evaluator policy. `CapabilityResult` is reusable; blocker rules may diverge by collection and surface.
- A shared collection test harness. Promote helpers after they run unchanged against both Journal and Works fixtures.
- Publication Unit migration for Works. Do not infer a three-file shape from Journal.

## C. Keep Journal-specific

- The `{contentId}/index.yaml + ja.md + en.md` canonical shape and the requirement to serialize all three files together.
- Journal shared and localized schemas, category/date/author/credits rules, placeholder scanning behavior, and Journal Issue creation details.
- Journal fields and form layout: date, categories, visibility, Journal Hero, author, title, summary, hero alt, and Markdown body.
- Journal locale availability and no-fallback Preview semantics as currently implemented.
- Journal entry ordering by date and title fallback from JA to EN to Content ID.
- Journal routes, route registry, commit message, canonical root, production facade, surface visibility matrix, and Journal Preview render model.
- Journal's article presentation and Markdown render boundary.

## Works delta against the current Content Model

Works is not Journal with different labels. Its Editor must account for:

| Concern                                               | Work ownership                             | Consequence for the Editor                                                        |
| ----------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `artist`                                              | Shared reference, required                 | Reference selector and reference validation; not a free Journal string field      |
| `images[].src`                                        | Shared, one or more                        | Ordered repeatable records, duplicate-path validation, and later asset selection  |
| `images[].alt`                                        | Localized after Publication Unit migration | Do not freeze the current combined `{src, alt}` record as a shared framework type |
| `year`                                                | Shared optional positive integer           | Typed optional numeric control                                                    |
| `size`                                                | Shared optional                            | Must not be placed in a generic localized bucket                                  |
| `inquiry`                                             | Shared required discriminated union        | Conditional fields and forbidden `url` combinations                               |
| `orientation`                                         | Shared optional presentation metadata      | Current enum only allows `landscape`; it is not the Artist `works_layout` field   |
| `title`, `material`, `description`, `seo_title`, body | Localized                                  | Locale form differs materially from Journal (`summary` and `hero_alt` are absent) |
| Artist `works_layout`                                 | Owned by Artist, not Work                  | Layout/position editing does not belong in the Work Editor slice                  |

The current Work source files are flat Markdown and contain `src` and `alt` together. The Content Model explicitly says that `src`/`alt` separation applies after a future Publication Unit migration. Therefore the first Works slice must not silently rewrite storage or claim JA/EN parity.

## Test promotion map

### Promote with the first second-collection use

- shell route containment;
- failure guidance;
- Save shortcut;
- generic issue location and target selection;
- deep-clone/update separation and whole-draft dirty detection;
- token-store invalid/mismatch/expiry behavior, if Works uses the same store;
- path traversal, symlink/non-regular file rejection;
- stale-baseline rejection;
- replacement rollback and temporary-file cleanup;
- Git root/upstream/staged-change isolation and committed-push-failed behavior.

### Keep as collection contract tests

- Journal repository fixture counts and locale status;
- Journal schema and capability outcomes;
- locale-isolated Journal Preview model;
- three-file serialization, TODO preservation, and nine-unit byte equivalence;
- exact Journal file set and Journal commit message.

The current 29 Editor tests should not be moved wholesale. Shared behavior becomes harness coverage only when the same assertion runs against Journal and Works without collection conditionals.

## Works Editor entry gate

Before `works` is visible in the Editor shell, implement only these shared seams:

1. A collection-neutral Content ID validator and safe descendant resolver used by new Works code; migrate Journal callers only if focused tests prove no behavior change.
2. An explicit Editor collection registry/dispatch boundary so a collection route cannot accidentally call another collection's state reader.
3. Neutral UI prop contracts for entry lists, issue display, and action availability. Journal adapters map their existing types into these props.
4. Pure UI helpers for issue targeting and dirty fields that accept neutral inputs or collection field metadata.
5. Preserve the dev-only endpoint gate and keep collection-specific endpoint implementations behind it.

No common repository, serializer, or pipeline class is required before Works begins.

## Reassessment after the Works read-only slice

The original A/B/C sections above are the decision record that gated the first Works slice. The following A2/B2/C2 classification supersedes them for subsequent implementation.

### A2. Share now

- Keep the collection registry/dispatch, neutral list summary, shell routes, navigation metadata, UI behavior, issue presentation, dirty helpers, and Content ID/path safety as the shared Editor boundary. These already have or can have consumers independent of storage shape.
- Define operation control contracts when Works Save consumes them: capability gating, pending/success/error transport, stable platform failure codes, dev-only route injection, baseline freshness, and canonical reread after mutation. Keep the contract small and dependency-injected; do not introduce a base repository or pipeline class.
- Extract filesystem and Git transaction safety primitives only at the point Works needs the same invariant. The reusable unit is the invariant (safe target resolution, regular-file rejection, baseline comparison, rollback/cleanup, staged-path isolation), not Journal's three-file transaction.
- Promote shared tests only when one parametrized assertion runs against both collection adapters or operation implementations without collection branches. Immediate candidates are Content ID rejection, immutable Draft creation/dirty comparison, registry containment, capability gating, dev-only route exclusion, stale-baseline rejection, and Production equivalence.

Changes from the original classification: registry/dispatch and neutral list contracts move from a pre-Works gate to proven shared infrastructure. Save/Preview/Publish is split: its control-plane contracts move from B to A2 when Works first consumes them, while mutation and render behavior remain collection-owned. The common test harness is likewise narrowed from a possible broad harness to proven invariant fixtures only.

### B2. Decide after a third collection

- A richer repository interface beyond the existing collection list adapter. Journal loads Publication Unit directories and preserves source states/raw bytes; Works scans flat Markdown and has one parsed source. `readState` is the only stable overlap today.
- A common Draft base beyond `contentId` plus small clone/dirty helpers. Journal represents unavailable Shared/JA/EN sources; Works has one required parsed data object and body. A shared concrete root would erase meaningful states or add unused optionality.
- Schema-driven form generation. Journal and Works share presentation conventions but not field topology: Works has arrays, references, numeric and discriminated-union controls, and transitional Shared/Localized labeling. Keep hand-authored forms and collect repeated control evidence from a third collection.
- Shared preview storage and a collection-neutral Preview record. Works has no approved locale/render model yet.
- A general capability policy evaluator. Share the result vocabulary and UI gating, but wait for a third policy before abstracting blocker rules.

Changes from the original classification: common repository, concrete Draft shape, schema-driven form, preview storage, and capability policy remain deferred, now with direct evidence from two incompatible implementations rather than speculation before Works.

### C2. Keep collection-specific

- Repository parsing and entry-state generation, including Journal source-state recovery and Works flat-frontmatter parsing.
- Canonical schemas, cross-field/reference rules, issue creation details, display title/order, and form layout.
- Exact Draft root shapes and validation return shapes. Shared helpers may operate on them without owning them.
- Serializer composition: file names, ordering, whitespace/omission rules, body normalization, and byte-equivalence fixtures.
- Save mutation targets and transaction cardinality: Journal replaces three files atomically; the next Works slice replaces one existing Markdown file.
- Preview render models, locale semantics, token payloads, and routes.
- Publish target paths, commit messages, canonical snapshots, and collection-specific capability rules.
- Production facades and consumers, including the Work Astro collection adapter/reference integration.

Changes from the original classification: serializer and collection-specific Save/Preview/Publish execution move from B to C2. Two storage implementations are enough to show that only their safety/control vocabulary is shared; their data operations are not.

## Focused findings

1. **Read repository/state:** do not add a generic repository. The adapter's normalized list state is the correct current boundary; entry readers remain collection-owned.
2. **Draft and dirty tracking:** share cloning/comparison helpers and, if useful, a minimal `{ contentId }` constraint. Do not unify Journal's editable/unavailable sources with Works' single parsed object.
3. **Forms:** retain hand-authored Journal and Works forms. Field metadata may drive labels, issue targets, and dirty indicators, but must not become a schema or recursive UI generator.
4. **Serializer:** share no serialized shape. Reuse transaction safety around a collection-owned `serialize(draft)` result only when the Works implementation proves the call boundary.
5. **Operations:** a small orchestrator contract is justified for state transitions and error transport; reads, validation policy, serialization, mutation, preview rendering, and Git targets are injected collection operations.
6. **Tests:** promote invariant fixtures incrementally. Do not move the current Journal suite wholesale or add collection conditionals to a nominally common harness.
7. **Registry:** the explicit map and lookup are sufficient for a third collection. The registry contains adapter declarations, not branch logic. Revisit its literal ID typing only when the third adapter makes maintenance painful.
8. **Work schema:** `createWorkSchema` is appropriately shared by Production and Editor while allowing Production's Astro reference schema and the Editor's normalized reference input. It contains Work domain rules only; Shared/Localized Editor labels and Draft concerns have not entered it.
9. **Storage direction:** the Content Model explicitly defers Work Publication Unit migration and says the future `src`/`alt` split applies only after that migration. A migration specification now would force unresolved locale and consumer decisions before write correctness is proven.
10. **Documentation:** this reassessment is recorded here rather than creating a fourth overlapping audit document. The earlier gate remains visible as history; A2/B2/C2 is authoritative going forward.

## Next Works Editor implementation unit

Implement exactly one **flat Markdown read/write round-trip serializer plus baseline-checked Save slice** for existing Work files.

The slice should:

1. serialize the current canonical flat frontmatter and body without inventing locale separation;
2. prove byte-equivalent round trips for all seven existing Works before enabling mutation;
3. replace only the selected regular `.md` file through a single-file transactional write with stale-baseline rejection and cleanup;
4. reread canonical state after Save and return the new Works Draft baseline;
5. add Works-specific Save capability and a dev-only Save route using shared operation/error contracts where they are a real second consumer;
6. keep Preview, Publish, asset selection/upload, Publication Unit migration, and Production consumers unchanged.

This is lower risk than a storage migration because it validates the current source of truth, serializer fidelity, conflict protection, and the shared control-plane seam independently. Preview should follow only after the Work render/locale model is specified; Publish should follow a proven Save and canonical reread. Asset/image editing should follow serializer safety because repeatable image changes otherwise lack a trusted persistence boundary.

## First Works Editor implementation unit

Implement one read-only Works vertical slice for existing flat Markdown sources:

1. Register Works through the explicit Editor collection adapter.
2. List current Works by Content ID with a collection-owned display label and validation status.
3. Open one Works workspace backed by a Works-specific read state and deep-cloned Draft.
4. Render Shared and Localized field groups according to the Content Model, including repeatable images and inquiry state, while clearly reflecting the current single-file storage limitation.
5. Validate the Draft with the canonical Work schema plus Work-specific reference/cross-field rules, and display Issues through the neutral Validation UI.
6. Do not enable Save, Preview, or Publish in this slice. Do not migrate files, split alt text, add locale routes, or change Production consumers.

This slice supplies the second real consumer needed to judge repository, Draft, form, serializer, and pipeline abstractions. The next decision gate is a byte-equivalent Works serializer and baseline-checked Save design, considered only after the read-only slice is verified.

## Verification and production-equivalence rule

This audit changes documentation only. Any later shared extraction must keep Journal focused tests green and must not alter generated Production files. A Works read-only Editor slice may add Editor-only output, but Home, News, Journal, Artist, Exhibition, and existing Works output must remain byte-identical to the accepted baseline.

Required checks for an implementation slice are:

```text
npm run journal:test
npm run editor:test
npm run check
npm run build
git diff --check
```
