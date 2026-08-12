# Editor Phase 2 — Exhibitions

> **Historical / superseded Exhibitions implementation record.** This document
> records the former flat, single-Markdown Editor slice. It is not the current
> Exhibitions topology or lifecycle after the three-file migration. See
> [Exhibitions Localization Architecture](./exhibitions-localization-architecture-2026-08-12.md).

## Selection

Exhibitions is the first Phase 2 collection. Its flat Markdown shape reuses the Works safety boundary, while schedule rules, Artist/Work references, body content, and hero presentation provide enough collection-specific behavior to evaluate the platform after a third collection. Artists has a heavier Works layout dependency, News is too small to exercise the boundary, and Home is a singleton dominated by nested media configuration.

## Production audit and Editor requirements

- Canonical source: `src/content/exhibitions/<contentId>.md` using the production Astro collection schema.
- Consumers: Exhibitions index/detail routes and Home exhibition/story integration; references resolve through the Artists and Works collections.
- Minimal slice: read existing entries, edit all current fields and Markdown body, validate with the production-equivalent schema, preview without writing canonical content, atomically save with baseline concurrency protection, and publish only the selected saved file.
- Existing hero image paths are editable references. Upload, replace, physical deletion, orphan cleanup, derivatives, batch operations, storage migration, locale split, and create/delete/rename are excluded.

## Platform and collection boundaries

Applied unchanged: Content ID validation, async form locking, Save shortcut, capability gating, failure guidance, canonical mismatch protection, dev-only mutation/preview routes, and saved-before-publish enforcement.

Collection-specific: date-range validation, Artist/Work reference lists, Exhibition fields and preview presentation, serializer ordering, canonical path, and publish message.

## Third-collection reassessment

Commonize now: the Action Bar state model and failure guidance already shared through pure UX helpers; async locking and Save shortcut policy; the simple flat-Markdown validation panel presentation can now replace the duplicated Works/Exhibitions markup in a later contained refactor.

Wait: a generic repository, Draft type, serializer, schema-driven form, preview store, operation orchestrator, and asset manager. Three collections confirm the safety policy but not a stable shared data shape. Journal remains structurally different, and Exhibitions does not need asset mutation.
