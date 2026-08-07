# Editor Phase 2 — Artists

## Production audit

Artists is the fourth Editor collection. The canonical source is `src/content/artists/<contentId>.md`, loaded by Astro's flat Markdown glob loader. The production schema is now exported through `content-schemas/artist.ts` and consumed by both Astro and the Editor.

The current production shape—not a legacy or proposed shape—is `name`, optional `display_name`, `hero.image`, `hero_alt`, required `short_bio`, optional `biography`, one or more English `medium` navigation terms, optional `works_layout`, and optional SEO title/description. Each Works layout section is one of `single-a`, `single-b`, `double-a`, or `double-b`; single layouts require one Work and double layouts require two. A Work may occur only once across the Artist layout.

Production consumers are the Artists index and detail routes. The detail route resolves `works_layout` against Works, verifies that every Work exists and belongs to the current Artist, and derives Exhibitions by finding Exhibition entries that reference the Artist. Works detail pages resolve their single Artist reference. This means Artists owns curated Work ordering, Works owns the Artist relationship, and Exhibitions owns its Artist membership; the Editor does not rewrite any reciprocal reference.

## Minimal Editor slice

- Browse and read existing Markdown entries; no create, delete, or rename.
- Edit every current Artist field, the optional Markdown body, existing hero path, and ordered Works layout.
- Validate the shared production shape, layout cardinality, duplicate Work references, required text, English medium terms, and reference object boundary.
- Preview through a Content-ID-bound, tokenized, expiring in-memory Draft route without canonical writes.
- Save one existing Artist Markdown file by exclusive staging and atomic rename, guarded by the loaded baseline and a second pre-rename canonical comparison.
- Publish only the selected, saved Artist Markdown file after repository/upstream and staged-set checks.
- Lock every form control while Save, Preview, or Publish is pending; retain shared failure guidance and manual-recovery terminal-state policy.

Asset upload/replacement, physical deletion, orphan cleanup, batch Replace, derivatives, storage migration, locale splitting, generic Asset Manager work, and reciprocal reference mutation are excluded.

## Fourth-collection platform reassessment

### Commonize now

Action Bar state, failure guidance, pending-operation form locking, Save shortcut behavior, manual-recovery terminal state, Content ID boundary, and Save/Preview/Publish safety boundaries remain proven shared platform policy.

### Limited commonization is now appropriate

Works, Exhibitions, and Artists now share the same flat-Markdown validation-panel presentation: status, issue summary, capability rows, and issue list. The data contracts are stable enough for a small presentational component, but collection-specific validation and capability calculation must remain outside it. This refactor can be taken as a contained follow-up; it is not required to prove the Artists vertical slice.

The token/TTL mechanics of Exhibitions and Artists previews are also structurally similar, but only two simple stores exist and Works has asset-bound preview behavior. Keep the implementation separate until another non-asset collection confirms the lifecycle.

### Wait

Do not introduce a generic repository, shared Draft data type, schema-driven form, shared serializer, preview store, operation orchestrator, reciprocal-reference writer, or generic Asset Manager. Four collections confirm shared safety policy, not a shared content shape. Journal remains a three-file Content Unit, Works has transactional assets, Exhibitions has dates, and Artists has ordered layout cardinality plus relationship ownership rules.

## Remaining work and next candidate

News is the preferred next collection because it tests a smaller flat schema and explicit link/type rules without creating another asset transaction. Home should remain later: it is a singleton with nested responsive media and requires a distinct workspace model. Before either slice, the flat-Markdown validation-panel extraction can be performed independently if desired.
