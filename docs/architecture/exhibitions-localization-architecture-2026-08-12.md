# Exhibitions Localization Architecture

| Property | Value                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Status   | Implementation-ready target architecture; not yet implemented                                                |
| Date     | 2026-08-12                                                                                                   |
| Scope    | Exhibitions three-file localization, Production, Editor, routes, references, lifecycle safety, and migration |
| Excluded | Migration execution, Production cutover, Editor implementation, Works localization, asset lifecycle changes  |

This document is the authority for the next Exhibitions Localization
implementation. The repository remains on the flat Markdown runtime until a
separately reviewed migration and cutover are completed. The normalized bytes
currently present in `src/content/exhibitions/*.md` are the only migration
source of truth. Earlier Exhibitions Editor, Rename, and Delete documents remain
authoritative for the current flat implementation and historical safety
evidence; after cutover, their topology descriptions become historical.

## 1. Canonical topology and identity

Each Exhibition becomes one exact three-file Content Unit:

```text
src/content/exhibitions/<contentId>/
  index.yaml
  ja.md
  en.md
```

The directory name `<contentId>` is the canonical Exhibition identity. It is
the only identity permitted in routes, `artists[]`/`works[]` relations, News
links, lifecycle evidence, and external references. Localized adapter entries
may use opaque internal IDs `ja::<contentId>` and `en::<contentId>`. Consumers
must not parse, persist, route, or expose those IDs.

Exactly `index.yaml`, `ja.md`, and `en.md` are permitted in a unit. Missing,
extra, non-regular, or symlinked entries fail closed. A directory and a legacy
flat `<contentId>.md` may never coexist.

## 2. Schema ownership

Schemas are strict: shared fields are rejected in locale files and localized
fields are rejected in `index.yaml`. Unknown fields are structural errors.

### Shared `index.yaml`

| Field              | Requirement | Default and validation                                                                                                                                 |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `artists`          | Required    | Non-empty ordered array of canonical Artist Content IDs; unique; every ID must resolve as an Artist identity.                                          |
| `works`            | Optional    | Ordered array of canonical Work Content IDs; unique; absent means no curated Works. Every ID must resolve. Each Work's Artist must occur in `artists`. |
| `start_date`       | Required    | Valid `YYYY-MM-DD` calendar date.                                                                                                                      |
| `end_date`         | Required    | Valid `YYYY-MM-DD`; must be on or after `start_date`.                                                                                                  |
| `display_artists`  | Optional    | Boolean; absence means `true`. It controls presentation only and never identity, order, or name resolution.                                            |
| `hero.image`       | Required    | Non-empty canonical public path. Migration copies it exactly and does not inspect, move, rename, or own the asset.                                     |
| `hero.orientation` | Required    | `portrait` or `landscape`.                                                                                                                             |
| `hero.position`    | Optional    | `top`, `center`, `bottom`, `left`, or `right`. No default is serialized.                                                                               |
| `hero.treatment`   | Optional    | `default`, `contain`, or `cover`. No default is serialized.                                                                                            |

`hero.position` and `hero.treatment` have no current canonical values and
limited current rendering use, but they are already validated and editable
presentation contracts. They remain optional shared fields rather than being
removed or deprecated during localization. `status` remains derived from dates
and is never stored.

### Localized `ja.md` and `en.md`

| Field           | Requirement | Default and validation                                                                                                                   |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `title`         | Required    | Non-empty localized string; unresolved reserved placeholders are not valid for Production capability.                                    |
| `summary`       | Optional    | Non-empty localized short lead when present. Absence renders nothing; never derived from body.                                           |
| `venue`         | Optional    | Non-empty localized display string.                                                                                                      |
| `opening_hours` | Optional    | Non-empty localized display string.                                                                                                      |
| `closed_days`   | Optional    | Non-empty localized display string.                                                                                                      |
| `attendance`    | Optional    | Non-empty localized display string.                                                                                                      |
| `hero_alt`      | Required    | Non-empty localized alternative text.                                                                                                    |
| `hero_caption`  | Optional    | Non-empty localized caption. The compatibility read model may expose this as `hero.hero_caption`; shared `hero` never owns caption text. |
| `seo_title`     | Optional    | Non-empty localized override. Absence uses the explicit localized `title`.                                                               |
| `description`   | Optional    | Non-empty localized override. Absence uses the current deterministic Artist/date description policy.                                     |
| Markdown body   | Optional    | Locale-owned Markdown; empty is valid and renders no body.                                                                               |

Blank optional strings are normalized to absence by the Editor and rejected in
canonical schema output. There is no prose generation during migration, Save,
or runtime. Venue and schedule strings deliberately remain localized scalars:
the current data and UI do not justify a structured venue/time redesign.

SEO fields are introduced as optional schema fields now, matching Artists and
avoiding a later topology change. Migration does not synthesize them. Existing
derived metadata remains the fallback when they are absent.

Reserved `__TODO_...` values are permitted only as migration/editor source
evidence, are reported as content-quality issues, and block the affected
locale's Preview/Production capability. They never become rendered output.

## 3. Title and Artist semantics

All five normalized Exhibitions contain an explicit title. Localization makes
`title` required and removes the old runtime-generated solo/group title
fallback. This is deterministic, avoids locale-specific grammar in shared
utilities, and preserves group-exhibition editorial intent. Migration copies
each current title to JA and emits an EN title placeholder; it does not create a
title from Artist names.

`artists[]` stores canonical Artist Content IDs only. For a locale to be
Exhibition-capable, every referenced Artist must be capable in that locale and
must resolve through the Artists Production facade. Artist display names are
never copied into Exhibitions, and there is no JA/EN fallback. A future
Exhibition-specific credit may be added only as a separately named localized
override; it must not replace canonical Artist identity or the normal Artist
name.

## 4. Capability model

Identity/shared capability and each locale capability are evaluated
independently with owned issues. A shared structural error blocks both locales.
A locale error blocks only that locale unless it reveals a shared/reference
error.

JA Production capability requires:

- exact valid shared inventory and schema;
- valid `ja.md` localized schema and Markdown;
- no unresolved JA placeholder;
- every `artists[]` identity exists and is JA-capable; and
- the canonical Content ID can be projected to a JA route.

EN Production capability applies the same rules to `en.md` and EN-capable
Artists. A missing, invalid, or placeholder EN file blocks EN only. Works locale
capability is not an Exhibition route blocker.

For either non-capable locale, the Exhibition is excluded from that locale's
Index and associations and receives no Detail route. EN failure never affects
JA Index, Detail, Home, or Artist associations. Runtime fallback in either
direction is prohibited.

## 5. Works dependency

`works[]` remains a shared ordered set of canonical references. Reference
validity is separate from localized display capability:

- an invalid/missing canonical Work is a shared blocker;
- lack of a locale-capable Work does not block the Exhibition locale or route;
- only Works capable in the requested locale are rendered;
- no Work is resolved through another locale;
- if zero Works are display-capable, the Works section is omitted; and
- Editor validation reports non-displayable locale Works as warnings while
  preserving the canonical references.

Works is currently flat and has no locale capability facade. Therefore an EN
Exhibition cutover must not render current flat Work title, material, or alt as
implicit EN. Until Works supplies a locale-aware projection, EN Exhibition
Details omit the Works section. JA continues through a narrow compatibility
projection that preserves current output. This temporary adapter must be
replaceable without changing Exhibition topology or `works[]`.

## 6. Production architecture

The target read flow is:

```text
three-file repository
  -> strict unit loader and owned issues
  -> locale entry adapter
  -> Exhibitions Production facade
  -> locale capability/selectors and route registry
  -> Index / Detail / Home / Artist relation / News projection
```

Required modules and responsibilities:

- **repository**: exact filesystem inventory, parse state, raw source retention,
  unit issues, and no fallback;
- **schemas/contracts**: shared/localized ownership, locale and issue types;
- **Astro loader**: synchronize identity and localized entries, remove stale
  store entries, and contextualize parse/render failures;
- **adapter**: combine shared identity with one locale without leaking internal
  IDs;
- **capabilities**: evaluate shared, locale, Artist dependency, placeholder,
  and route readiness;
- **facade**: `forLocale`, `find(contentId, locale)`, and consumer-specific
  selectors while transporting all owned issues;
- **selectors**: stable date/status sorting, Home selection, Artist reverse
  relation, and locale-filtered Works projection; and
- **route registry**: build/parse canonical locale routes and enumerate only
  capable Detail routes.

Production code must stop calling `getCollection("exhibitions")` directly.
Exhibitions Index, Detail, Home, JA/EN Artist Details, and News image/link
resolution consume the facade or a boundary projection. The Artists/News
repository, loader, adapter, capability, facade, and stale-store patterns are
reused; schedule/status, Artist/Work validation, Markdown rendering, Event SEO,
and reverse associations remain Exhibitions-specific.

## 7. Routes and consumer projections

| Locale | Index              | Detail                         |
| ------ | ------------------ | ------------------------------ |
| JA     | `/exhibitions/`    | `/exhibitions/<contentId>/`    |
| EN     | `/en/exhibitions/` | `/en/exhibitions/<contentId>/` |

The registry accepts canonical Content ID plus locale. It builds a Detail route
only for a capable locale entry. Internal localized IDs are never route input.
Existing JA routes and trailing-slash output remain unchanged.

JA Home preserves current date/status ordering and two-item selection using only
JA-capable entries. EN Home is outside this phase; a future EN Home must use the
same selector scoped to EN-capable entries.

Artist Details derive their Exhibition relation by reverse lookup over
`artists[]`. JA shows JA-capable Exhibitions. EN requires the Artist Detail and
the related Exhibition both to be EN-capable. No stored Artist-to-Exhibition
reference or localized relation ID is introduced.

## 8. News integration

News continues to store `/exhibitions/<contentId>` in shared `index.yaml` as a
canonical reference token. It is not a locale-specific href.

- JA projection emits `/exhibitions/<contentId>/` only when the JA Exhibition
  is capable.
- EN projection emits `/en/exhibitions/<contentId>/` only when the EN
  Exhibition is capable.
- A non-capable target yields `href = null`; the localized News entry remains
  visible and renders a non-linked title.
- News locale capability remains independent from Exhibition capability.
- Projection never falls back to a JA href.
- The EN News Exhibition category link becomes `/en/exhibitions/` after that
  Index exists.

Rename continues to rewrite the one shared canonical News route token. It does
not write locale routes into News source.

## 9. Editor target lifecycle

Editor state independently retains raw/parsed `index.yaml`, `ja.md`, and
`en.md`, their issues, and one exact three-file baseline. Shared, JA, and EN
dirty responsibility is explicit. Legacy flat detection is read-only and
fail-closed.

- **Create**: validate scaffolding and atomically create all three files; no
  partial unit or implicit translation.
- **Load**: require the exact inventory and expose locale-owned issues without
  Production fallback.
- **Preview**: create content-bound, expiring JA/EN models independently;
  placeholder or dependency failure blocks only its locale.
- **Save**: validate the complete unit, compare all baseline raw bytes, stage
  all three outputs, install them as one transaction, reread, and byte-exactly
  roll back on failure. Uncertain rollback retains the lifecycle lock and
  manual-recovery evidence.
- **Publish**: require a saved clean baseline and stage only all three canonical
  paths, or the exact path set authorized by completed Rename/Delete evidence.
- **Rename**: move one exact directory unit, regenerate internal locale IDs from
  the destination Content ID, and rewrite supported News references.
- **Delete**: prove an exact backup, reject incoming references, move the exact
  three-file unit to recovery, and publish only evidence-authorized deletions.

Artists lifecycle transaction, drift, rollback, and legacy-detection machinery
is reusable. Exhibitions retains collection-specific date rules, Artist/Work
dependency diagnostics, body/summary preview, Event metadata, News link
rewrites, and Works display warnings.

## 10. Rename and Delete safety

Exhibition Rename plans bind repository identity, branch/upstream, operation
ID, source/destination IDs, exact three-file inventory and hashes, old/new JA
and EN route projections, full reference-graph hash, News byte-span edits,
prospective bytes, touched/publish paths, and plan hash. Execution uses the
existing non-stealing lifecycle lock and preserves collision, case-fold,
symlink, non-regular, source-drift, prospective-validation, rollback, and
manual-recovery boundaries. Artists and Works do not store Exhibition IDs, so
they require no Rename rewrite. Home and Artist relations are derived.

Delete inventory is the exact three-file unit. Backup proof must contain the
current bytes of all three sources. Stored incoming News routes block Delete;
derived Home/Artist relations do not. Exhibitions points to Artists and Works,
not the reverse, so those outgoing references do not constitute incoming
Delete blockers for an Exhibition. Execution, recovery, rollback proof,
non-stealing lock, retained assets, and evidence-limited Publish remain at least
as strict as the current implementation. Assets are never inferred or deleted.

## 11. Migration contract

One reviewed all-items transaction converts exactly five flat Markdown files to
five directories and fifteen files. The normalized current flat bytes—not an
older commit—are the source.

Deterministic mapping:

- copy shared fields to `index.yaml` without reordering references or changing
  dates, Content IDs, asset paths, or optional-value presence;
- copy localized frontmatter and the exact current body to `ja.md`;
- map legacy `hero.hero_caption`, when present, to localized `hero_caption`;
- emit reserved EN placeholders for required `title` and `hero_alt`, and an EN
  body placeholder when a translation is required by the migration policy;
- do not invent optional summary, venue, schedule, attendance, caption, or SEO
  prose; placeholder only those fields explicitly selected by the frozen
  manifest policy; and
- preserve every external Artist/Work ID, News canonical link, and JA route.

The frozen manifest records exact source inventory, source bytes/hashes,
content IDs, field mapping decisions, generated bytes/hashes for all fifteen
targets, reference/route evidence, and rollback bytes. Generation and execution
reject unexpected inventory, source drift, target/case-fold collision,
symlinks, non-regular files, incomplete validation, and a manifest mismatch.
Staging occurs outside canonical targets. Promotion/removal is global across all
five units; any failure restores every original flat byte and removes every
transaction-owned target. Uncertain rollback preserves staging and manual
recovery evidence.

The frozen implementation manifest is
`docs/architecture/exhibitions-migration-manifest-2026-08-12.json`; its
immutable SHA-256 is
`246edf641a799c4dc46624700653d0e50250168a729e33f0ca5933b458989725`.
Required EN fields and a non-empty source body receive reserved placeholders;
optional EN fields remain absent, so no optional prose or SEO text is invented.

Artists migration manifest/executor infrastructure, hashing, collision checks,
staging, global rollback, and evidence format are reusable. Exhibition
frontmatter/body conversion, date and reference validation, nullable/optional
mapping, EN body placeholder decisions, and post-install consumer validation
are collection-specific.

## 12. Legacy policy

After cutover there is no flat Exhibitions Production or Editor read/write
fallback. Read-only detection of any legacy flat source is retained so a mixed
repository fails closed. Migration converter, executor tests, frozen manifest,
rollback evidence, and safety regressions remain historical/recovery tooling,
not runtime adapters.

Cutover may then retire the Astro glob collection, flat schema entry point,
flat Editor state/draft/serializer/save/create/preview assumptions, flat
Rename/Delete inventory, generated-title helper, and direct
`getCollection("exhibitions")` consumers. Removal happens only after the new
facade, lifecycle, migration evidence, and acceptance suite prove no runtime or
recovery dependency.

At implementation completion, this document should be renamed or promoted to
`exhibitions-architecture-current.md`. Existing flat Phase 2, Rename, Delete,
and browser-acceptance documents receive explicit historical/superseded status
links; their evidence is retained.

## 13. Test and acceptance strategy

Implementation is gated by:

- strict shared/localized schema ownership, exact inventory, unknown-field,
  date-order, reference, and body parsing tests;
- loader/repository issue ownership, missing/invalid locale, stale-store, and
  symlink/non-regular tests;
- facade no-fallback, placeholder isolation, stable sort/status, and locale
  capability tests;
- required localized title and explicit group-title preservation tests;
- Artist JA/EN dependency resolution without display-name duplication;
- valid Work reference plus locale omission/zero-section behavior, including
  the temporary flat-Works constraint;
- exact JA Index/Detail/Home/Artist output and five JA route preservation;
- EN Index/Detail filtering and absence of placeholder/non-capable routes;
- News canonical-link JA/EN projection and non-linked EN behavior;
- atomic Create, locale Preview, three-file Save, drift, rollback, manual
  recovery, and exact ordinary Publish tests;
- directory Rename with News rewrite, collision/drift/lock/rollback, exact
  evidence, and Publish-set tests;
- three-file Delete backup/incoming-reference/recovery/rollback/evidence and
  retained-asset tests;
- manifest determinism, current source hashes, 5-to-15 inventory, dry-run,
  target collision, global rollback, and legacy mixed-state refusal; and
- fresh-process browser acceptance for JA/EN editing, capability isolation,
  Preview/Save/Publish, Rename continuity/News rewrite, Delete refusal/recovery,
  console errors, and exact Git path sets in an isolated clone.

Reuse the Artists repository/migration/lifecycle harnesses, News
cross-capability fixtures, current Exhibitions isolated Git tests, and existing
browser runner. Do not mutate Production content to manufacture failure cases.

## 14. Implementation sequencing and gates

The architecture is implementation-ready in these bounded slices:

1. contracts, schemas, repository, adapter, capabilities, facade, and fixtures;
2. route registry and read-only Production consumer integration behind tests;
3. three-file Editor lifecycle and lifecycle evidence extensions;
4. frozen migration manifest and dry-run review;
5. isolated all-five migration plus Production cutover;
6. browser acceptance, obsolete runtime removal, and current-authority docs.

The normalized Exhibition sources are committed in `a39eb68` and are the
required migration baseline. The frozen manifest must bind the exact source
bytes present at its reviewed generation point and must not use a pre-correction
tree. No additional content, translation, Works localization, asset, or route
decision blocks the first implementation slice.
