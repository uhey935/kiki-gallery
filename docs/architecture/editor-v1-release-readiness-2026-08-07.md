# Editor v1 Release Readiness — Phase 4

| Property | Value                                                                    |
| -------- | ------------------------------------------------------------------------ |
| Date     | 2026-08-07                                                               |
| Scope    | Browser Acceptance and Production Readiness                              |
| Safety   | Save/Publish executed only in an isolated clone with a local bare remote |

## Classification

### Blocker

None after the release hardening below.

### Should-fix-before-v1-release — resolved

- Exhibitions and Artists opened in a false dirty state because form
  normalization differed from the serialized browser baseline. Their baseline
  is now aligned to the initial rendered form before the first dirty check.
- Flat collection validation panels were static and could claim `valid` while
  edited draft validation blocked every action. They now update issue count,
  capability labels, messages, and field-focus guidance on each render.
- Invalid Artists Works-layout JSON now appears in the validation panel instead
  of only in the action status.
- Journal could say `Saved · ready to publish` while unresolved EN placeholders
  blocked Publish. Its saved status now follows Publish capability.
- The starter README did not document runtime requirements, Editor startup,
  Publish safety, or recovery. README and the operator guide now provide the
  maintained entry points.

### Follow-up-after-release

- Browser automation for native file-chooser replacement; the browser session
  could inspect the Replace/Cancel/temporary-preview UI, while file selection
  was completed by the existing upload, draft, materialization, preview, and
  publish-manifest harnesses.
- Approved backup tooling and retention-duration governance for destructive
  Asset Lifecycle v2 operations.
- Dependency vulnerability remediation as a separately reviewed dependency
  milestone; `npm audit` currently reports 13 advisories (1 low, 2 moderate,
  10 high), principally through Astro's development/build dependency tree. The
  production result is static, the Editor is localhost-only, and acceptance
  does not broaden that trust boundary. Do not apply an unreviewed automatic
  major-version fix.
- Create/delete/rename, batch Replace, non-Works Asset Manager, shared ownership,
  storage migration, and derivatives remain outside Editor v1.

## Browser Acceptance

Dashboard and all six collection lists loaded and navigated to existing
workspaces. Existing values rendered. Works, Journal, Exhibitions, Artists,
News, and Home each completed edit, validation gating, Draft Preview, keyboard
Save, saved-unpublished state, and Publish in the isolated clone. Preview URLs
were tokenized; Works rejected a token paired with another Content ID. TTL and
locale/content binding are additionally covered by focused tests.

Pending actions lock forms and buttons through the shared workspace state.
Committed push failures and rollback failures enter manual-recovery terminal
states in focused harnesses. No destructive Asset Lifecycle v2 action was
exposed or invoked in the browser, matching the documented boundary.

## Production readiness

Clean install succeeds with a writable isolated npm cache on a supported Node
runtime. Development, build, production preview, Editor startup, Publish, and
manual recovery procedures are documented. `.kiki-editor/` remains Git-ignored
and excluded from production; its ledger, lock, quarantine, and deletion
manifest backup assumptions are explicit in the operator guide.

## Final verification

- Editor tests: 136 passed, 0 failed.
- Journal tests: 21 passed, 0 failed.
- Astro check: 0 errors and 0 warnings; 7 existing hints.
- Production build: 81 pages.
- Production mutation/preview route artifacts: 0; POST to a production mutation
  URL returns 404.
- Production physical-delete/manual-recovery artifacts: 0.
- Canonical content and Works assets: byte-hash diff 0 against the pre-audit
  manifest.
- Changed-file Prettier check and `git diff --check`: clean. A repository-wide
  Prettier pass is not a valid gate yet because historical files are unformatted
  and one deliberately malformed YAML fixture must remain malformed.

The release claim is limited to the existing-entry, localhost-only Editor v1
boundary. Within that boundary, no Blocker or unresolved Should-fix remains.
