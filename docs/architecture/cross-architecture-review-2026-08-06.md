# KiKi Gallery Cross-Architecture Review

> Status: Historical pre-implementation review — gate satisfied and superseded for current-state claims. Production Journal consumers have migrated to the Production facade and prototype cleanup is complete. See [Journal Architecture — Current](./journal-architecture-current.md).

Version: v1.0  
Status: Prototype gate  
Reviewed: 2026-08-06  
Scope: Content Model, Loader, Validation / Issue / Capability, Editor UI, Workflow, File Writer, Repository Index, Git Publisher, Visibility / Removal, Routing, Migration, and current Astro 6 consumers

---

## 1. Outcome

The architecture is suitable for a **narrow Journal prototype**, but not yet for implementation of the complete Editor or all-collection migration.

The core direction is sound: repository files remain canonical; the Loader reads without deciding publication; validation reports facts and policy failures; capabilities decide whether an action is available; Site Content Service decides what public consumers may render; File Writer owns filesystem mutation; Git Publisher owns Git publication.

The four prototype-entry contracts are now explicit in `decisions-029-031-prototype-contracts.md`:

1. one authoritative renderability / visibility policy;
2. one typed Issue-to-Capability contract;
3. one route and content-reference contract based on Content ID rather than Astro `entry.id`;
4. a deliberately narrow prototype scope, initially Journal, rather than an implied simultaneous conversion of every collection.

No application code was changed by this review or the contract update. The narrow Journal read-only prototype gate is open; the complete Editor and mutating workflows remain gated.

---

## 2. Authoritative responsibility map

| Concern | Sole decision owner | Inputs / outputs only |
| --- | --- | --- |
| Repository parsing and partial recovery | Content Unit Loader | Returns parsed parts, raw source, structural Issues, and completeness |
| Cross-unit facts | Repository Index | Records content, explicit references, assets, routes, and completeness; does not decide policy |
| Structural and integrity findings | Validators | Produce typed Issues; do not mutate or decide UI state |
| Save / Preview / Publish availability | Capability evaluator | Reduces Issues plus operation context to allowed / blocked actions and reasons |
| Public inclusion and hidden-detail behavior | Site Content Service | Applies the collection/surface policy to Query Adapter results |
| URL generation and parsing | Route Registry / Helper | Maps locale + collection + Content ID; `entry.id` remains opaque |
| Save, Rename, and Delete mutation | File Writer | Applies a prevalidated operation plan with conflict checks and recovery |
| Stage, commit, push, and retry | Git Publisher | Accepts a reviewed path set and repository snapshot; does not infer content scope |
| Workflow sequencing | Editor application service | Coordinates the owners above; does not duplicate their rules |
| Presentation | Editor UI and Astro consumers | Display returned state; do not rediscover validation or visibility policy |

This map resolves the main overlap: the Repository Index supplies facts, Validators interpret facts, Capability evaluates operations, and Site Content Service evaluates public rendering. None of those layers should independently reimplement another layer's rule.

---

## 3. Findings

### Must resolve before prototype

#### CR-01 — Renderability currently has multiple potential owners (resolved for prototype)

Loader Decision 008 assigns renderability above Query Adapter, the workflow gives Publish gating to validation/capability, and current Astro pages call `getCollection()` directly. Without a single contract, a manually committed placeholder or hidden entry can bypass Editor Publish checks and still be routed.

**Resolved by Decision 030:** Site Content Service owns the surface decision. The minimal policy result remains:

```ts
type Surface = "index" | "detail" | "home" | "related" | "search";

type RenderDecision =
  | { renderable: true }
  | { renderable: false; reason: "hidden" | "locale-incomplete" | "invalid" };
```

All production list queries and `getStaticPaths()` must consume that boundary. Capability may use the same Issues, but must not become the site's rendering service.

#### CR-02 — Issue and Capability interfaces are not specified (resolved)

The design distinguishes structural errors, quality warnings, repository errors, conflicts, and fatal infrastructure errors, but the shared Issue identity, source location, affected locale/content, and blocked actions remain undefined. UI, Preview, Publish, Rename, and Delete therefore cannot consume results consistently.

**Resolved by Decision 029:** the typed Issue contract contains facts and location only. A pure, locale-aware Capability reduction owns operation blocking; it is not inferred from severity and is not stored on the Issue.

```ts
See the canonical contract for `ContentIssue`, `CapabilityResult`, and `ContentCapabilities`.
```

Exact localization and source ranges are implementation details.

#### CR-03 — Three-file Content Unit scope contradicts the current model (high)

The Content Model overview presents `index.yaml` + `ja.md` + `en.md` as the general repository shape, while Work explicitly says its current single-file representation would only be split in a future Publication Unit. Home also does not naturally require two localized Markdown bodies. The Loader specification reads as universal, while its audited implementation target is effectively Journal-first.

**Resolution:** the prototype is Journal-only. Treat the three-file format as a target for collections whose shared/localized split benefits from it; do not migrate Work, Home, or every collection to prove the Loader. Decide each collection's storage adapter only after the Journal prototype. This is a scope clarification, not a new abstraction.

#### CR-04 — Route and reference resolution need one registry contract (resolved)

The target correctly makes `entry.id` opaque and uses Content ID, but current consumers build routes from `entry.id`; News parses raw paths with a local regex; Repository Index also proposes route parsing. Independent parsers will drift, particularly for locale routes and rename.

**Resolved by Decision 031:** one Route Registry provides `build()` and exact `parse()` from locale + collection + Content ID. Collision enumeration uses the same registry. Site consumers, News validation, Repository Index, and Rename Planner use it. Unknown internal paths remain links, not content references.

#### CR-05 — Infrastructure decisions exist only across audit/conversation records (high)

File Writer, Repository Index, and Git Publisher have clear decisions, but only the workflow audit is in the repository. Their input/output and failure-state contracts are not canonical documents, so R1–R5 are not yet satisfied as an implementation gate.

**Resolution:** before implementing any mutating prototype, record three short specifications or one consolidated infrastructure contract covering operation plans, index completeness, reviewed Git snapshots, rollback/recovery, and durable commit identity. A read-only Loader/UI prototype may proceed first.

### Prototype validation items

#### CR-06 — Partial indexing must fail closed for destructive operations (high)

Partial Loader results are valuable for repair, but Rename/Delete cannot be safe when Markdown, a locale file, or a repository area was not analyzable. Confirm that Repository Index reports coverage, not merely `complete | partial`, and that Rename/Delete block whenever relevant coverage is incomplete.

#### CR-07 — File transaction guarantees are platform-dependent (high)

Sibling temporary writes help individual-file replacement, but a directory rename, asset moves, and reference rewrites are not one atomic filesystem transaction. Prototype deterministic operation journals, external-change checks, rollback, and recovery-area behavior. Do not promise atomicity across the whole batch.

#### CR-08 — Astro synchronization assumptions require proof (medium)

Prototype Entry ID encoding, `render(entry)`, watcher lifecycle, full rescan, stale-entry deletion, and digest behavior against Astro 6. The target contract is reasonable, but these are framework integration facts rather than architecture decisions.

#### CR-09 — Markdown rewriting should be proven before Rename supports it (medium)

Structural Markdown parsing can find links and images, but formatting-preserving exact rewrites may be lossy. The first Rename prototype may update typed YAML references and exact News routes while reporting Markdown references without rewriting them.

#### CR-10 — Visibility behavior needs a surface matrix (resolved for Journal prototype)

Decision 030 fixes the common matrix and Journal Index, Detail, Home Stories, News aggregation, Editor, reference, Repository Index, and Validation behavior. It deliberately does not apply Journal detail behavior to every collection. Add the strict-schema field only in the same implementation slice as service and consumer support. Crawler surfaces are future extension points, not approved implementations.

### Implementation details

#### CR-11 — Current consumers duplicate query and presentation policy (medium)

Home, Journal, News, Artist, Exhibition, and Work pages independently sort, resolve references, and build URLs from `entry.id`. During migration, move these decisions behind Query Adapter + Site Content Service incrementally. Do not create a generic repository or graph API for ordinary page rendering.

#### CR-12 — Repository Index can remain an ephemeral projection (low)

The current repository is small. Full rescan after startup and mutations is adequate. Persisted indexes, incremental invalidation, graph databases, and cache coherence are unnecessary until measurement proves otherwise.

#### CR-13 — Validation enforcement outside the Editor is still required (medium)

Editor Publish cannot protect manual commits. Repository-wide validation and production build must apply the same renderability and integrity rules. The exact CI provider and command packaging are implementation choices, but the enforcement boundary is architectural.

#### CR-14 — Date/time policy should be explicit where it affects visibility (low)

Current consumers mix coerced `Date`, local date construction, and string parsing. Scheduled publication is deferred, but any future time-based visibility needs an explicit timezone and build-time clock. Do not add `publish_at` in v1.

### Intentional deferrals / YAGNI

The following remain outside v1 unless prototype evidence requires them:

- scheduled publication and scheduled deploys;
- generic dependency-graph infrastructure;
- force/cascade delete and cascading publish;
- isolated temporary Git index and arbitrary branch workflows;
- automatic redirects after Content ID rename;
- persistent or incremental Repository Index;
- automatic merge/conflict resolution;
- plugin architecture, arbitrary locale count, and CMS-specific adapters.

The Editor UI should initially expose form state, Issues, capabilities, repository status, and review summaries. A general Git client, repository explorer, workflow engine, and configurable policy builder would be overengineering.

---

## 4. Contradictions resolved by this review

| Apparent contradiction | Review conclusion |
| --- | --- |
| Loader reports structural validity while Validation owns validation | Loader may invoke shared Structural Schema and report structural Issues; policy, quality, repository integrity, and operation capability remain outside Loader. |
| Repository Index provides “validation data” and appears to validate | Index records facts and completeness only. Validators create Issues from those facts. |
| Capability and Site Content Service both decide availability | Capability decides Editor actions. Site Content Service decides public-surface rendering. They may consume the same Issues and visibility policy. |
| Content Model says three files while current Work remains one file | Three-file migration is collection-specific; Journal is the prototype. |
| Save allows incomplete EN while Build must reject invalid content | Reserved placeholders are structurally valid but non-renderable. Site rendering and repository-wide build validation prevent exposure even after manual commit. |
| Hidden content remains reference-valid but is unavailable publicly | Existence/integrity and public renderability are separate decisions. Existing references may resolve while surfaces suppress or replace the target view. |

---

## 5. Future CMS migration assessment — low severity

The design preserves a generally smooth migration path without needing CMS-driven changes now.

Helpful properties:

- stable Content IDs separate from Astro's storage key;
- explicit Shared / Localized / Derived classification;
- typed references and strict schemas;
- repository format isolated behind Loader and File Writer;
- presentation isolated behind Query Adapter and Site Content Service;
- Markdown retained as content rather than rendered HTML;
- visibility and operation rules separated from structural storage.

Likely migration work remains: mapping repository directories to external records, converting Markdown/assets, selecting locale representation, replacing Git publication, and converting generic News routes into typed references. These are normal adapter/migration tasks.

Do **not** introduce provider-neutral repository interfaces, webhooks, remote IDs, revision APIs, or asset-DAM abstractions now. The only low-cost precaution worth keeping is that domain types and Content IDs must not depend on file paths or Astro `entry.id`. Overall CMS portability risk is **low**.

---

## 6. Recommended next steps

1. Implement the approved Journal-only, read-only prototype scope in Decisions 029–031: load one valid unit, one broken/missing locale, one placeholder EN, and stale/deleted transitions; expose Issues and render decisions.
2. Use the approved Route Registry as the sole prototype route/reference boundary.
3. Verify the Astro 6 items in CR-08 and record results before choosing Entry ID encoding.
4. Specify File Writer, Repository Index, and Git Publisher interfaces before enabling Save, Rename, Delete, or Publish.
5. Migrate current consumers only after the Journal service boundary is proven; keep legacy collections working during the transition.

The prototype should validate boundaries, not UI polish. CR-01 through CR-04 are resolved at the documentation-contract level for the Journal prototype, but must still be proven by it. Full Editor implementation remains gated by the canonical infrastructure contracts in CR-05; mutating workflows additionally require CR-06 and CR-07 to be demonstrated.

---

## 7. Focused consistency audit after Decisions 029–031

| Source checked | Result |
| --- | --- |
| Loader Architecture Specification | Consistent after removing the obsolete unresolved blocked-action contract and limiting the three-file invariant to Journal. Entry ID remains opaque; Query Adapter remains route-free; Site Content Service remains above it. |
| Content Model Specification | Consistent after clarifying collection-specific storage adoption and keeping `visibility` out of the strict saved model until its implementation slice. Content ID remains the public identity. |
| Workflow Architecture Audit | Decision 030 supplies R8's missing matrix, but R8 correctly remains an implementation gate. File Writer, destructive Repository Index coverage, and Git Publisher are not pulled into the read-only prototype. |
| Current Journal Index / Detail | Legacy consumers call `getCollection()` directly and build params/links from `entry.id`. This is confirmed migration evidence, not documentation authority; no application code was changed. |
| Current Home Stories / News aggregation | Both read Journal directly and build Journal links from `entry.id`; they must consume Site Content Service and Route Registry only after the prototype proves those boundaries. |
| Current News image/reference resolver | It parses known paths with a local regex and resolves `entry.id` maps. Decision 031 replaces this target behavior without prematurely changing the production utility. |
| Astro 6 Content Loader API | The documented custom-loader flow supports schema-backed `parseData()`, store synchronization, watching, digest helpers, and rendered content. Exact lifecycle and synchronization choices remain prototype-only. |
| Astro 6 content APIs | `getCollection()` returns entries and can filter by `data`; `getEntry()` looks up Astro entry `id`; `render(entry)` produces the render component. Therefore Content-ID lookup belongs behind Query Adapter unless an internal encoding is later proven. |
| Astro 6 static routing | Static dynamic routes are enumerated by `getStaticPaths()`. Therefore Site Content Service must filter route candidates and Route Registry must supply Content-ID route params before production consumer migration. |

No high-confidence inconsistency was found that requires an application-code change before the read-only prototype. Unavailable View HTTP status/metadata, crawler policy, Entry ID encoding, `getEntry()` optimization, watcher details, and digest serialization remain explicitly prototype-only or future work.
