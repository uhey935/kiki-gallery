# Editor Platform Audit

| Property      | Value                                  |
| ------------- | -------------------------------------- |
| Status        | Complete                               |
| Last reviewed | 2026-08-07                             |
| Scope         | Editor platform after Works completion |

## Decision

The Editor Platform is ready to close this audit milestone. Works and Journal
share a thin control plane while retaining collection-owned Drafts, schemas,
forms, serializers, preview models, filesystem transactions, and publish
targets. No generic repository, universal Draft shape, schema-driven form, or
operation base class is justified by the two current collections.

Production remains isolated from local mutation and Draft Preview routes. Astro
registers those routes only for `astro dev`; the production build contains the
static Editor shell but no mutation, token-creation, temporary-asset, Draft
Preview, or Git Publish endpoint.

## Audit classification

### Blocker — resolved

- Journal's three-file Save previously discarded rollback failures. The client
  could therefore receive a retryable `save-failed` response after canonical
  files had only been partially restored. Journal now returns the stable
  `journal-save-rollback-failed` code and the workspace enters the same terminal
  manual-recovery state used by Works.
- Journal cleanup failure could override a completed canonical replacement and
  report Save as failed. Cleanup is now best-effort after the transaction result
  is known, so a successful canonical Save cannot be misreported as retryable.

### Should-fix-before-Editor-Platform-final — resolved

- Works and Journal both lock their complete editable form boundary throughout
  asynchronous operations. Works additionally locks asset controls and stops
  all operations after a rollback failure.
- Both workspaces use the shared Save-shortcut and failure-guidance helpers.
  Manual-recovery failure classification is now a shared pure helper rather
  than a Works-only code comparison.
- Journal Save, state lookup, and Publish now use the established shared Editor
  Content ID predicate already used by Works.
- Works validation and capability presentation follows the current combined
  content-and-asset Draft rather than only the initially loaded canonical entry.

### Follow-up-after-final

- Reassess Action Bar and Validation presentation after a third collection
  proves a neutral prop shape. Journal's locale actions and Works' asset-aware
  actions are not yet the same component contract.
- Consider a small browser-level workspace harness when a third editor exists;
  current pure and collection tests cover the stable safety invariants without
  forcing collection branches into a nominally generic harness.
- Existing filename/format compatibility debt, physical deletion, orphan
  cleanup, batch Replace, storage migration, locale splitting,
  create/delete/rename, and derivative generation remain outside Editor v1.

## Boundary findings

- `EditorLayout`, collection registry, list-state adapter, route builders,
  Content ID validation, keyboard shortcut detection, and failure guidance form
  the current shared platform surface.
- Capability booleans remain derived from collection validation. The UI does not
  infer permission from issue text.
- Save, Preview, and Publish have common operator-facing states, but their data
  operations remain collection-owned: Journal writes three files and previews
  one explicit locale; Works writes flat Markdown plus transaction-owned assets
  and previews a combined content/asset Draft.
- Manual recovery is terminal in the active workspace. Reload/review/retry
  guidance remains code-driven and collection-neutral where meanings match.
- Production modules do not depend on Editor mutation modules. Canonical content
  and assets are not changed by the audit or its verification.

## Verification

- Editor tests: 84/84.
- Journal tests: 21/21.
- Astro check: 0 errors and 0 warnings (41 existing deprecation/script hints).
- Production build: 55 pages.
- Production mutation and Draft Preview route artifacts: 0.
- Prettier and `git diff --check`: clean.
- Canonical Works Markdown, Journal Content Units, and Works assets: no diff.
