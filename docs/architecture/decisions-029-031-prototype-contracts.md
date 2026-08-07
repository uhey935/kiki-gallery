# KiKi Gallery Prototype Boundary Contracts

> Status: Historical decision record — implemented. The read-only prototype gate is closed and the prototype artifacts are removed. See [Journal Architecture — Current](./journal-architecture-current.md) for the implemented architecture and current commands. Sections describing future production migration are retained as decision context and are superseded where the current specification differs.

Version: v1.0  
Status: Approved for Journal read-only prototype  
Last Updated: 2026-08-06  
Scope: Decisions 029–031; no application implementation

---

## 1. Decision 029 — Issue / Capability Contract

An Issue describes an observed problem and its location. It does not store whether Save, Preview, or Publish is allowed. The Capability Evaluator is the sole owner of operation availability.

```ts
type Locale = "ja" | "en";

type IssueSeverity = "error" | "warning" | "info";

type IssueCategory =
  | "parse"
  | "structure"
  | "unit-integrity"
  | "repository-integrity"
  | "content-quality"
  | "conflict"
  | "infrastructure";

type ContentIssue = {
  ruleId: string;
  severity: IssueSeverity;
  category: IssueCategory;
  collection?: string;
  contentId?: string;
  locale?: Locale;
  file?: string;
  fieldPath?: string;
  source?: { line?: number; column?: number };
  messageKey: string;
  params?: Record<string, string | number | boolean>;
  recovery?: {
    kind:
      | "edit-field"
      | "edit-source"
      | "reload"
      | "resolve-reference"
      | "retry"
      | "manual-review";
    fieldPath?: string;
  };
};

type CapabilityResult = {
  allowed: boolean;
  blockers: ContentIssue[];
  warnings: ContentIssue[];
};

type ContentCapabilities = {
  save: CapabilityResult;
  preview: { ja: CapabilityResult; en: CapabilityResult };
  publish: CapabilityResult;
};
```

Rules:

- Issue producers report facts; they do not add `blocksSave`, `blocksPreview`, `blocksPublish`, or an equivalent `blocks` array.
- Capability evaluates Issues using collection, Content ID, operation, and locale context.
- Save is blocked only when repository-safe, reloadable serialization cannot be guaranteed, such as parse/structure failure, path collision, write conflict, serialization failure, or infrastructure failure.
- Preview is evaluated per locale. A localized EN blocker does not block JA Preview.
- Publish evaluates the complete Content Unit and repository-integrity requirements. Warnings do not block by themselves.
- `astro check`, `astro build`, and Git preflight are execution-time Publish workflow checks, not stored Issue properties.
- Needs Attention is a UI projection derived from Issues and Capability results. It is not repository data.
- The Journal prototype uses explicit Journal evaluator functions. A generic rule engine is deferred until repeated rules across collections justify it.

---

## 2. Decision 030 — Surface Visibility Matrix

Visibility is content policy, not validity or renderability. Loader, Repository Index, and Validation retain both `public` and `hidden` content. Site Content Service is the sole owner of surface inclusion; Presentation must not inspect `visibility` directly.

### 2.1 Common matrix

| Surface | `public` | `hidden` |
| --- | --- | --- |
| Repository Index | Included | Included |
| Validation | Included | Included |
| Editor Content List | Included | Included with state indication |
| Public Index | Included | Excluded |
| Home aggregation | Eligible | Excluded |
| Public/normal search | Included | Excluded |
| New Reference Picker | Selectable | Not selectable |
| Existing explicit reference | Valid | Remains integrity-valid |

`hidden` is neither `invalid` nor `unrenderable`. Structural validity, locale renderability, and surface visibility are evaluated separately, in that order.

### 2.2 Journal prototype matrix

| Journal surface | `public` | `hidden` |
| --- | --- | --- |
| Journal Index | Included | Excluded |
| Journal Detail | Route candidate; normal content | Route remains representable; return an Unavailable View decision |
| Home Stories | Eligible | Excluded |
| News aggregation | Eligible | Excluded |
| Editor Content List | Included | Included with Hidden state |
| Editor normal search | Included | Only with an explicit Hidden filter |
| New Reference Picker | Selectable | Not selectable |
| Repository Index / Validation | Included | Included |

For the read-only prototype, the required public behavior is filtering of Journal Index, Detail route candidates, Home Stories, and News aggregation through Site Content Service. The Unavailable View is a decision result to prove at the boundary; final copy, HTTP status, metadata, and page design are not part of this prototype.

### 2.3 Future crawler surfaces

Visibility policy is an extension point for future crawler-facing surfaces, including sitemap inclusion, robots/noindex, canonical policy, RSS, structured data, internal-link discovery, and AI crawler policy. No crawler policy, sitemap generator, robots behavior, `nofollow`, or metadata implementation is approved by this decision.

When a concrete requirement exists, the new surface must consume Site Content Service policy rather than introducing independent `visibility` checks. This follows the principle: design for extension, not anticipation.

### 2.4 Collection scope

Detail behavior remains collection-specific. This decision fixes Journal behavior only for the prototype and does not silently apply Journal rules to Artist, Work, Exhibition, News, Home, or About. The strict `visibility` schema field, migration default, and every affected consumer must be introduced together in a later implementation slice; documentation approval alone does not change current content.

---

## 3. Decision 031 — Route Registry Contract

Route Registry is the sole boundary for building known content routes and parsing known internal content routes. It uses Content ID and never exposes or parses Astro `entry.id`.

```ts
type ContentReference = {
  collection: string;
  contentId: string;
  locale: "ja" | "en";
};

type RouteRegistry = {
  build(reference: ContentReference): string;
  parse(pathname: string): ContentReference | undefined;
};
```

Journal canonical forms are:

- JA: `/journal/{contentId}/`
- EN: `/en/journal/{contentId}/`

Rules:

- `build()` owns locale prefixes, canonical collection patterns, encoding rules, and trailing-slash normalization.
- `parse()` accepts only exact, known internal content-route shapes. External URLs, malformed paths, and unknown internal paths return `undefined`; the registry does not guess.
- Collision validation enumerates route candidates through the same registry.
- `parse()` confirms route shape only. Repository Index confirms existence; Site Content Service decides surface behavior.
- Hidden content may have a route. Route existence does not imply normal public rendering.
- Query Adapter and Loader do not return route strings.
- Astro `entry.id` remains an opaque Store lookup key. Public identity, route generation, references, maps across the architecture boundary, and rename planning use `entry.data.contentId` or the equivalent repository-derived Content ID.
- Current News path parsing is a migration consumer of this registry. Unknown internal paths remain ordinary links, not Content References.

---

## 4. Journal read-only prototype entry gate

The entry criteria are satisfied for a narrow, read-only Journal prototype:

- Decision 029 fixes the Issue-to-Capability boundary.
- Decision 030 fixes the Journal surface policy and the sole visibility owner.
- Decision 031 fixes the Content-ID route/reference boundary.
- Three-file storage is explicitly Journal-first, not an all-collection migration.
- Astro integration uncertainties remain testable prototype items rather than undocumented architecture assumptions.
- Existing Journal, Home, News, Loader, and Content Model dependencies are identified.

This approval does not authorize the full Editor or any repository mutation. Save, Rename, Delete, Publish, File Writer, Repository Index completeness for destructive operations, Git Publisher, crawler behavior, and all-collection conversion remain outside the prototype.

## 5. Exact prototype scope

Implement and verify only:

1. Read Journal Content Units in `index.yaml` + `ja.md` + `en.md` form.
2. Derive stable Content ID from the unit directory and create locale-specific Astro entries with an opaque, prototype-only Entry ID encoding.
3. Preserve raw Markdown and prove Astro rendering compatibility.
4. Return partial results and typed Issues for one valid unit, one broken/missing locale, and one unresolved EN placeholder case.
5. Synchronize the Astro store on initial load and development changes; prove stale-entry removal after delete, rename, and valid-to-invalid transitions.
6. Provide typed Journal Query Adapter functions for locale filtering, Content-ID lookup, and stable date-descending/contentId-ascending sorting.
7. Provide Site Content Service decisions for Journal Index, Detail, Home Stories, and News aggregation, including `public` and `hidden` fixtures.
8. Provide Route Registry build/parse behavior for JA and EN Journal routes using Content ID.
9. Demonstrate that current Journal Index/Detail, Home Stories, News aggregation, and News image/reference resolution can consume the target boundaries. Consumer migration may be represented by a prototype harness; production pages are not modified in this slice.
10. Expose Issues, render decisions, and prototype Capability results sufficiently to verify boundaries; UI polish is excluded.
11. Run `astro check` and `astro build` against the prototype branch before accepting the architecture results.

Prototype-only findings to record, not prematurely standardize: Entry ID encoding, `getEntry()` optimization, `render(entry)` details, watcher teardown/debounce, full-clear versus set-diff synchronization, digest serialization, Unavailable View metadata/status, and performance.
