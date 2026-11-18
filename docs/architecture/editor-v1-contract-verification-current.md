# Editor v1.x — Current Contract and Verification Index

Docs整理 Phase 1 documentation-work baseline:
`296d827b1e7d67f69c17c3d0db0654b7221dc2d8`. This identifies the Phase 1
starting point for the index, not a test-execution baseline or a claim that
current code was verified at that commit.
This is a compact index of implemented contracts and their verification sources,
not a replacement specification or a new test execution report. Read
[Editor v1 Operations](../operations/editor-v1-operations.md) for procedures and
[the architecture reading order](./README.md#reading-order) for detailed authority.
Earlier provisional and flat-runtime snapshots do not override current code.

## Targets and lifecycle capabilities

Every target owns an exact `index.yaml`, `ja.md`, `en.md` Content Unit under
`src/content/<collection>/<content-id>/`. Home and About have fixed IDs `home`
and `about`. All seven support Save, validation-gated Preview/Publish, and
saved-workspace Cancel. Registry evidence:
[implementation](../../src/editor/collection-registry.ts) and
[tests](../../src/editor/collection-registry.test.ts).

| Target / authority                                                   | Kind        | Create / Rename / Delete | Image operations                                                                                    |
| -------------------------------------------------------------------- | ----------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| [Works](./works-localization-architecture-2026-08-12.md)             | Multi-entry | Yes / Yes / Yes          | Create references an existing canonical image; saved workspace supports managed upload/replacement. |
| [Journal](./journal-architecture-current.md)                         | Multi-entry | Yes / Yes / Yes          | Managed Hero upload during Create and saved-workspace editing.                                      |
| [Artists](./artists-architecture-current.md)                         | Multi-entry | Yes / Yes / Yes          | Managed Hero upload during Create and saved-workspace editing.                                      |
| [Exhibitions](./exhibitions-localization-architecture-2026-08-12.md) | Multi-entry | Yes / Yes / Yes          | Managed Hero upload during Create and saved-workspace editing.                                      |
| [News](./news-write-layer-migration-2026-08-10.md)                   | Multi-entry | Yes / Yes / Yes          | No asset operation.                                                                                 |
| [Home](./home-localization-architecture-2026-08-12.md)               | Singleton   | No / No / No             | Existing path inputs; legacy path input UI remains known pending.                                   |
| [About](./about-localization-architecture-2026-08-18.md)             | Singleton   | No / No / No             | Select validated existing JPEGs; no upload or image-byte replacement.                               |

## Contract to service-level evidence

The files below locate assertions, including negative and injected-failure cases.
They do not imply that every collection has identical validation or recovery.
Some test titles retain historical words such as “flat”; inspect their fixtures
and assertions rather than inferring a current single-file contract from a title.

| Contract                                                                                                                                                                                                                            | Focused evidence and specification link                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First Save validates and creates a collection-owned unit; collision/failed install cannot authorize overwrite.                                                                                                                      | [Collection Create](../../src/editor/collection-create.test.ts), [Create drafts](../../src/editor/collection-create-drafts.test.ts), [first Publish](../../src/editor/collection-create-publish.test.ts), [Journal Create](../../src/editor/journal-create.test.ts); [operator flow](../operations/editor-v1-operations.md#create-operator-flow).                                                                                                                                     |
| Save preserves Shared/JA/EN ownership, rejects canonical drift, and restores preimages on recoverable install failure; Save does not stage or commit Git.                                                                           | [Works transactions](../../src/editor/works-transaction-core.test.ts), [Journal state](../../src/editor/journal-state.test.ts), [Artists state](../../src/editor/artists-state.test.ts), [Exhibitions state](../../src/editor/exhibitions-state.test.ts), [News state](../../src/editor/news-state.test.ts), [Home state](../../src/editor/home-state.test.ts), [About Save](../../src/editor/about-save.test.ts).                                                                    |
| Preview uses the selected locale and unsaved Draft without granting Production capability; token expiry/binding and placeholder policy remain target-owned.                                                                         | [Works state](../../src/editor/works-state.test.ts), the collection state tests above, [About state](../../src/editor/about-state.test.ts); [Journal locale policy](../operations/editor-v1-operations.md#journal-locale-operations).                                                                                                                                                                                                                                                 |
| Ordinary/Rename Publish validates the exact authorized source/asset/reference set and commits/pushes separately from Save/Rename.                                                                                                   | [Works Publish](../../src/editor/works-publish.test.ts), [Journal Publish](../../src/editor/journal-publish.test.ts), [Artists Hero Publish](../../src/editor/artists-hero-publish.test.ts), [About Publish](../../src/editor/about-publish.test.ts), Home/Artists/Exhibitions/News state tests above; [Publish and recovery](../operations/editor-v1-operations.md#publish-and-recovery).                                                                                            |
| Cancel restores the last saved Draft; successful Save replaces that baseline, failed Save does not. It is not a filesystem or Git rollback.                                                                                         | [Cancel helper](../../src/editor/cancel.ts), [Cancel contracts](../../src/editor/cancel.test.ts); browser qualifications below.                                                                                                                                                                                                                                                                                                                                                       |
| Rename requires a reviewed plan and rechecks identity/drift/references; assets stay unchanged. Reference rewrites are collection-specific.                                                                                          | [Works](../../src/editor/works-rename.test.ts), [Journal](../../src/editor/journal-rename.test.ts), [Artists](../../src/editor/artists-rename.test.ts), [Exhibitions](../../src/editor/exhibitions-rename.test.ts), [News](../../src/editor/news-rename.test.ts), [Rename evidence](../../src/editor/content-rename-evidence-lifecycle.test.ts); [Rename procedures](../operations/editor-v1-operations.md#journal-rename).                                                           |
| Delete requires exact verified backup, reviewed confirmation, and no-cascade reference checks. Only content moves to recovery; assets stay unchanged. Dedicated Delete Publish commits only proven deletions locally, without push. | [Shared safety](../../src/editor/delete-safety-contracts.test.ts), [reference parser](../../src/editor/delete-reference-parser.test.ts), [Works](../../src/editor/works-delete.test.ts), [Journal](../../src/editor/journal-delete.test.ts), [Artists](../../src/editor/artists-delete.test.ts), [Exhibitions](../../src/editor/exhibitions-delete.test.ts), [News](../../src/editor/news-delete.test.ts); [Delete operations](../operations/editor-v1-operations.md#content-delete). |
| Managed images: admission, owner-bound temporary state, Save materialization, content/asset rollback, and evidence-authorized Publish.                                                                                              | [Works upload](../../src/editor/works-asset-upload.test.ts), [materialization](../../src/editor/works-asset-materialization.test.ts), [Journal Hero](../../src/editor/journal-hero-assets.test.ts), [Artists Hero](../../src/editor/artists-hero-assets.test.ts), [Exhibitions Hero](../../src/editor/exhibitions-hero-assets.test.ts), [Hero evidence](../../src/editor/hero-asset-publish-evidence.test.ts).                                                                        |
| Validation and UI action availability are collection-owned; malformed/missing units and invalid Drafts fail closed.                                                                                                                 | Collection state/Create tests above; [shared UX](../../src/editor/ux.test.ts), [About asset validation](../../src/editor/about-state.test.ts). Browser checks are representative, not exhaustive schema coverage.                                                                                                                                                                                                                                                                     |
| Rollback failure preserves evidence; Journal additionally has durable terminal guards across fresh sessions. Locks are not stolen.                                                                                                  | [Works transactions](../../src/editor/works-transaction-core.test.ts), News state/Create tests above, [Journal recovery](../../src/editor/journal-manual-recovery.test.ts), [lifecycle locks](../../src/editor/content-lifecycle-lock.test.ts); [recovery procedure](../operations/editor-v1-operations.md#journal-terminal-manual-recovery). Do not generalize Journal's recovery-status UI to every target.                                                                         |
| Backup/restore and Asset Lifecycle v2 are separate operator capabilities; content Delete does not authorize asset deletion.                                                                                                         | [Backup tests](../../src/editor/backup-recovery.test.ts), [quarantine/restore](../../src/editor/works-asset-reversible-cleanup-store.test.ts), [physical delete](../../src/editor/works-asset-physical-delete-store.test.ts); [Backup architecture](./backup-and-recovery-architecture-2026-08-07.md), [ALv2 finalization](./asset-lifecycle-v2-physical-delete-finalization.md). No physical-delete browser UI/HTTP route is claimed.                                                |

## Browser acceptance and limits

These are source mappings, not new PASS claims. The
[runner](../../tests/browser/run-browser-tests.mjs) uses a disposable clone/local
bare remote, materializes working-tree changes, normalizes its content fixture,
and runs serially using [Playwright configuration](../../playwright.config.ts).
Assertions apply to that isolated fixture, not mutations against the maintained
checkout. See [browser operation instructions](../operations/editor-v1-operations.md#browser-regression-suite).

| Browser source                                                                                                                                                   | Actual acceptance scope                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [editor-smoke](../../tests/browser/editor-smoke.spec.ts) — `launch, lifecycle smoke flow, and fail-closed gates`                                                 | Representative News Create/Preview/Save/Publish/Rename/Delete flow, backup and lock gates, navigation and console checks; not every collection's successful lifecycle.                                                                                                                                              |
| [editor-collections](../../tests/browser/editor-collections.spec.ts)                                                                                             | Artists/Exhibitions validate/Preview/Save/Publish; localized presentation; Journal locale isolation/TODO Publish rejection; Home singleton. `Exhibitions three-file Rename publishes exact paths and Delete fails closed without backup` proves Rename/reference Publish and Delete refusal, not successful Delete. |
| [works-lifecycle](../../tests/browser/works-lifecycle.spec.ts) — `Works three-file lifecycle acceptance`                                                         | Create/Preview/Save/Publish and Rename/Publish; replacement upload/Preview/Cancel restores reference; Delete fails closed without backup. Does not complete replacement Save→Publish or successful Delete.                                                                                                          |
| [journal-hero-asset](../../tests/browser/journal-hero-asset.spec.ts) — `Journal existing Hero replacement previews, saves, publishes, and converges`             | Existing Journal Hero replacement through Preview/Save/Publish and convergence. Does not establish equivalent browser coverage for every managed-Hero collection.                                                                                                                                                   |
| [home-editor-three-file](../../tests/browser/home-editor-three-file.spec.ts), [home-stale-concurrent-tab](../../tests/browser/home-stale-concurrent-tab.spec.ts) | Both locale Previews, Save/Publish, and stale concurrent-tab Save/Publish rejection.                                                                                                                                                                                                                                |
| [about-editor-three-file](../../tests/browser/about-editor-three-file.spec.ts)                                                                                   | Validated image selection, localized alt pairing, Preview/Save/Publish; JA/EN Preview `private, no-store` responses without changing public/unrelated Preview cache behavior. No image upload or approval workflow is inferred.                                                                                     |
| [editor-cancel-contract](../../tests/browser/editor-cancel-contract.spec.ts)                                                                                     | Seven-target field restoration/dirty clearing; combined Shared/JA/EN restoration on Artists; About select/thumbnail sync. Successful-Save baseline (News) and failed-Save baseline (Home) cases mock Save responses: they test UI baseline transitions, not real persistence or rollback.                           |
| [journal-manual-recovery](../../tests/browser/journal-manual-recovery.spec.ts)                                                                                   | Injected recovery response latches terminal UI across reload; a separate durable-evidence case rejects mutation from a fresh browser session. Not a successful manual restore/clear workflow.                                                                                                                       |

Exhaustive collection/locale permutations, injected transaction/push failures,
Preview expiry in a real browser, accessibility, and visual regression are not
claimed here. Consult service assertions for failure injection; old dated
browser records are historical evidence, not extra current-suite coverage.
The [Header browser spec](../../tests/browser/header-menu-navigation.spec.ts)
covers public navigation separately from Editor mutation contracts.

## About approval and known pending work

About's Editor lifecycle is implemented. Structurally valid pending/review/
placeholder work may be saved and Git-published; Preview requires a valid review
or approved locale. Formal public capability separately checks approved hours,
approved locale content, valid assets and route availability. Evidence:
[Draft validation](../../src/editor/about-draft-state.ts),
[`validation covers hours, contacts, statuses, placeholders, body and alts`](../../src/editor/about-state.test.ts),
[Production gate](../../src/content-boundaries/about-production.ts).
At the documentation baseline, hours and both locale statuses are `approved`
and JA/EN public routes are implemented. This records machine-readable state,
not a new editorial approval. Older pending-hours/EN-placeholder snapshots in
[About architecture](./about-localization-architecture-2026-08-18.md) are historical.

Home's legacy path input UI remains known pending, visible in
[HomeDraftForm](../../src/components/editor/HomeDraftForm.astro). It does not
mean the three-file Editor lifecycle is unimplemented. This documentation phase
neither changes that UI nor proposes a new contract.

## Reported final audit and reproducibility

| Record                                | Baseline / result / provenance                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation work                    | Fixed Phase 2 starting point `296d827b1e7d67f69c17c3d0db0654b7221dc2d8`; Phase 1 documentation commit.                                                                                                                                                                                                          |
| Prior final contract regression audit | Fixed `19c22839b238127068005aeccf378403222db6b5`; **407 Editor contract tests passed, 29 browser tests passed**, Astro check 0 errors / 0 warnings, production build successful (122 pages), no functional/safety contract regression detected, as reported in the preceding audit and supplied with this task. |
| Evidence limitation                   | No raw execution log is linked here. Execution time, environment, and artifact location are not established by this index. Counts are the prior report, not a static test count or a Phase 2 rerun.                                                                                                             |
| Phase 2 verification                  | Documentation/source correspondence, local links/anchors, formatting, changed-file scope and `git diff --check` only; no service/browser suite or build rerun.                                                                                                                                                  |

Reproduction entry points are `npm run editor:test` and
`npm run editor:test:browser` in [package.json](../../package.json). Browser
runtime/isolation prerequisites are in the operations guide. A future rerun
should record its own exact commit, environment, commands and results; it must
not silently replace the historical report above.
