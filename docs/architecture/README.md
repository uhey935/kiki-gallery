# KiKi Gallery Architecture

This directory contains the architectural documentation for the KiKi Gallery website.

These documents define the project's architectural principles, design decisions, and implementation guidelines. Together, they serve as the long-term reference for developing and maintaining the website.

The documentation is intended to evolve alongside the project while preserving a consistent architectural philosophy.

---

## Reading Order

The documents are designed to be read in the following order.

| Document                              | Purpose                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Content Model Specification**       | Defines the canonical content architecture and data model.                                         |
| **Loader Architecture Specification** | Defines how Content Units are loaded and adapted for Astro while preserving validation boundaries. |
| **Workflow Architecture Audit**       | Audits Editor save, rename, removal, and Git publish workflows before implementation.              |
| **Cross-Architecture Review**         | Sets the prototype gate across content, Editor, infrastructure, routing, migration, and consumers. |
| **Decisions 029–031**                 | Fixes Issue/Capability, surface visibility, Route Registry, and the exact Journal prototype gate.  |
| **CSS Style Guide**                   | Defines the presentation architecture and CSS conventions.                                         |
| **Architecture Audit**                | Evaluates the current implementation and identifies improvements.                                  |
| **Architecture Review Report**        | Verifies architectural consistency before implementation.                                          |

---

## Documents

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
