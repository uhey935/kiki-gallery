# Editor v1 Finalization Audit

| Property      | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | Complete                                                    |
| Last reviewed | 2026-08-07                                                  |
| Scope         | Works, Journal, Exhibitions, Artists, News, and Home Editor |

## Decision

Editor v1 is complete. The six current editing targets cover flat Markdown,
three-file localized Content Units, asset-aware transactions, cross-collection
references, a small announcement schema, and singleton nested media without
forcing their data planes into a premature common abstraction.

The supported v1 boundary is editing existing canonical entries through
load → edit → validation → Draft Preview → atomic Save → minimal Publish. Local
mutation and Draft Preview routes remain development-only. Creating, deleting,
or renaming entries and managing assets outside the implemented Works slice are
not part of v1.

## Classification

### Blocker

None.

### Should-fix-before-Editor-v1-final — resolved

- Artists, Exhibitions, and News previously reported a committed push failure
  without entering the shared terminal recovery state. Their workspaces now
  lock every form and action after `committed-push-failed`, matching Works,
  Journal, Home, and the documented Publish safety boundary.

### Follow-up-after-v1

- Physical asset deletion, orphan cleanup, retention policy, and Git deletion
  Publish.
- Batch Replace and asset upload/replace outside Works.
- Storage migration, Journal/Works locale evolution, create/delete/rename, and
  derivative generation.
- Home responsive asset existence policy and cleanup of currently missing
  variants.
- A reference validator only after route, asset, and ownership semantics expose
  a genuinely shared contract.
- A browser-level workspace harness and explicit compatibility policy for
  existing filename/format mismatches.
- Generic Repository, Draft, serializer, preview store, form schema, operation
  orchestrator, or Asset Manager only when another concrete consumer proves a
  stable shared shape.

These items add lifecycle, migration, automation, or broader asset/reference
coverage. The existing-entry v1 workflow remains safe and complete without
them.

## Architecture findings

- Production schemas own the flat collection shapes. Astro supplies production
  reference resolvers to schema factories, while Editor validation supplies
  equivalent reference value schemas. Journal retains its canonical loader and
  schema boundary.
- Production pages and content boundaries do not import Editor mutation,
  preview, or publish modules. Editor routes adapt collection-owned operations;
  production does not depend on them.
- Content ID validation is explicit at read, Save, Preview, and Publish
  boundaries. Home narrows identity further to the exact singleton `home`.
- No dependency cycle was found in the local source import graph. No universal
  repository, Draft, serializer, preview store, schema-driven form, operation
  orchestrator, reference validator, or Asset Manager abstraction has leaked
  into the implementation.
- Shared code remains a thin control plane: layout and navigation, collection
  registry, Content ID predicate, Action Bar state, failure guidance, Save
  shortcut, and display-only flat validation panel.

## Workflow and validation findings

- Every workspace derives dirty and capability state from the current Draft,
  blocks Publish while dirty, locks its complete editable boundary during async
  work, supports Command/Ctrl+S, and gives code-driven failure guidance.
- Rollback failure is terminal where a multi-file or asset transaction can
  require manual recovery. A committed push failure is terminal across all six
  workspaces because retrying mutation from the stale workspace is unsafe.
- Works, Exhibitions, Artists, News, and Home use the display-only flat panel.
  Journal correctly retains locale capability and field navigation because its
  shared/JA/EN topology is materially different.
- Production and Editor share schemas for date, path/link, nested shape,
  cardinality, and conditional rules. Cross-entry and asset existence checks
  remain consumer- or collection-owned where their meanings differ.

## Production safety findings

- Save targets are collection-owned and baseline checked. Journal preserves its
  rollback-aware three-file transaction; Works preserves asset promotion and
  Markdown rollback semantics; one-file collections use atomic replacement.
- Publish rejects dirty or blocked Drafts and unsafe repository states, then
  stages only the selected Content Unit/file plus the exact saved Works asset
  manifest when applicable.
- The production static build contains no mutation endpoint, preview-token
  creation endpoint, temporary-asset endpoint, Git Publish endpoint, or Draft
  Preview route.
- Finalization verification did not modify canonical content or canonical
  assets.

## Documentation authority

This document is the current Editor v1 completion authority. The Editor
Platform Audit and Phase 2 collection documents remain implementation decision
records. `journal-architecture-current.md` and the Works Asset Manager
specification remain authoritative for their collection-specific transaction
and production boundaries. Earlier prototype gates and read-only slice wording
are historical where those current documents mark them superseded.

## Verification

- Focused and full Editor tests: 104/104.
- Journal tests: 21/21.
- Astro check: 0 errors and 0 warnings (7 existing hints).
- Production build: 81 pages.
- Production mutation endpoint artifacts: 0.
- Draft Preview route artifacts: 0.
- Prettier check and `git diff --check`: clean.
- Canonical Works, Journal, Exhibitions, Artists, News, and Home content diff: 0.
- Works and related canonical asset diff: 0.
- Production-to-Editor dependency violations and local source import cycles: 0.

The Phase 2 changes and this finalization hardening form one coherent milestone.
Commit after reviewing this complete diff rather than splitting collection or
audit changes into smaller commits.
