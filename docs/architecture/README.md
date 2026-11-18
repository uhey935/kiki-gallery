# KiKi Gallery Architecture

This directory contains the architectural documentation for the KiKi Gallery website.

These documents define the project's architectural principles, design decisions, and implementation guidelines. Together, they serve as the long-term reference for developing and maintaining the website.

The documentation is intended to evolve alongside the project while preserving a consistent architectural philosophy.

For public locale navigation, read
[Locale Route Projection — Current Architecture](./locale-route-projection-current.md).
It is the current authority for logical public route identities, static
route-family existence, target-locale capability composition, canonical URLs,
no-fallback counterpart projection, and Header behavior.

---

## Reading Order

Start with [Editor v1 Operations](../operations/editor-v1-operations.md), then
read the collection-specific authorities below and the locale-route authority.
Read Backup & Recovery and Asset Lifecycle v2 before recovery or asset-lifecycle
operations. Dated completion, readiness, prototype, and flat-runtime acceptance
records are historical evidence, not the authority for current topology.

This index is reconciled against baseline
`19c22839b238127068005aeccf378403222db6b5`. Some linked architecture documents
still contain earlier runtime snapshots. For current behavior, resolve those
snapshots against the implementation and contract tests; do not treat a former
pending milestone as an unimplemented Editor feature.

For Journal, read [Journal Architecture — Current](./journal-architecture-current.md)
for read/Production boundaries and the operations guide for Editor workflows.
For News, read [News Three-file Write Layer Migration](./news-write-layer-migration-2026-08-10.md)
for canonical Save/Create/Publish/Rename/Delete ownership, then
[News Delete Browser Acceptance](./news-delete-browser-acceptance-2026-08-09.md).

For Artists, read [Artists Architecture — Current](./artists-architecture-current.md)
first, then the immutable
[`artists-migration-manifest-2026-08-11.json`](./artists-migration-manifest-2026-08-11.json)
as migration evidence. The Phase 7-1, Editor Phase 2, Rename, Delete, and Editor
completion documents are historical implementation records and are not the
current Artists topology or lifecycle authority.

For Exhibitions, read
[Exhibitions Localization Architecture](./exhibitions-localization-architecture-2026-08-12.md)
first as the current implemented authority, then the immutable
[`exhibitions-migration-manifest-2026-08-12.json`](./exhibitions-migration-manifest-2026-08-12.json)
as migration and rollback evidence. The earlier Phase 2, Rename, Delete, and
Editor completion documents are historical flat/single-file implementation
records and are not the current Exhibitions topology or lifecycle authority.

For Works localization, read
[Works Localization Architecture](./works-localization-architecture-2026-08-12.md)
first as the current implemented authority, then the immutable
[`works-localization-manifest-2026-08-12.json`](../migrations/works-localization-manifest-2026-08-12.json)
as migration, rollback, and asset-invariance evidence. Earlier Works Asset
Manager, Rename, Delete, Editor, and browser records are historical flat-runtime
evidence and are superseded for topology and lifecycle details.

For Home localization, read
[Home Localization Architecture](./home-localization-architecture-2026-08-12.md)
as the current implemented authority. Home uses the exact three-file singleton,
localized Production loader/facade, and Shared/JA/EN Editor lifecycle. At the audited baseline, JA and EN routes are implemented and use formal
capability evaluation; the earlier temporary-copy/EN-placeholder snapshot is
historical. The JA page retains its explicit development projection fallback. The earlier Editor Phase 2 Home document
is historical flat-runtime evidence. The frozen Home migration manifest records
source, three target hashes, asset invariance, and rollback evidence.

For About localization, read
[About Localization Architecture](./about-localization-architecture-2026-08-18.md)
for singleton topology, structured-hours approval, localized ownership, and
migration evidence. Its provisional runtime and Editor-unregistered statements
are historical: Load, locale-isolated Preview, atomic three-file Save, and
exact-path Git Publish are implemented. At the audited baseline, Shared hours
and JA/EN content statuses are `approved`; `/about/` and `/en/about/` have public
implementations. Formal capability still checks content approval, hours, assets,
and route availability. Save/Publish do not grant approval. Future pending,
review, or placeholder content must satisfy those gates separately.

| Current entry point                                                                     | Responsibility                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Editor v1 Operations](../operations/editor-v1-operations.md)                           | Current seven-target Editor scope and Save/Rename/Delete/Publish operation boundaries.                                                                                       |
| [Journal Architecture](./journal-architecture-current.md)                               | Journal read path and Production boundaries.                                                                                                                                 |
| [Artists Architecture](./artists-architecture-current.md)                               | Artists three-file topology and lifecycle.                                                                                                                                   |
| [Exhibitions Localization](./exhibitions-localization-architecture-2026-08-12.md)       | Exhibitions three-file topology and lifecycle.                                                                                                                               |
| [Works Localization](./works-localization-architecture-2026-08-12.md)                   | Works three-file lifecycle and asset transactions.                                                                                                                           |
| [News Write Layer](./news-write-layer-migration-2026-08-10.md)                          | News exact-three-file write/lifecycle boundary.                                                                                                                              |
| [Home Localization](./home-localization-architecture-2026-08-12.md)                     | Home singleton structure; earlier provisional runtime snapshots are superseded as described above.                                                                           |
| [About Localization](./about-localization-architecture-2026-08-18.md)                   | About singleton structure and approval boundary; earlier provisional runtime snapshots are superseded as described above.                                                    |
| [Locale Route Projection](./locale-route-projection-current.md)                         | Route identity, route-family existence, capability-aware counterparts, canonical URLs, and Header behavior; use the implemented route-family table for current availability. |
| [Backup & Recovery](./backup-and-recovery-architecture-2026-08-07.md)                   | Backup scope, verification, restore, lock evidence, and disaster recovery.                                                                                                   |
| [Asset Lifecycle v2 Finalization](./asset-lifecycle-v2-physical-delete-finalization.md) | Final physical-delete boundary, composed with the earlier ledger and reversible-cleanup milestones.                                                                          |

[Editor Final Completion Audit](./editor-final-completion-audit-2026-08-09.md),
[Editor v1 Finalization](./editor-v1-finalization-2026-08-07.md), and earlier
Rename/Delete readiness and flat-runtime acceptance records retain their
historical decisions and test results. Read current collection authorities
first; do not use historical file counts, paths, or deferred-feature statements
as current operation instructions. Frozen migration manifests remain immutable
evidence, not live inventories.

## Implementation and verification references

Use the [Editor v1.x Contract and Verification Index](./editor-v1-contract-verification-current.md)
for the seven-target capability matrix, focused service/browser evidence,
coverage limits, approval gates, known pending work, and baseline-specific audit
provenance. It links to current architecture and operations without duplicating
their detailed specifications. Its historical PASS report is not a new test run.

---

## Documents

### About Localization Architecture — Structure and Approval Boundary

**about-localization-architecture-2026-08-18.md**

Defines About's exact three-file ownership, structured hours, localized
Markdown/address/image alts, locale capability, singleton Editor lifecycle, and
semantic migration evidence. The document's original pending-hours,
EN-placeholder, and unregistered-Editor snapshots predate the audited baseline.
Editor Save and Git Publish are implemented; formal capability remains a
separate content/asset/route check. Both locale routes are implemented.

The pure `src/content-boundaries/public-route-families.ts` table records
implemented page families; collection/singleton facades own content capability.
At the audited baseline every listed family has JA and EN implementations,
including Home, Journal, About, and Privacy. Existence alone does not make every
content entry publishable. Work detail uses standalone `WorkLayout` locale
metadata without introducing the site Header.

### Home Localization Architecture — Current

**home-localization-architecture-2026-08-12.md**

Defines the implemented Home singleton Production architecture: exact
three-file topology, strict Shared and localized ownership, decorative-media
accessibility, locale capability and route projection, dynamic composition,
and byte-evidenced migration. JA and EN public routes and the localized Editor lifecycle are implemented;
Production capability also checks required assets and locale destinations. The
JA development projection fallback remains distinct from formal capability.
The legacy Home path input UI is a known pending UI task.

### Artists Architecture — Current

**artists-architecture-current.md**

Defines the implemented Artists three-file Content Unit, canonical Content ID,
opaque localized entry IDs, shared/localized schema ownership, no-fallback
locale policy, the distinction between Shared `medium[]` classification and
localized `medium_label` presentation, Production facade, complete Editor
lifecycle, intentional
read-only legacy detection, and completed migration evidence. Read this before
the historical Artists prototype, Editor, Rename, Delete, and completion
records.

### Artists Migration Evidence

**artists-migration-manifest-2026-08-11.json**

Immutable evidence for the completed five-Artist migration, including original
flat bytes, generated three-file outputs, hashes, inventory, and rollback data.
Its SHA-256 is
`6618fb544aeb3bb6b75b2904ebf734aba7ea066ad0fa03f62b9d2e7acdb42cde`.
Migration tooling and tests remain retained recovery and audit evidence.

### Exhibitions Architecture — Current

**exhibitions-localization-architecture-2026-08-12.md**

Defines the implemented Exhibitions three-file Content Unit, canonical Content
ID, strict shared/localized ownership, no-fallback locale capability, Production
facade and routes, complete Editor lifecycle, News/Artist/Works reference
contracts, read-only legacy detection,
and completed migration integrity. Its JA flat-Works compatibility discussion
records an earlier migration stage; current Works topology is three-file.

### Exhibitions Migration Evidence

**exhibitions-migration-manifest-2026-08-12.json**

Immutable evidence for the completed five-Exhibition migration, including the
original flat bytes, generated fifteen-file inventory, hashes, field mapping,
and rollback data. Its SHA-256 is
`246edf641a799c4dc46624700653d0e50250168a729e33f0ca5933b458989725`.
Migration tooling and tests remain retained recovery and audit evidence.

### Editor Final Completion Audit — Historical

**editor-final-completion-audit-2026-08-09.md**

Audits all six collections and every supported mutation flow after Works
Delete, reconciles the browser-acceptance record, verifies locking, recovery,
Publish scope, dependency and Production boundaries, and records the completion decision and deferred work at that milestone. It
predates later localization, About integration, and final UI work; it is not the
current seven-target scope or topology authority.

### Works Delete Asset Lifecycle Semantics — Historical

**works-delete-asset-lifecycle-semantics-2026-08-09.md**

Retains the flat-runtime boundary between recoverable Works content removal and Asset
Lifecycle v2. It keeps every asset and lifecycle record unchanged, starts orphan
retention only at a later independent complete scan, gates pending asset state,
defines dual-lock inspection and rollback, and restricts Publish to the evidenced
content deletion. Its topology is superseded by the current Works Localization
Architecture.

### Works Delete Implementation and Browser Acceptance — Historical

**works-delete-browser-acceptance-2026-08-09.md**

Records the completed flat-runtime Works Delete service, route, reviewed-plan UI, dual-lock
transaction, byte-exact rollback, unchanged asset/lifecycle proof, single-path
Publish, cross-writer server gate, isolated tests, and real-browser acceptance.

### Delete Implementation Readiness Audit

**delete-implementation-readiness-audit-2026-08-09.md**

Audits the current Create/Rename implementations, no-cascade Delete contract,
Asset Lifecycle v2, retention, backup/recovery, quarantine, durable evidence,
reference graph, and Publish boundaries. It classifies Journal, News,
Exhibitions, and Artists as collection-ready under strict incoming-reference
blocking. Its Works deferral is closed by the subsequent Works Delete lifecycle
semantics finalization, while the audit remains the historical gate record.

### Works Rename Asset Lifecycle Semantics — Historical

**works-rename-asset-lifecycle-semantics-2026-08-09.md**

Retains the flat-runtime design boundary between Works Content ID Rename and Asset
Lifecycle v2. It keeps asset URLs/bytes and durable lifecycle evidence
unchanged, blocks pending unpublished asset state, composes the content and
asset repository locks, defines prospective evidence validation and exact
rollback, and prohibits Rename Publish from staging or re-materializing assets.

### Works Rename Browser Acceptance Closure — Historical

**works-rename-browser-acceptance-2026-08-09.md**

Records the completed flat-runtime implementation and isolated browser acceptance for
reviewed-plan confirmation, typed incoming references, unchanged asset URLs and
bytes, dual-lock refusal, renamed-workspace Preview/Save continuity, rollback,
and evidence-limited Publish. Its topology is superseded by the current Works
Localization Architecture and isolated full-lifecycle acceptance.

### Exhibitions / Artists Rename Reference Update Architecture — Historical

**exhibitions-artists-rename-reference-update-architecture-2026-08-08.md**

Defines the shared design boundary for Exhibitions and Artists Rename. It
maps every typed incoming/outgoing reference and route dependency, defines the
reviewed plan, canonical drift checks, byte-preserving reference rewrites,
multi-file staged installation, byte-exact rollback, stable failures, and the
exact Publish path set. Exhibitions and Artists implement this boundary, and
Works implements its separately approved lifecycle-aware transaction. Delete
and Production deferrals in that record describe its historical scope. All asset bytes and paths remain
outside the operation.

### Exhibitions Rename Browser Acceptance Closure — Historical

**exhibitions-rename-browser-acceptance-2026-08-08.md**

Records the fresh-process browser run that closes the Exhibitions first slice
without implementation changes, including the full reviewed Rename and
evidence-limited Publish path plus a representative fail-closed collision.

### Rename Dependency and Reference Audit

**rename-dependency-reference-audit-2026-08-08.md**

Classifies collection-specific references, public route coupling, and asset
semantics. It records the completed News/Exhibitions/Artists boundaries and the
subsequently implemented Works Asset Lifecycle disposition.

### Create / Rename / Delete Architecture & Safety — Historical Design

**create-rename-delete-architecture-and-safety-specification-2026-08-08.md**

Approves the content-lifecycle contract in Create → Rename → Delete order and
records the then-implemented Create boundary for Journal plus four formerly
flat collections, with Home explicitly singleton. It defines three-file Content Unit integrity, Content ID and route
changes, typed reference updates, conservative asset ownership, optimistic
conflicts, prospective validation, Save/Preview/Publish separation,
rollback/recovery evidence, and quarantine/retention integration. It preserves
Editor v1 and current canonical content/assets and does not authorize
implementation.

### Retention Policy Finalization

**retention-policy-finalization-2026-08-08.md**

Approves the independent post-backup policy. It separates candidate,
quarantine, backup-generation, and durable-evidence retention; sets conservative
minimum floors, roles, holds, remote-storage and restore requirements; preserves
the no-automatic-deletion boundary; and keeps implementation in a separately
reviewed milestone without changing Editor v1, Asset Lifecycle v2, or canonical
content/assets.

### Backup & Recovery Architecture / Tooling

**backup-and-recovery-architecture-2026-08-07.md**

Defines the backup generation scope for canonical content/assets and ignored
Editor state, SHA-256 verification, lock handling, transactional root restore,
failure behavior, retention-policy boundary, and disaster-recovery procedure.

### Asset Lifecycle v2 — Physical Delete & Finalization

**asset-lifecycle-v2-physical-delete-finalization.md**

Defines the sole physical-delete capability: displayable review evidence, explicit one-to-one confirmation, quarantine retention observations, a repeated locked final audit, durable prepared/completed/manual-recovery manifests, quarantine-only unlink, idempotent completion, and the irreversible restore boundary.

### Asset Lifecycle v2 — Reversible Cleanup

**asset-lifecycle-v2-reversible-cleanup.md**

Defines repository-lock ownership and stale-lock recovery, locked fresh re-audit and retention recheck, Editor-only quarantine records and assets, no-overwrite restore, rollback/crash semantics, and the continued prohibition on physical deletion.

### Asset Lifecycle v2 — Second Milestone

**asset-lifecycle-v2-second-milestone.md**

Defines the Editor-only durable candidate ledger, identity and observation evidence, retention state transitions, corruption/manual-recovery behavior, and the continued prohibition on physical deletion.

### Asset Lifecycle v2 — First Milestone

**asset-lifecycle-v2-first-milestone.md**

Defines the first read-only orphan-detection slice, deterministic deferred-cleanup evidence, fail-closed reference completeness, and the explicit no-physical-delete boundary.

### Editor v1 Finalization Audit — Historical

**editor-v1-finalization-2026-08-07.md**

Records the final Architecture, Workflow/UX, Production Safety, Validation, and
Documentation audit across Works, Journal, Exhibitions, Artists, News, and Home;
classifies the remaining work as post-v1 follow-up; and preserves the completion decision at that milestone. Current scope and
operation instructions are in the operations guide and collection authorities.

### Editor Phase 2 — Artists — Historical

**editor-phase-2-artists.md**

Records the canonical Artists schema and consumers, Work/Exhibition reference ownership, bounded Editor requirements, excluded asset and lifecycle operations, and the historical fourth-collection platform reassessment.

### Collection Framework Audit

**collection-framework-audit-2026-08-07.md**

Classifies reusable Editor/platform behavior, deferred abstractions, and collection-owned contracts; preserves the implementation gates, records the authoritative A2/B2/C2 reassessment, and closes the Works Editor v1 finalization audit.

### Works Asset Manager Architecture & Safety Specification — Historical

**works-asset-manager-architecture-and-safety-specification.md**

Records the original flat-runtime Works asset inventory, canonical root and URL model, Draft-versus-filesystem mutation boundary, media admission rules, Save/Preview/Publish transaction semantics, orphan policy, stable failure taxonomy, test matrix, and the single approved first implementation slice. Its excluded operations describe that earlier slice. Use Works Localization
Architecture for current three-file Save, Create, Rename, Delete, and asset
transactions.

### Journal Architecture — Current

**journal-architecture-current.md**

Defines the implemented Journal canonical schema, Issue transport, Astro adapter failure taxonomy, dependency direction, Production facade, Route Registry use, prototype cleanup, and production-equivalence verification. Read this before the dated prototype and migration records.

### Content Model Specification

**content-model-specification.md**

Defines the canonical content architecture for the project.

Topics include:

- Design Principles
- Content Architecture
- Collections
- Common Objects
- Common Fields
- Validation Rules
- Naming Conventions
- Decision Log

---

### Loader Architecture Specification

**loader-architecture-specification-v1.0.md**

Defines the target read architecture for three-file Content Units and the boundaries between the Loader, Astro Adapter, Validation, Migration, and Editor.

Topics include:

- Content Unit identity and file structure
- Shared Schema strategy
- Astro 6 Content Layer integration
- Partial loading and error recovery
- Consumer isolation and Markdown rendering boundary
- Query Adapter と Site Content Service の renderability boundary
- Astro dev watcher、collection rescan、stale Entry deletion
- Astro digest と Editor conflict token の分離
- Content ID を基準にした JA／EN Route Helper boundary
- Migration の予約済み EN Placeholder Token と Preview／Publish gate
- Responsibility map and unresolved implementation contracts

Decisions 008–012 の監査では Astro 6 Content Loader API と現行 Journal consumer／Schema を照合している。Content Model と Loader target は、Content Unit のディレクトリ名から Content ID を導出し、`entry.id` は Astro Store の opaque lookup key、公開 identity と route は `entry.data.contentId` を基準とする境界で整合している。

---

### CSS Style Guide

**css-style-guide.md**

Defines the CSS architecture and styling conventions used throughout the project.

Topics include:

- CSS Philosophy
- Architecture Principles
- Naming Conventions
- Layout
- Typography
- Responsive Design
- CSS Variables
- Animation
- Performance
- Documentation Standards

---

### Workflow Architecture Audit

**workflow-architecture-audit.md**

Historically audits the agreed Editor workflows against its repository baseline, Astro 6, Git semantics, the canonical specifications, and current Journal/News consumers.

Topics include:

- New Content and Editor State write boundaries
- Rename, asset ownership, and bounded reference rewrites
- Visibility, safe removal, and dependency-aware Delete
- staged, unstaged, untracked, and externally committed Git states
- commit identity and push retry behavior
- News-specific explicit-reference validation

### Phase 2 News Editor — Historical

See [editor-phase-2-news.md](./editor-phase-2-news.md) for the production audit, fifth Collection vertical slice, and four-Collection validation-panel decision.

- rollback requirements and prototype-only items

---

### Cross-Architecture Review

**cross-architecture-review-2026-08-06.md**

Historically reviews the target architecture against its repository baseline and then-current Astro 6 consumers. It classifies blockers, prototype validation items, implementation details, intentional deferrals, and low-severity CMS migration portability.

---

### Decisions 029–031

**decisions-029-031-prototype-contracts.md**

Defines the authoritative Issue / Capability contract, Journal Surface Visibility Matrix, future crawler-surface extension points without implementation, Content-ID-based Route Registry, and the exact read-only prototype scope.

---

### Architecture Audit

**architecture-audit.md**

Evaluates the current implementation against the project's architectural principles.

Topics include:

- Information Architecture
- Content Architecture
- Component Architecture
- CSS Architecture
- Accessibility
- Performance
- Maintainability
- Audit Findings

---

### Architecture Review Report

**architecture-review-report.md**

Provides a structured review of the architecture before implementation.

Topics include:

- Design Principles Review
- Information Ownership Review
- Collection Review
- Common Object Review
- Naming Review
- Validation Review
- Documentation Review
- Implementation Readiness

---

## Core Principles

The KiKi Gallery architecture is built upon the following principles.

- Single Source of Truth
- Clear Ownership
- Separation of Content and Presentation
- Simplicity over Premature Abstraction
- Readability over Cleverness
- Consistency over Convenience
- Long-term Maintainability
- Design for extension, not anticipation

These principles are shared across all architectural documents.

将来の拡張に必要な責務境界は残すが、具体的な要求がない infrastructure や policy は実装しない。

---

## Repository Structure

The following is an illustrative selection of documentation paths, including
historical records, not an exhaustive inventory of current repository files.
Use the reading order above to select current authorities.

```text
docs/
└── architecture/
    ├── README.md
    ├── editor-v1-finalization-2026-08-07.md
    ├── collection-framework-audit-2026-08-07.md
    ├── editor-platform-audit-2026-08-07.md
    ├── editor-phase-2-exhibitions.md
    ├── works-asset-manager-architecture-and-safety-specification.md
    ├── journal-architecture-current.md
    ├── content-model-specification.md
    ├── loader-architecture-specification-v1.0.md
    ├── workflow-architecture-audit.md
    ├── cross-architecture-review-2026-08-06.md
    ├── css-style-guide.md
    ├── architecture-audit.md
    └── architecture-review-report.md
```

---

## Versioning

Each document maintains its own version, review status, and update history.

Architectural changes should be reflected in the relevant document before implementation whenever practical.
