# Journal Architecture — Current Specification

| Property      | Value                                                    |
| ------------- | -------------------------------------------------------- |
| Status        | Implemented / current authority                          |
| Last reviewed | 2026-08-07                                               |
| Scope         | Journal production read architecture and local Editor v1 |

This document is the current authority for the implemented Journal read path. The dated prototype, gate, and migration documents remain historical records; where they describe a future migration or a separate `journalPrototype` collection, this document supersedes them.

## Implemented architecture

```text
filesystem
  -> repository (source parse, normalization, LoadedJournalUnit + Issues)
       -> Capability evaluator
       -> Entry adapter -> Astro Content Loader / Store
  -> Astro entries + repository/adapter Issues
       -> Journal read-model service
       -> Production facade and surface policy
       -> Journal Index / Detail / Home Stories / News integration

filesystem -> Editor read state -> Draft -> Draft validation
  -> locale Preview model -> expiring token store -> dev-only Preview route
  -> Serializer -> baseline-checked three-file Save -> canonical reread
  -> baseline-checked Git inspection -> three-file Commit -> Push
```

- `src/content-loaders/journal/repository.ts` owns filesystem reads, YAML/Markdown source parsing, normalization, and `LoadedJournalUnit` construction. It has no dependency on content boundaries.
- `src/content-loaders/journal/schema.ts` is the canonical structural-schema module. `src/content.config.ts`, repository parsing, and the Entry adapter share it; schema definitions are not duplicated by consumers.
- `src/content-loaders/journal/capabilities.ts` derives Save, locale Preview, and Publish capability from Issues. Issue producers record facts and do not encode blocked actions.
- `src/content-loaders/journal/entry-adapter.ts` converts valid repository units to canonical Astro entries and performs final `journalSchema` validation.
- `src/content-loaders/journal/astro-loader.ts` synchronizes the Astro Store and owns adapter-stage failure classification.
- `src/content-services/journal-read-model.ts` joins Astro entries with repository and adapter Issues without mutating repository data. An adapter Issue without a repository owner fails fast.
- `src/content-boundaries/journal.ts` owns locale query, renderability, the four public-surface policies, the Production facade, and the Content-ID Route Registry.
- `src/content-boundaries/journal-production.ts` is the composition root. It obtains the Astro collection, repository units, and adapter Issues, creates the read model, and returns the Production facade.

Production pages do not read the Journal collection directly. Journal Index, Detail, Home Stories, and News integration all use `getJournalProductionFacade()`. Journal route creation and known Journal route parsing use `journalRouteRegistry`; public identity is `contentId` plus locale, never Astro `entry.id`.

The Editor imports the repository, canonical schemas, Issue contracts, and shared Capability evaluator directly. It does not import the Production facade, production read-model service, Astro collection adapter, or production consumers. Production modules do not import Editor modules. This dependency direction keeps editing and mutation outside the Production read boundary.

## Local Editor v1

The Editor shell is statically generated under `/editor/`, with Journal collection and workspace pages. It reads canonical three-file units directly through the repository and creates a deep-cloned Draft. Draft validation reuses the canonical schemas and Capability evaluator; Issue facts remain distinct from Save, locale Preview, and Publish decisions.

The Serializer is the only Draft-to-source conversion boundary. For every currently canonical Journal unit, unchanged read → Draft → serialize output is byte-for-byte identical across all three files.

Save is a local mutation boundary with these invariants:

- the request carries both the edited Draft and its saved baseline;
- the server rereads canonical state and rejects a stale baseline;
- canonical raw bytes are checked again while replacements are prepared;
- Content ID traversal, symlinked entry directories, symlinked sources, and non-regular sources are rejected;
- all three files are staged, backed up, and replaced as one operation, with rollback of completed replacements on failure;
- success returns a fresh canonical reread, which becomes the next UI baseline;
- Save follows the shared Save capability, so content-quality Issues may be saved while Publish remains blocked.

Preview is created only from the unsaved Draft and one explicit locale. It has no cross-locale fallback and does not mutate canonical files. Preview records use random UUID tokens, a ten-minute TTL, locale matching, clone-on-write/read, lazy deletion on expired reads, and expired-record sweeping when new records are created.

Publish requires a clean Draft, Publish capability, and equality with a fresh canonical reread. Repository inspection rejects detached HEAD, missing or branch-mismatched upstream, a repository-root mismatch, pre-existing staged changes, invalid/non-regular canonical sources, and an empty target diff. Only the canonical three-file paths are staged. The staged blobs are byte-compared with the canonical snapshot taken after baseline validation before commit. Commit messages use `Publish journal: <contentId>`. A successful commit followed by a failed push returns `committed-push-failed`, preserving the commit and distinguishing it from pre-commit failure.

Save, Preview, and Publish failures cross the API boundary with stable codes and messages. The workspace displays the returned message; codes remain available for future recovery-specific UI without reclassifying failures in the client.

## Development-only route boundary

`astro.config.mjs` injects mutation and Preview routes only when Astro's command is `dev`:

| Surface        | Development route                          |
| -------------- | ------------------------------------------ |
| Save           | `/editor/api/journal/[contentId]`          |
| Preview create | `/editor/api/journal-preview/create`       |
| Preview render | `/editor/preview/journal/[token]/[locale]` |
| Publish        | `/editor/api/journal-publish/[contentId]`  |

These routes are not injected by `astro build`. The static Editor shell and workspaces may exist in local build output, but no mutation, token creation/rendering, or Git Publish endpoint is present in Production output.

## Canonical Content Unit and schema

A Journal Content Unit is a directory whose name is its lowercase, hyphenated Content ID and whose canonical files are:

```text
{contentId}/
  index.yaml
  ja.md
  en.md
```

Shared data comes from `index.yaml`; localized frontmatter and raw body come from the locale Markdown file. A missing or invalid locale does not discard a valid sibling locale. Canonical entry data includes explicit `contentId`, `locale`, and `visibility` while retaining the production presentation fields.

## Issue transport and adapter failures

The implemented Issue path is:

```text
repository / Astro adapter
  -> LoadedJournalUnit.issues / root-scoped adapter Issue registry
  -> JournalReadModel.issuesByContentId
  -> Production facade
  -> surface selection
```

Every repository Content ID receives an Issue array, including an empty one. Missing ownership is not interpreted as “no Issues”: the read-model service rejects adapter Issues without an owner, and the Production selector rejects an Entry without an Issue-map entry.

Known content-correctable Astro adapter failures are recorded as locale-specific, render-blocking `adapter` Issues and exclude only the affected locale Entry:

| Stage           | Recognized failure                                      | Rule ID                           | Result                       |
| --------------- | ------------------------------------------------------- | --------------------------------- | ---------------------------- |
| `parseData`     | `InvalidContentEntryDataError`                          | `content.adapter.parse-data`      | Record Issue; continue build |
| Markdown render | Astro `MarkdownError` / `MarkdownFrontmatterParseError` | `content.adapter.markdown-render` | Record Issue; continue build |

Other adapter exceptions are wrapped as `JournalAdapterFailure`, retaining Content ID, locale, stage, and cause, and fail the build. Digest generation and Store writes also fail the build rather than being reclassified as content failures.

## Surface policy

All four production surfaces require the requested locale, `visibility: public`, and no applicable error Issue. Hidden or locale-blocked entries are omitted from static Detail paths and from Index, Home Stories, and News integration. The facade is the single production selection boundary; consumers retain presentation-only mapping, grouping, and limits.

## Prototype cleanup and verification baseline

The isolated `journalPrototype` collection, `/prototype/journal/` diagnostic page, and `src/prototype/journal/` implementation have been removed. The supported focused command is `npm run journal:test`; `npm run prototype:test` no longer exists.

Architecture Finalization verification uses Node.js v22.22.1 and requires:

```text
npm run journal:test
npm run editor:test
npm run check
npm run build
npx prettier --check <changed Editor and Journal files>
git diff --check
```

The accepted production-equivalence baseline is 72 generated files. The final build must match the saved baseline file list and every file byte-for-byte, with identical SHA-256 manifests.

## Historical records

- `decisions-029-031-prototype-contracts.md` records the approved Issue/Capability, visibility, route, and prototype gate decisions. Those decisions are implemented; its prototype scope is closed.
- `cross-architecture-review-2026-08-06.md` records the pre-prototype gate and baseline observations. Statements about unmigrated consumers are superseded.
- `journal-read-only-prototype-findings-2026-08-06.md` records prototype evidence and the completed migration/finalization outcome.
- `loader-architecture-specification-v1.0.md` remains the detailed target contract. Prototype-dependent implementation questions resolved by the current code are governed by this document.

Editor v1 covers editing existing valid canonical Journal units. Creating, deleting, renaming, or moving Content Units; bulk Repository Index operations; collaborative locking; authentication; and production-hosted mutation remain outside scope.

Collection-level reuse and the gate for the first Works Editor slice are governed by [Collection Framework Audit](./collection-framework-audit-2026-08-07.md). Journal's three-file shape, schemas, routes, serializer, production facade, and render model remain Journal-owned; shared extraction requires a second concrete consumer and must preserve this specification's production-equivalence baseline.
