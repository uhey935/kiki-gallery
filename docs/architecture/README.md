# KiKi Gallery Architecture

This directory contains the architectural documentation for the KiKi Gallery website.

These documents define the project's architectural principles, design decisions, and implementation guidelines. Together, they serve as the long-term reference for developing and maintaining the website.

The documentation is intended to evolve alongside the project while preserving a consistent architectural philosophy.

---

## Reading Order

The documents are designed to be read in the following order.

| Document                                                       | Purpose                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Journal Delete Browser Acceptance**                          | Records exact-backup gating, no-cascade analysis, atomic three-file recovery, explicit confirmation, evidence-only Publish, and real-browser acceptance.   |
| **News Delete Browser Acceptance**                             | Records exact-backup gating, fail-closed reference analysis, atomic single-file recovery, explicit confirmation, and evidence-only Publish.                |
| **Exhibitions Delete Browser Acceptance**                      | Records exact-backup gating, News/Markdown no-cascade refusal, atomic single-file recovery, explicit confirmation, and evidence-only Publish.              |
| **Delete Safety Prerequisites Finalization**                   | Finalizes verified backup proof, durable recovery evidence, Delete-only Publish paths, shared locking, reference parsing, and Works dual-lock order.       |
| **Delete Implementation Readiness Audit**                      | Reconciles Delete with finalized Create/Rename and Asset Lifecycle semantics; classifies every collection and records the remaining implementation gates.  |
| **Works Rename Asset Lifecycle Semantics**                     | Approves unchanged asset paths/evidence, pending-manifest gating, dual-lock coordination, prospective validation, rollback, and asset-free Rename Publish. |
| **Works Rename Browser Acceptance Closure**                    | Records the implemented dual-lock transaction, typed Artist/Exhibition rewrites, unchanged assets, renamed workspace continuity, and exact Publish set.    |
| **Exhibitions / Artists Rename Reference Update Architecture** | Defines the bounded typed-reference graph, reviewed multi-file transaction, byte-exact rollback, and exact Publish set; both slices are implemented.       |
| **Artists Rename Browser Acceptance Closure**                  | Records typed Works/Exhibitions/News rewrites, renamed-workspace continuity, fail-closed collision, and exact Publish evidence.                            |
| **Exhibitions Rename Browser Acceptance Closure**              | Records fresh-server acceptance of the reviewed flow, redirect, reference rewrite, Preview/Save continuity, fail-closed collision, and exact Publish set.  |
| **Rename Dependency and Reference Audit**                      | Classifies collection Rename safety, the News expansion, and deferred reference/asset blockers.                                                            |
| **Create / Rename / Delete Architecture & Safety**             | Defines reviewed, conflict-safe, rollback-aware semantics for future content lifecycle operations without authorizing implementation.                      |
| **Retention Policy Finalization**                              | Approves retention floors, deletion authority, holds, evidence preservation, remote-storage requirements, and the separate implementation gate.            |
| **Backup & Recovery Architecture / Tooling**                   | Defines Git versus explicit-backup protection, integrity verification, exact restore, lock evidence, retention boundary, and disaster recovery.            |
| **Asset Lifecycle v2 — Physical Delete & Finalization**        | Defines per-asset explicit confirmation, quarantine retention, final locked re-audit, quarantine-only physical deletion, and durable final evidence.       |
| **Asset Lifecycle v2 — Reversible Cleanup**                    | Defines locked fresh re-audit, reversible quarantine/restore, crash recovery, and the continued no-delete boundary.                                        |
| **Asset Lifecycle v2 — Second Milestone**                      | Defines the durable candidate ledger, retention state, and continued no-delete boundary.                                                                   |
| **Asset Lifecycle v2 — First Milestone**                       | Defines read-only orphan detection, deferred-cleanup evidence, and the no-delete boundary.                                                                 |
| **Editor v1 Finalization Audit**                               | Declares the six-target Editor v1 boundary complete and records final cross-collection verification.                                                       |
| **Editor Platform Audit**                                      | Records the post-Works platform audit, resolved Journal recovery blockers, and retained shared boundaries.                                                 |
| **Editor Phase 2 — Home**                                      | Records the singleton Home contract, nested media slice, and Phase 2 platform assessment.                                                                  |
| **Editor Phase 2 — Artists**                                   | Records the fourth-collection production audit, minimal slice, relationship ownership, and platform reassessment.                                          |
| **Journal Architecture — Current**                             | Current authority for the implemented Journal read path and production boundaries.                                                                         |
| **Collection Framework Audit**                                 | Records the Works Editor v1 finalization audit and the proven Journal/Works boundaries.                                                                    |
| **Works Asset Manager Specification**                          | Defines the Works asset source of truth, mutation transactions, Preview/Publish boundaries, and safety invariants.                                         |
| **Content Model Specification**                                | Defines the canonical content architecture and data model.                                                                                                 |
| **Loader Architecture Specification**                          | Defines how Content Units are loaded and adapted for Astro while preserving validation boundaries.                                                         |
| **Workflow Architecture Audit**                                | Audits Editor save, rename, removal, and Git publish workflows before implementation.                                                                      |
| **Cross-Architecture Review**                                  | Sets the prototype gate across content, Editor, infrastructure, routing, migration, and consumers.                                                         |
| **Decisions 029–031**                                          | Fixes Issue/Capability, surface visibility, Route Registry, and the exact Journal prototype gate.                                                          |
| **CSS Style Guide**                                            | Defines the presentation architecture and CSS conventions.                                                                                                 |
| **Architecture Audit**                                         | Evaluates the current implementation and identifies improvements.                                                                                          |
| **Architecture Review Report**                                 | Verifies architectural consistency before implementation.                                                                                                  |

---

## Documents

### Delete Implementation Readiness Audit

**delete-implementation-readiness-audit-2026-08-09.md**

Audits the current Create/Rename implementations, no-cascade Delete contract,
Asset Lifecycle v2, retention, backup/recovery, quarantine, durable evidence,
reference graph, and Publish boundaries. It classifies Journal, News,
Exhibitions, and Artists as collection-ready under strict incoming-reference
blocking, keeps Works deferred for its dual-lock lifecycle milestone, and
records the shared gates that prevent Delete implementation in this milestone.

### Works Rename Asset Lifecycle Semantics

**works-rename-asset-lifecycle-semantics-2026-08-09.md**

Finalizes the design boundary between Works Content ID Rename and Asset
Lifecycle v2. It keeps asset URLs/bytes and durable lifecycle evidence
unchanged, blocks pending unpublished asset state, composes the content and
asset repository locks, defines prospective evidence validation and exact
rollback, and prohibits Rename Publish from staging or re-materializing assets.

### Works Rename Browser Acceptance Closure

**works-rename-browser-acceptance-2026-08-09.md**

Records the completed implementation and isolated real-browser acceptance for
reviewed-plan confirmation, typed incoming references, unchanged asset URLs and
bytes, dual-lock refusal, renamed-workspace Preview/Save continuity, rollback,
and evidence-limited Publish.
Works Delete and Production loader changes remain deferred.

### Exhibitions / Artists Rename Reference Update Architecture

**exhibitions-artists-rename-reference-update-architecture-2026-08-08.md**

Defines the shared design boundary for Exhibitions and Artists Rename. The
maps every typed incoming/outgoing reference and route dependency, defines the
reviewed plan, canonical drift checks, byte-preserving reference rewrites,
multi-file staged installation, byte-exact rollback, stable failures, and the
exact Publish path set. Exhibitions and Artists implement this boundary, and
Works implements its separately approved lifecycle-aware transaction. Delete
and Production behavior remain deferred. All asset bytes and paths remain
outside the operation.

### Exhibitions Rename Browser Acceptance Closure

**exhibitions-rename-browser-acceptance-2026-08-08.md**

Records the fresh-process browser run that closes the Exhibitions first slice
without implementation changes, including the full reviewed Rename and
evidence-limited Publish path plus a representative fail-closed collision.

### Rename Dependency and Reference Audit

**rename-dependency-reference-audit-2026-08-08.md**

Classifies collection-specific references, public route coupling, and asset
semantics. It records the completed News/Exhibitions/Artists boundaries and the
subsequently implemented Works Asset Lifecycle disposition.

### Create / Rename / Delete Architecture & Safety

**create-rename-delete-architecture-and-safety-specification-2026-08-08.md**

Approves the content-lifecycle contract in Create → Rename → Delete order and
records the implemented Create boundary for Journal plus the four creatable
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

### Editor v1 Finalization Audit

**editor-v1-finalization-2026-08-07.md**

Records the final Architecture, Workflow/UX, Production Safety, Validation, and
Documentation audit across Works, Journal, Exhibitions, Artists, News, and Home;
classifies the remaining work as post-v1 follow-up; and is the current authority
for the Editor v1 completion decision.

### Editor Phase 2 — Artists

**editor-phase-2-artists.md**

Records the canonical Artists schema and consumers, Work/Exhibition reference ownership, bounded Editor requirements, excluded asset and lifecycle operations, and the fourth-collection platform reassessment.

### Collection Framework Audit

**collection-framework-audit-2026-08-07.md**

Classifies reusable Editor/platform behavior, deferred abstractions, and collection-owned contracts; preserves the implementation gates, records the authoritative A2/B2/C2 reassessment, and closes the Works Editor v1 finalization audit.

### Works Asset Manager Architecture & Safety Specification

**works-asset-manager-architecture-and-safety-specification.md**

Defines the current Works asset inventory, canonical root and URL model, Draft-versus-filesystem mutation boundary, media admission rules, Save/Preview/Publish transaction semantics, orphan policy, stable failure taxonomy, test matrix, and the single approved first implementation slice. Asset mutation, storage migration, locale splitting, and New/Delete remain outside its current implementation scope.

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

Audits the agreed Editor workflows against the current repository, Astro 6, Git semantics, the canonical specifications, and current Journal/News consumers.

Topics include:

- New Content and Editor State write boundaries
- Rename, asset ownership, and bounded reference rewrites
- Visibility, safe removal, and dependency-aware Delete
- staged, unstaged, untracked, and externally committed Git states
- commit identity and push retry behavior
- News-specific explicit-reference validation

### Phase 2 News Editor

See [editor-phase-2-news.md](./editor-phase-2-news.md) for the production audit, fifth Collection vertical slice, and four-Collection validation-panel decision.

- rollback requirements and prototype-only items

---

### Cross-Architecture Review

**cross-architecture-review-2026-08-06.md**

Reviews the complete target architecture against the repository baseline and current Astro 6 consumers. It classifies blockers, prototype validation items, implementation details, intentional deferrals, and low-severity CMS migration portability.

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
