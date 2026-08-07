# Journal Read-only Prototype Findings

Date: 2026-08-06  
Status: Historical evidence; implemented and superseded by Architecture Finalization
Scope: Journal prototype evidence plus the completed production migration and cleanup record

> Current authority: [Journal Architecture — Current](./journal-architecture-current.md). References below to a separate `journalPrototype` collection, `/prototype/journal/`, unchanged Production consumers, `npm run prototype:test`, or future prototype cleanup describe the state at the time of the experiment. The prototype collection/page/code and command have since been removed; all four Production consumers now use the Production facade.

## Result

The approved read-only boundaries are implementable with Astro 6. The prototype reads directory-based `index.yaml + ja.md + en.md` Content Units, derives Content ID from the directory, emits one Astro Content Layer entry per structurally valid locale, retains raw Markdown, and successfully renders those entries with `render(entry)` in an isolated build harness.

Four fixtures prove public, hidden, missing-EN, and unresolved-EN-placeholder states. A missing or invalid locale does not discard its valid sibling. Issues contain facts only; the Journal Capability Evaluator separately derives Save, locale Preview, and Publish availability.

## Proven prototype boundaries (historical)

- The custom `journalPrototype` collection is separate from the production `journal` collection.
- Entry data is flat and consumer-compatible while adding `contentId`, `locale`, and prototype-only `visibility`.
- Query Adapter filtering is locale-explicit; lookup uses `data.contentId`; sorting is date descending then Content ID ascending.
- Site Content Service decisions cover Journal Index, Detail, Home Stories, and News integration. Hidden Detail returns `unavailable`; hidden list/aggregation entries return `exclude`.
- Route Registry builds and exactly parses `/journal/{contentId}/` and `/en/journal/{contentId}/` without exposing Entry ID.
- The consumer harness maps Journal Index/Detail, Home Stories, News aggregation, and legacy News-link image/reference resolution through Query, Site Content, and Route Registry boundaries.
- Full-set synchronization removes stale entries after deletion, directory rename, and valid-to-invalid transitions.
- The generated `/prototype/journal/` harness performs real Astro `render(entry)` calls and exposes source states, Issues, Capability results, and per-surface render decisions. It is not linked from production navigation.

## Prototype findings retained as choices

1. **Entry ID encoding:** `locale::contentId` works as an opaque Store key. No consumer parses it, so this encoding is not standardized.
2. **Store synchronization:** a full rescan plus set-difference deletion is simple and correct for the fixture scale. Incremental updates and performance thresholds remain deferred.
3. **Watcher behavior:** add/change/unlink and directory events are debounced and rescans are serialized. Astro supplies a watcher, but teardown and hot-reload listener lifetime are not fixed by the public Loader context and remain a production-hardening finding.
4. **Digest strategy:** the prototype digests a JSON serialization of Entry identity, parsed data, and raw body. The byte contract and serialization remain unfixed.
5. **Markdown rendering:** `renderMarkdown()` output stored by the Loader is compatible with `render(entry)` in Astro 6; raw `body` remains available on the Entry.
6. **Unavailable View:** the prototype implements only the `unavailable` decision. The production review below now fixes its public semantics; presentation remains unimplemented.
7. **Content-ID encoding:** the prototype accepts the existing lowercase hyphenated Content ID grammar. Broader URL encoding rules remain a Route Registry evolution concern.

## Production-migration decisions

### Entry ID remains opaque

The production migration does not need to standardize the `locale::contentId` encoding. The prototype proves that locale entries are unique and that Astro accepts the value as a Store key. More importantly, the approved boundaries already prevent the encoding from becoming a public contract:

- Loader code alone creates Entry IDs through a private helper.
- Query and Site Content APIs identify content by `entry.data.contentId` plus locale.
- Route Registry builds and parses routes from Content ID plus locale.
- References, view models, `getStaticPaths()`, and presentation code must not parse or construct `entry.id`.

The production Loader may retain the prototype encoding behind a helper. Query Adapter may later share that helper internally to replace a collection scan with `getEntry()`, but that is an implementation optimization and must not change the public query contract. A future encoding change requires a full Store resynchronization and a regression test that stale IDs are removed; it does not require a route or content migration.

### Hidden Journal Detail is a 404-class Unavailable View

A hidden Journal item is known to the repository but unavailable on the public site. Its public Detail behavior is therefore:

- do not render or disclose the Journal title, summary, hero, body, credits, or publication date;
- use HTTP `404 Not Found` semantics, not `200`, `401`, `403`, redirect, or `410`;
- render generic unavailable/not-found copy that does not confirm whether the Content ID exists;
- emit `robots` metadata equivalent to `noindex, nofollow` if an unavailable document is rendered;
- omit the URL from sitemap, Journal Index, Home Stories, News aggregation, navigation, related-content UI, feeds, structured data, alternate-locale links, and every other public internal-link source;
- keep existing repository references integrity-valid for Editor and validation purposes, without turning those references into public links.

`Unavailable View` is a Site Content Service decision, not a third content state and not permission-gated content. `hidden` remains valid and renderable inside repository/editor boundaries. The decision deliberately gives missing, invalid-for-locale, and hidden public Detail requests the same non-disclosing public presentation; diagnostics remain available only through Issues and Editor-facing boundaries.

The current site uses Astro's static output. In static output, creating a content-specific HTML file for a hidden URL cannot guarantee a `404` response from the host and would normally create a `200` soft-404. Therefore the first production slice must omit hidden entries from `getStaticPaths()`, allowing the deployment's normal 404 handling to supply the real status. A branded per-Content-ID Unavailable View at the original URL is deferred until a deployment adapter, host rewrite/error-page rule, or on-demand route can prove the `404` status end to end. It must not be simulated by a generated `200` page.

No sitemap integration is currently installed, and no Journal EN production route exists yet. The migration must nevertheless expose hidden filtering as shared policy so a future sitemap/feed/EN route cannot accidentally enumerate hidden entries. `robots.txt` disallow rules are not a substitute for `noindex` and are not required for hidden Content IDs.

### Watcher lifecycle and digest serialization remain deferred

Both items can remain deferred without blocking the static production migration:

- Production builds require the initial full synchronization and stale-entry convergence; they do not depend on a development watcher.
- The prototype proves debounce, serialized rescans, and stale deletion, but Astro's public Loader context supplies a watcher without a Loader-specific teardown hook. Production code must avoid knowingly registering duplicate listeners in one active load, while teardown/hot-reload hardening remains a development reliability follow-up.
- The digest is only an Astro Store change-detection optimization. The current serialization changes when Entry identity, parsed data, or raw Markdown changes, and stale deletion is handled separately.
- Digest bytes and property ordering do not cross a public boundary and must not be reused as an Editor conflict token, cache key, content identity, or persistence format. Canonical serialization is required only if one of those requirements is later approved or nondeterministic rebuild behavior is observed.

These deferrals must not weaken the fixed requirements: a build starts from repository truth, data/body/identity changes invalidate the stored Entry, and delete/rename/valid-to-invalid transitions remove stale entries.

## Staged Journal production migration plan (implemented)

Each stage was delivered as a separate reviewable slice. The list is retained as the executed migration plan; all four stages are complete.

1. **Journal Index**
   - Introduce the production three-file Journal collection, migration default `visibility: public`, private Entry ID helper, Query Adapter, Site Content Service, and Route Registry together.
   - Migrate all current Journal units without inventing EN translations or fallback content.
   - Switch only the JA Index to public/renderable entries and registry-built links; preserve the current date-descending display, with Content ID ascending as the deterministic tie-breaker.
   - Compare item count, order, copy, images, and generated JA URLs with the current build; assert that hidden and invalid-locale entries produce no links.
2. **Journal Detail**
   - Generate JA Detail paths from public/renderable decisions and `contentId`, never `entry.id`.
   - Omit hidden and unavailable entries from static paths so requests receive the deployment's real 404 response; verify response status against the actual preview/deployment, not HTML alone.
   - Keep unavailable presentation generic and non-disclosing. Add explicit robots metadata only if a 404 document is rendered at the requested URL; do not ship a static `200` soft-404.
   - Add EN Detail paths only for structurally valid EN entries. Missing EN must remain unavailable and must not fall back to JA.
3. **Home Stories**
   - Replace direct Journal collection reads with the same Query and Site Content boundaries.
   - Preserve the current maximum, ordering, cards, and images; build links through Route Registry and prove hidden entries cannot fill a slot or leak a URL.
4. **News integration**
   - Move Journal aggregation to the shared visibility policy while preserving News-specific grouping and ordering.
   - Parse legacy News links only at the Route Registry adapter, resolve by Content ID and locale, and stop using `entry.id` maps as reference identity.
   - Existing references to hidden Journal items remain repository-valid but produce no public link or content disclosure. Define the non-link presentation for such legacy references in this slice.

After every slice, run focused boundary tests plus `astro check`, `astro build`, route-manifest/output comparison, and `git diff --check`. After Detail, also perform an HTTP-level check that a hidden and a missing Content ID both return 404 and that no generated public page links to either URL.

## Unresolved risks and gates

- The actual hosting platform is not recorded in this repository. Hidden-URL status behavior must be verified on the real deployment before Detail migration is accepted.
- The current `site` value is a placeholder and no sitemap integration is installed. Canonical-host and sitemap work must be configured deliberately before treating generated SEO output as production evidence.
- A content-specific branded 404 at the original hidden URL is not guaranteed by the current static architecture. It remains optional; correct status and non-disclosure take priority.
- Journal has no current EN content. EN route generation, alternate links, and locale-specific unavailable behavior need fixtures and build assertions before activation.
- Watcher listener accumulation may affect long-running development sessions. Escalate it from deferred to blocking only if the production Loader shows duplicate rescans, retained listeners, or unstable hot reload.
- Non-canonical digest serialization may cause unnecessary Store updates across implementation/runtime changes. It becomes blocking only if it affects reproducible output or is proposed for a cross-process contract.

## Deviations and exclusions at prototype completion

There are no architecture-contract deviations. One isolated diagnostic page is generated so `astro build` executes the real render path; production Journal, Home, and News consumers are unchanged. No Save, Rename, Delete, Publish workflow, File Writer, Git Publisher, crawler behavior, full-collection migration, or UI work was added.

The prototype adds direct runtime dependency `yaml` and development dependency `@types/node`. Dependency installation reported 13 audit findings in the existing dependency graph; no out-of-scope automatic dependency upgrades were applied.

## Verification

Historical prototype verification used a Node version accepted by Astro 6 (then verified with Node 24.14.0):

```text
npm run prototype:test
npm run check
npm run build
```

Results on 2026-08-06:

- Prototype tests: 7 passed, 0 failed.
- Astro check: 0 errors, 0 warnings, 65 pre-existing/deprecation hints.
- Astro build: successful, including `/prototype/journal/` and the existing static routes.

`npm run prototype:test` and `/prototype/journal/` are historical names. After cleanup, use `npm run journal:test`; the current verification contract and Node version are recorded in [Journal Architecture — Current](./journal-architecture-current.md).

## Production migration: Journal Index

The first production consumer migration is complete. Only the JA Journal Index now reads through a production Query Adapter and the Journal Index policy owned by the Site Content Service boundary. Journal Detail, Home Stories, and News integration continue to read the existing `journal` collection directly.

The adapter supplies the current flat production entries with explicit `contentId`, `locale: ja`, and migration-default `visibility: public` fields. The Site Content selection then requires the requested JA locale, public visibility, and no applicable render-blocking error. Sorting is date descending with Content ID ascending for ties. Presentation uses `data.contentId` for the existing `/journal/{contentId}` link shape and does not consume or expose an encoded Store Entry ID.

There are no display differences: the generated Journal Index HTML is byte-for-byte identical before and after migration. The nine cards, Hero selection, ordering, titles, dates, categories, summaries, images, alt text, and href values are unchanged. The only type-level difference is the explicit boundary metadata described above.

Verification used Node 24.14.0 and passed 9 focused tests, including hidden, locale-error/placeholder, EN exclusion, and tie sorting; Astro check with 0 errors, 0 warnings, and the existing 65 hints; Astro build with the same 35 pages and 73 generated files; exact route-list comparison; exact Journal Index HTML comparison; and `git diff --check`.

## Production migration: Journal Detail

The JA Journal Detail production consumer now enumerates entries through the production Query Adapter and the Detail policy owned by the Site Content Service boundary. Route parameters are derived from the Route Registry using `data.contentId` and explicit `locale: ja`; the consumer neither treats `entry.id` as Content ID nor places it in route data. Home Stories and News integration remain unchanged.

The current flat production collection is adapted with migration-default `visibility: public`. Detail path generation requires a JA entry that is public and has no applicable render-blocking error. Hidden, locale-blocked, and EN entries are therefore omitted from `getStaticPaths()`. The original Astro content entry remains attached to the boundary result, so `render(entry)` continues to render the existing raw Markdown body without conversion or reconstruction.

There are no rendering or type-contract deviations. The only type-level additions are the explicit Detail selection and the `{ collection, contentId, locale }` Route Registry reference. The generated nine JA Detail URLs and their title, date, hero, hero alt, caption, and body HTML are unchanged; the Detail HTML files are byte-for-byte identical to the pre-migration build.

Verification used Node 24.16.0 and passed 11 focused tests, including Detail exclusion of hidden, locale-error/placeholder-equivalent, and EN entries plus Route Registry rejection of an opaque Entry ID. Astro check completed with 0 errors, 0 warnings, and the existing 65 hints. Astro build completed with the same 35 pages and 73 generated files. The complete generated file list and all nine Journal Detail HTML files matched the pre-migration build exactly, and `git diff --check` passed.

## Production migration: Home Stories

The production Home Stories consumer now obtains its Journal candidates through the production Query Adapter and the Home Stories policy owned by the Site Content Service boundary. News loading, News filtering and mapping, News image/reference resolution, and the production News page remain unchanged. In particular, the raw production Journal collection is still supplied to the existing News image resolver; that separate integration has not been migrated in this slice.

Journal candidates must be JA, public, and free of applicable render-blocking errors. The boundary returns them in date-descending order with Content ID ascending for equal dates. The Home consumer continues to own hero/category eligibility, conversion to the existing Story view model, merging with News, the combined date ordering, and the six-item slice. Journal hrefs are built by the Route Registry from `data.contentId` rather than `entry.id`.

The display data and presentation contract are unchanged: title, date, first category, hero image, hero alt, href shape, combined News/Journal selection, six-item limit, and rendered Stories markup are preserved. At the type boundary, Journal entries gain explicit `contentId`, `locale: ja`, and migration-default `visibility: public`; the Home Journal Story identity and route now use Content ID. No dependency changes are required.

Verification used Node 22.22.1 and passed 12 focused prototype/boundary tests, including Home exclusion of hidden, locale-error/placeholder-equivalent, and EN entries plus Content-ID tie sorting. Astro check completed with 0 errors, 0 warnings, and the existing 65 hints. Astro build completed with the same 35 pages and 73 generated files. The complete generated file list and the full Home HTML were byte-for-byte identical to the pre-migration build, and `git diff --check` passed.

## Production migration: News integration

The final production Journal consumer migration is complete. The News page now obtains Journal aggregation candidates through the production Query Adapter and the News integration policy owned by the Site Content Service boundary. Candidates must be JA, public, and free of applicable render-blocking errors. News collection loading and conversion, Journal-to-News View Model conversion, combined date sorting, year grouping, date formatting, category links, and presentation remain owned by the News consumer.

The Home consumer's News image resolver no longer parses a Journal URL segment as an Astro `entry.id` or looks it up in an Entry-ID-keyed map. It first asks the Route Registry to parse an exact known Journal route into `{ collection, contentId, locale }`, then resolves the selected Journal candidates by locale plus Content ID. Exhibition and Artist image resolution remains unchanged. A broken known Journal reference continues to fail the build rather than silently change the existing card behavior.

There are no rendered behavior differences. News titles, dates, summaries, types, hrefs, combined ordering, and year grouping are unchanged, while Home News titles, dates, types, images, alt text, hrefs, combined ordering, and six-item limit are also unchanged. The type-level difference is that Journal identity at both News integration points is now explicit `contentId` plus locale, with migration-default public visibility, instead of Astro Store Entry ID. No dependency changes were required.

Verification used Node 24.16.0 and passed 14 focused prototype/boundary tests, including hidden, EN, and locale-error/placeholder-equivalent exclusion plus exact internal-route image resolution with an opaque non-matching Entry ID. Astro check completed with 0 errors, 0 warnings, and the existing 65 hints. Astro build completed successfully with the same 35 pages and 73 generated files. The complete generated file list, full News HTML, and full Home HTML were byte-for-byte identical to the pre-migration build. `git diff --check` passed.

## Post-migration consolidation audit

Audit date: 2026-08-06

### Consolidation result

The four production consumers now consistently use the production boundary, but the repository is not yet ready for an in-place nine-entry data conversion. The remaining prerequisite is a production three-file Loader and its production schema/test seam. The current `journal` collection still uses the legacy `glob("**/*.md")` Loader, and `adaptProductionJournalEntries()` still derives `contentId` from legacy `entry.id` while injecting `locale: ja` and `visibility: public`. This adapter is an intentional bridge, not a valid target-state Loader.

Prototype and production code duplicate three responsibilities:

- Query and Content-ID lookup exist in both `src/prototype/journal/core.ts` and `src/content-boundaries/journal.ts`.
- Route build/parse exists in both files and currently differs on trailing-slash strictness.
- Surface policy exists as one parameterized prototype decision and four production selector functions whose implementations are identical.

The production boundary is the canonical consumer-facing API and should be retained. The prototype repository parser, Issue/Capability evaluation, Entry construction, stale-entry synchronization, Markdown rendering adapter, and fixtures should be promoted into production-oriented Loader modules because those behaviors are not duplicated in production. Prototype copies of Query, Route Registry, and surface selection should then be removed and the prototype tests/harness should import the canonical production boundaries. The four named production selector exports may remain as semantic consumer seams, but should delegate to one private public/renderable selector so their shared policy cannot drift. The isolated `journalPrototype` collection, prototype page, and prototype-only schema should be removed only after the production `journal` collection exercises the same Loader/render path and equivalent tests pass.

### Legacy assumptions still present

The production pages no longer construct Journal routes or references from `entry.id`. The remaining legacy-format assumptions are confined to the migration seam:

1. `src/content.config.ts` declares Journal as flat Markdown loaded by `glob("**/*.md")` and validates shared and localized fields in one frontmatter object.
2. `adaptProductionJournalEntries()` assumes every production entry is JA/public and sets `contentId: entry.id`.
3. All four consumers call that adapter before selection.
4. The production test suite tests the bridge with flat mock entries; it does not run the production collection through a directory Loader.
5. There is no production fixture or migration generator proving that all nine current bodies/frontmatter values survive shared/localized splitting byte-for-byte.

No other Journal consumer under `src/` was found outside Journal Index, Journal Detail, Home Stories, News aggregation, and Home's News image resolver. News continues to store internal Journal references as route strings; this is a deliberate legacy reference adapter, not a dependency on the Markdown storage shape.

### Readiness gate and exact migration order

The data migration may begin only after the following prerequisite slice passes without changing the nine source entries:

1. Extract shared Journal schemas and canonical Query, Site Content, and Route Registry behavior so prototype and production import the same implementation. Fix one trailing-slash contract and test both accepted input forms if route parsing must remain compatible with existing News links.
2. Promote the prototype repository reader and Astro Loader into a production `journal` Loader rooted at `src/content/journal`, retaining full-rescan/set-difference stale deletion, locale-isolated Issues, raw body retention, and opaque Entry IDs.
3. Replace the flat production Journal schema with the Loader output schema. Remove `adaptProductionJournalEntries()` calls only when production entries natively expose `contentId`, `locale`, and `visibility`.
4. Add production-Loader fixtures for valid JA plus placeholder EN, hidden, missing/invalid locale, invalid shared data, delete, rename, and valid-to-invalid transitions. Assert real `render(entry)` compatibility.
5. Add a deterministic migration generator with a dry-run/manifest mode. For each current `{contentId}.md`, it must plan `{contentId}/index.yaml`, `{contentId}/ja.md`, and `{contentId}/en.md` without modifying sources during dry run.
6. Capture the legacy baseline: generated file list, all Journal Index/Detail HTML, Home HTML, News HTML, route list, and a manifest of each source frontmatter/body.
7. Run the generator for all nine entries in one data-only slice. Move `date`, `categories`, `hero`, optional `author`/`credits`, and `visibility: public` to `index.yaml`; move `title`, `summary`, `hero_alt`, and the unchanged body to `ja.md`; generate placeholder-only `en.md` using `__TODO_EN_TITLE__`, `__TODO_EN_SUMMARY__`, `__TODO_EN_HERO_ALT__`, and `__TODO_EN_BODY__`. Do not translate or copy JA prose into EN.
8. Verify, then remove the nine legacy flat files in the same data-migration commit so the repository never has two canonical representations at a commit boundary.
9. After production equivalence is proven, remove the prototype collection/page/schema and duplicated prototype boundary functions; retain Loader fixtures and tests under production-oriented names.

Current source inspection confirms nine flat Markdown entries, all without `author` or `credits`; therefore their shared-field migration is mechanical. Existing Markdown bodies contain raw HTML and image references, so the generator must preserve the body bytes after the closing frontmatter delimiter rather than parse and reserialize the body.

### Rollback and verification

Before conversion, store a deterministic migration manifest containing source path, destination paths, parsed shared/localized values, and a hash of the original body. The rollback artifact should be generated from the untouched legacy files or from a reversible manifest that preserves the complete original file bytes; it must not reconstruct legacy Markdown from normalized YAML. If any validation, build, route, or HTML comparison fails, revert the data-migration commit as a unit. The prerequisite Loader/boundary commit can remain because it is independently tested, but production configuration must not point exclusively at three-file data until that data exists in the same commit or a dual-read transition is explicitly tested.

Acceptance requires focused Loader/boundary tests, `astro check`, `astro build`, formatting and `git diff --check`, exactly the expected JA routes, no EN Journal routes while placeholders are blocking, no hidden/placeholder URLs, identical generated file inventory to the legacy baseline, and byte-for-byte equality for Journal Index, all nine JA Detail pages, Home, and News. Also verify title/date/category/summary/hero/alt/caption/body equality entry by entry, News internal-route image resolution, and stale-store deletion after a temporary delete/rename/invalid transition. HTTP 404 verification remains required when hidden production data is introduced; all nine current entries migrate as public, so it is not a blocker for this data-only conversion.

### Commit breakdown

1. **Prototype contracts and evidence:** decisions/specification updates, prototype Loader/core, fixtures, tests, isolated harness, and only the dependencies required by that prototype. Keep dependency lockfile changes with this commit; do not upgrade unrelated packages.
2. **Production boundary migration:** canonical production Query/Site Content/Route Registry boundary, focused tests, and the four consumer migrations plus News image resolution. This commit keeps the legacy adapter and flat data so rendered output remains unchanged.
3. **Consolidation documentation:** production-migration findings, this audit, confirmed readiness gates, rollback plan, and commit strategy. No runtime or data changes.
4. **Production Loader prerequisite:** promote the unique prototype Loader/parser/Issue behaviors, consolidate duplicated boundary logic, switch the production schema/collection with an explicitly tested transition, add production fixtures and the dry-run migration generator. Do not alter the nine entries in this commit unless configuration and data must be atomic; in that case leave the collection on the legacy Loader until commit 5.
5. **Journal nine-entry data migration:** generated three-file units, removal of legacy flat files, migration manifest, removal of the bridge adapter, and baseline/equivalence evidence. No consumer presentation changes.
6. **Prototype cleanup:** remove the isolated collection/page/schema and obsolete duplicate helpers after the production Loader proves equivalent behavior. Keep reusable fixtures and regression tests under production names.

The next safe implementation step is commit 4's first half: consolidate the canonical boundaries and create/test the production three-file Loader plus a dry-run migration manifest generator, while leaving all nine current Journal files and the active production collection unchanged.

## Production Loader prerequisite implementation

Implementation date: 2026-08-06  
Status: prerequisite code complete; nine-entry data migration not started

The first half of prerequisite commit 4 is now implemented. `src/content-boundaries/journal.ts` is the single canonical implementation for locale query ordering, Content-ID lookup, Route Registry behavior, and Journal surface decisions. The four production selector exports remain named consumer seams but delegate to one parameterized policy. The prototype no longer owns copies of these behaviors; its compatibility modules and diagnostic page import the canonical production boundary and production-oriented Loader modules.

The canonical Route Registry emits the site's existing no-trailing-slash route shape (`/journal/{contentId}` and `/en/journal/{contentId}`) and parses both with and without a trailing slash. This keeps existing internal News links compatible while removing the prototype/production normalization disagreement. Invalid Content IDs and non-Journal paths remain rejected.

The production-oriented three-file Loader now exists under `src/content-loaders/journal/`. It reads `index.yaml + ja.md + en.md`, isolates missing or invalid locale states, evaluates Issues and Capabilities, emits opaque locale entries, renders raw Markdown through Astro's Loader context, and performs full-set Store synchronization. Production fixtures now cover public-valid, hidden, missing EN, placeholder EN, and broken shared YAML states. Tests exercise repository-map and Astro Store deletion after delete, rename, and valid-to-invalid changes. The Markdown body test compares the Loader entry body bytes directly with the bytes after the source closing frontmatter delimiter.

The active production `journal` collection intentionally remains on the legacy flat-Markdown `glob` Loader. The isolated `journalPrototype` collection/page/schema also remain. Switching the active collection before the nine units exist would remove the current production Journal, so equivalence at this stage is proven through the production-oriented fixtures and unchanged production build output rather than an unsafe configuration switch. `adaptProductionJournalEntries()` therefore remains the explicit legacy bridge until the data-only migration.

`npm run journal:migration:manifest` now performs a deterministic dry run over the nine current legacy sources. It plans `index.yaml`, `ja.md`, and placeholder-only `en.md` destinations; records parsed shared/localized fields; injects only the planned `visibility: public`; and preserves rollback evidence as original-file SHA-256, byte length, and complete Base64 bytes plus body SHA-256, byte length, and complete Base64 bytes. It does not write source or destination files. The automated test snapshots all nine source buffers before the run and confirms they are byte-identical afterward.

### Verification and exact readiness

- Focused boundary, Loader, Store synchronization, fixture, and migration-manifest tests: 17 passed, 0 failed.
- Astro check: 0 errors, 0 warnings, 65 existing hints.
- Astro build: successful, 35 pages.
- Production generated-file inventory excluding the diagnostic prototype: byte-for-byte identical to the pre-change build inventory.
- Home, News, Journal Index, and all nine Journal Detail HTML files: byte-for-byte identical to the pre-change build.
- Current legacy Journal source count: exactly nine flat Markdown files; none changed or migrated.
- `git diff --check`: passed.
- Dependencies and unrelated code: unchanged by this prerequisite slice.

The repository is now ready for a separately reviewable data-only migration slice, but production-Loader equivalence is not yet complete because the active collection has not consumed the real three-file units. The next safe step is to review and persist the dry-run manifest as migration evidence, capture hashes for the nine complete legacy source files, then run the generator in an explicitly implemented write mode that creates all nine three-file units and removes the nine legacy files atomically. In that same slice, switch the production collection/schema to `journalThreeFileLoader`, remove `adaptProductionJournalEntries()` from the four consumers, and rerun the full route/HTML/body equivalence suite. Keep the prototype collection/page until that active-production equivalence passes; remove it only in the subsequent cleanup slice.

## Nine-entry data-only migration result

Implementation date: 2026-08-06  
Status: complete; active production equivalence proven

The reviewed dry-run output was frozen before any source write as `docs/architecture/journal-migration-manifest-2026-08-06.json` (SHA-256 `6e295f5c1ad0971d5e2914924cc308dc6e83562228ed5b7b043c244c76effaf5`). It records all nine original paths, all 27 destinations, parsed shared and localized values, original-file and body byte lengths and SHA-256 values, and complete Base64 bytes for both the original files and bodies. The write path refuses to proceed unless all nine current source buffers match that evidence.

All nine flat Markdown files were replaced in one migration run by nine canonical directories containing `index.yaml`, `ja.md`, and `en.md`. Content IDs and routes are unchanged. Every shared and localized frontmatter value was carried to its specified file; only the specified migration default `visibility: public` was introduced. The bytes following each legacy closing frontmatter delimiter are exactly the bytes following the new JA closing delimiter. Each EN file contains only `__TODO_EN_TITLE__`, `__TODO_EN_SUMMARY__`, `__TODO_EN_HERO_ALT__`, and `__TODO_EN_BODY__`; no JA prose was copied or translated.

The production `journal` collection now uses `journalThreeFileLoader` and the canonical schema. All four consumers use native `contentId`, `locale`, and `visibility`. `adaptProductionJournalEntries()`, its legacy mock test, the flat Journal `glob` configuration, and the obsolete flat Journal schema were removed. The prototype collection, page, schema, and diagnostic assets remain intentionally unchanged and in scope for the next cleanup slice only.

### Verification and rollback proof

- Focused boundary, Loader, Store synchronization, fixture, consumer, and migration tests: 17 passed, 0 failed.
- Real repository load: nine units, 18 locale entries, zero JA errors. The 36 EN errors are the expected four reserved-placeholder Issues per unit and prevent EN publication.
- Stale Store behavior: delete, rename, and valid-to-invalid transitions passed at both repository and Astro Store seams.
- Astro check: 0 errors, 0 warnings, 62 existing hints. The reduction from the 65-hint baseline follows removal of the obsolete schema; no diagnostic was suppressed.
- Astro build: successful, 35 pages.
- Production route/generated-file inventory: identical to the pre-migration baseline; no EN Journal route was generated.
- Home, News, Journal Index, and all nine Journal Detail HTML files: byte-for-byte identical to the pre-migration baseline.
- Source inventory: exactly nine Content Unit directories and 27 canonical files; zero legacy flat Journal Markdown files.
- Rollback: the automated migration test materializes all nine originals from the frozen Base64 evidence, reruns the complete migration in a temporary repository, proves every JA body byte sequence, and reconstructs all nine original buffers exactly. Rollback never depends on normalized YAML serialization.
- `git diff --check`: passed.
- Dependencies: no upgrade or migration-slice dependency change.

There were no migration-contract deviations. The first local verification attempt used the machine default Node 20 and stopped before executing tests because that runtime does not support the configured TypeScript stripping flag; all reported verification used the already-installed compatible Node 22.22.1 runtime.

Active-production equivalence is now proven, so prototype cleanup is safe as a separate next slice. It must remain separately reviewable and retain the production Loader fixtures and regression coverage.

## Cleanup and Architecture Finalization result

Implementation date: 2026-08-07
Status: complete

The cleanup and structural finalization described as future work in the earlier sections are complete:

- the `journalPrototype` collection, `/prototype/journal/` page, prototype-only schema, and `src/prototype/journal/` code are removed;
- `npm run prototype:test` is replaced by `npm run journal:test`;
- the canonical schema is `src/content-loaders/journal/schema.ts` and is shared by the production collection, repository, and Entry adapter;
- repository code is limited to source IO, parsing, normalization, and `LoadedJournalUnit` construction, with no Boundary dependency or re-export;
- Capability evaluation, Entry adaptation, read-model construction, Production composition, surface policy, and routing have distinct owners in the dependency direction recorded by the current specification;
- repository and Astro adapter Issues reach the Production facade through `JournalReadModel.issuesByContentId`; absent ownership fails fast instead of becoming an empty Issue set;
- known `parseData` and Markdown content failures use `content.adapter.parse-data` and `content.adapter.markdown-render`; unexpected adapter failures stop the build;
- Journal Index, Detail, Home Stories, and News integration all use `getJournalProductionFacade()`, and Journal route build/parse uses `journalRouteRegistry`.

Final Architecture Finalization verification uses Node.js v22.22.1. The focused suite has 21 tests, the build produces 34 pages and 72 production files, and the accepted baseline/current SHA-256 manifests contain the same 72 relative paths and hashes. Full byte comparison is therefore identical. See [Journal Architecture — Current](./journal-architecture-current.md) for the maintained contract; preceding migration stages remain historical evidence rather than current instructions.
