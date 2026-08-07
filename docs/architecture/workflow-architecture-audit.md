# KiKi Gallery Editor Workflow Architecture Audit

> Journal read-path status (2026-08-07): statements in this audit that the Journal prototype gate, strict schema, or Production consumer migration remain pending are historical. Those read-only requirements are implemented and superseded by [Journal Architecture — Current](./journal-architecture-current.md). Editor mutation workflows audited here remain unimplemented and in scope for the next phase.

Version: v1.0  
Status: Pre-implementation audit  
Last Updated: 2026-08-06  
Scope: Editor workflow and Git publication boundary; no application implementation

---

## 1. Audit basis

This audit compares the agreed Editor workflows with:

- the current repository at `3a10a87` (`main`, clean and aligned with `origin/main` at audit start);
- Astro `6.0.4` and the official Content Loader / Content Collection contracts;
- Git index, working-tree, commit, and push semantics;
- Content Model Specification v1.0;
- Loader Architecture Specification v1.0;
- the current Journal, News, Home, and route consumers.

The current site remains a legacy single-Markdown implementation. The three-file Content Unit, custom Loader, Query Adapter, Site Content Service, visibility rules, and Editor write path are target architecture and do not yet exist. Using a compatible Node `24.14.0` runtime, `astro check` completed with 0 errors and `astro build` generated 34 pages successfully. Existing deprecation and inline-script diagnostics are unrelated hints, not workflow blockers.

Official contracts used by this audit:

- Astro custom loaders receive a store, watcher, `parseData()`, and digest helpers; loaders are responsible for synchronizing stored entries: <https://docs.astro.build/en/reference/content-loader-reference/>
- Astro content entries expose an opaque `id`, schema-derived `data`, raw Markdown body, and `render()` support: <https://docs.astro.build/en/guides/content-collections/>
- Git status distinguishes index changes, working-tree changes, untracked paths, conflicts, and branch state; porcelain v2 with NUL delimiters is the machine boundary: <https://git-scm.com/docs/git-status.html>
- `git add` copies the selected path content into the index at that moment; a normal `git commit` commits everything already staged: <https://git-scm.com/docs/git-add.html>
- push success, rejection, failure, and already-up-to-date are distinct results: <https://git-scm.com/docs/git-push.html>

---

## 2. Confirmed decisions

### New Content and Editor State

- A new Content Unit exists only in Editor State until its first Save. Cancel before first Save leaves no repository files.
- First Save creates `index.yaml`, `ja.md`, and `en.md` as one logical operation; unresolved EN placeholder tokens may be saved but block EN Preview and Publish as defined by Loader Decision 012.
- Editor State is a working copy, not repository truth. Every write requires a conflict token derived from the source files and a fresh precondition check.
- Save writes repository content but does not stage, commit, or push it.

### Rename

- Content ID is read-only during ordinary editing. Identity changes use a separate previewed Rename workflow.
- Rename covers the Content Unit directory, resolvable explicit references, and only assets proven to be exclusively owned by the unit.
- The operation must display the public route change and invalidate the Loader/Astro store through the full-rescan behavior already required by Loader Decision 009.
- The filesystem move need not be performed with `git mv`; Git records snapshots and may later infer a rename by similarity. Rename detection is presentation, not correctness.

### Visibility and safe removal

- `public` and `hidden` are content data, not Git or Editor status.
- Hide preserves the Content Unit, Content ID, assets, and existing references. It is the normal removal path; Delete is exceptional.
- Visibility filtering belongs above Query Adapter in Site Content Service. Loader and repository validation must continue to see hidden content.
- Collection/surface-specific behavior remains required: index, Home, search, new-reference choices, and detail routes cannot be assumed to share one filter.

### Delete

- Delete is allowed only after a repository-wide incoming-reference and asset-ownership check.
- Any unresolved explicit incoming reference blocks Delete. The initial Editor does not implement force-delete or cascading deletion; use Hide or an external maintenance workflow.
- Delete writes removals to the working tree but does not commit them. It must show the exact Content Unit, exclusively owned assets, and affected route before application.

### Publish

- Publish has separate Validate, Review, Verify, Commit, and Push phases.
- The Review file set is recomputed from current repository and Git state. No stale Editor change list is authoritative.
- `astro check` and `astro build` are repository-wide verification gates. Their scope is broader than the eventual commit, so unrelated working-tree code can legitimately block publication even when it will not be committed.
- Publish never uses `git add .`. Untracked files, deletions, and both index/worktree columns must be represented explicitly.
- News known-internal links are explicit references for integrity purposes. External URLs and unrelated internal paths are links, not Content References.

---

## 3. Issues requiring revision before implementation

### R1 — Filename prefix does not prove image ownership (blocker)

The proposed rule “image filename starts with Content ID, therefore the Content Unit owns it” is unsafe in the current repository. For example, images prefixed `interview-keisuke-matsuda-2026-02-` are referenced by several other Journal entries. Renaming or deleting them with the nominal owner would break those entries.

Required revision:

1. Build a repository-wide asset reference index from structured image fields and Markdown image nodes.
2. Treat a matching prefix only as an ownership candidate.
3. Auto-rename/delete an asset only when it is inside an allowed asset root, has no reference outside the operation set, and has no symlink/path escape.
4. Shared or ambiguous assets remain unchanged and are shown in the preview.

An explicit asset manifest may be added later, but it is not required for v1 if exclusive-reference proof is reliable.

### R2 — A normal commit can include unrelated pre-staged changes (blocker)

Staging only Editor-owned paths does not isolate a commit when another tool or VS Code has already staged unrelated paths: normal `git commit` commits the entire index.

Required v1 policy:

- Parse `git status --porcelain=v2 -z --branch`.
- If the index contains any pre-existing staged change, block Publish and ask the operator to commit or unstage it outside the Editor.
- After this clean-index precondition, stage only the reviewed path set and verify the cached diff exactly matches that set before commit.

A temporary isolated index can remove this restriction, but it is prototype-only because partial staging, hooks, filters, submodules, and failure cleanup expand the contract considerably.

### R3 — Multi-file writes lack a defined rollback contract (blocker)

New Save, Rename, reference rewrite, and Delete are logical transactions but the filesystem and Git working tree do not provide an automatic transaction. “Undo in Editor State” cannot restore files already written or deleted.

Required revision:

- Resolve and validate the complete operation plan before the first mutation.
- Capture a preimage and conflict token for every existing target; prove every destination is absent where required.
- Write new file content to sibling temporary files, flush/close, then apply deterministic renames.
- Keep an operation journal sufficient to reverse completed steps if a later step fails.
- If rollback itself fails or any path changes externally, stop and report manual recovery paths; never overwrite the newer external content.
- Delete should first move files to an Editor recovery area on the same filesystem, then finalize only after the operation succeeds. Recovery-area retention is an implementation policy, not Git history.

### R4 — Publish review can become stale (blocker)

VS Code can save, stage, commit, switch branch, or move `HEAD` between Review and Commit. A single status read immediately before opening Review is insufficient.

Required revision:

- Capture repository root, branch/detached state, `HEAD`, upstream identity, index tree, reviewed path states, and per-file content tokens.
- Recheck them before verification, before staging, and immediately before commit.
- Any mismatch invalidates the review and returns to Review; it is not silently merged.
- Unmerged paths, an in-progress merge/rebase/cherry-pick, detached `HEAD`, missing upstream, or a changed repository root are Publish blockers in v1.

### R5 — Commit-success / push-failure retry needs durable identity (blocker)

“Retry push only” is correct only if the Editor can prove which commit it created. A boolean flag is insufficient after restart or after an external commit.

Required revision:

- After commit, persist the created commit OID, its parent OID, branch, upstream, and reviewed operation ID.
- On retry, push only when that commit is still an ancestor of the current branch tip and no repository operation is in progress.
- If `HEAD` advanced externally, do not create a duplicate commit. Recompute ahead/behind state and offer push of the current branch only after a new confirmation.
- Push rejection is not rollback: the local commit remains. Authentication/network failures may retry; non-fast-forward rejection requires fetch/review outside automatic retry.
- Success means the intended upstream contains the committed OID, not merely that the working tree is clean.

### R6 — “Nothing to publish” does not mean “already published” (high)

An external VS Code commit can make the target paths clean while leaving the branch ahead of upstream. Conversely, the files may have been committed into a different branch or commit.

Required revision:

- Distinguish `no working-tree changes`, `local commits pending push`, `up to date`, and `cannot determine upstream`.
- Do not claim publication from path cleanliness alone.
- If Editor State is dirty while repository paths are clean or `HEAD` changed, reload/compare and require conflict resolution.

### R7 — Rename reference rewriting must be typed and bounded (high)

The current News model stores a generic `link` string, while Home parses selected routes and maps them by current `entry.id`. Blind string replacement across Markdown/YAML can change prose, external URLs, or unrelated IDs.

Required revision:

- Rewrite structured collection references and exact, normalized known-internal News routes.
- Parse Markdown links/images structurally; do not global-search-and-replace raw text.
- Show every incoming reference in the Rename preview and validate the old ID has no remaining explicit reference before completing.
- Preserve a compatibility Route Parser only during migration, consistent with Loader Decisions 011 and the deferred Content Reference migration.

### R8 — Visibility is agreed but absent from the canonical model and all consumers (high)

The current strict schemas reject `visibility`; every list and `getStaticPaths()` currently renders all entries. Adding only a field would not implement Hide.

Required revision:

- Add the common Shared field and default/migration rule to the Content Model only together with Schema, migration, Site Content Service, reference chooser, and consumer behavior.
- Define per-collection detail behavior before implementation: no route, unavailable view, or archived view.
- Existing references to hidden content remain valid; attempts to create new references may be blocked by Editor capability policy, not Structural Schema.

This cross-layer change should be its own implementation slice. Scheduled publication remains deferred because static Astro output also needs a timed rebuild/deploy mechanism.

Decision 030 now supplies the required common and Journal surface matrices and keeps crawler surfaces as future extension points only. R8 remains an implementation gate because the strict Schema, migration, Site Content Service, and current consumers are still unchanged; documentation approval does not implement Hide.

### R9 — News reference validation must match actual semantics (high)

News is the only current collection whose optional generic link can become an explicit content dependency. The existing implementation throws for a broken known link only while resolving a Home image, so a broken known link with `show_on_home: false` can escape that path.

Required revision:

- Validate every News link matching a known content route, independent of `show_on_home`.
- Require the target Content ID and relevant locale entry to exist; define hidden-target publication policy separately from existence.
- Keep external HTTP(S) URLs and unknown/general internal paths outside the content dependency graph.
- Do not build a generic dependency-graph product in v1. A repository reference index supporting validation, Rename, and Delete is sufficient.

---

## 4. Prototype-only items

The following must be proven before their contracts are fixed:

- Astro Entry ID encoding, Markdown `render(entry)` compatibility, watcher teardown/hot reload, digest inputs, and stale-entry deletion strategy, as already deferred by Loader v1.0.
- An isolated temporary Git index for publishing while unrelated staged changes exist.
- Cross-platform atomicity and rollback behavior for directory rename plus asset moves.
- Markdown link/image parsing and formatting preservation during exact reference rewrites.
- Hidden detail behavior per collection and its interaction with static `getStaticPaths()`.
- Redirect generation for published Content ID renames. Redirects are useful but are not required to correct repository identity.

---

## 5. Recommended document updates

### Adopt now

1. Treat this audit as the workflow implementation gate.
2. Add a File Writer Specification defining conflict tokens, atomic batch writes, operation journals, rollback, recovery area, path/symlink safety, and external-change behavior.
3. Add a Git Publisher Specification defining porcelain-v2 parsing, clean-index v1 policy, review snapshots, exact path staging, commit identity, upstream checks, and push retry states.
4. Amend Rename/Delete wording wherever “Content ID prefix means owned image” appears: prefix is only a candidate; exclusive repository-reference proof is mandatory.
5. Define the repository reference index as shared infrastructure for integrity validation, Rename preview/rewrite, and Delete blocking, without promoting it to a generic graph framework.

### Update with the visibility implementation slice

6. Amend the Content Model with `visibility: public | hidden`, its migration default, and explicit separation from `publish_at`.
7. Add a collection/surface matrix for index, Home, search, detail, related content, existing references, and new-reference choices.

### Keep deferred

8. Scheduled rebuild/deploy, force-delete, cascading publication, generic dependency graphs, duplicate/fork workflows, isolated-index publishing, and automatic redirect management remain outside v1 until operational evidence justifies them.

---

## 6. Implementation gate

Editor implementation may begin after R1–R5 have explicit specifications and acceptance tests. R6–R9 must be resolved before enabling the affected Publish, Rename, Hide, or News operations. Loader prototype items remain governed by Loader Architecture Specification v1.0 and do not justify bypassing these workflow gates.
