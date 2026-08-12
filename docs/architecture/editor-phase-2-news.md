# Phase 2 Editor — News audit and fifth Collection milestone

## Production contract

The production implementation, rather than remembered fields, is canonical. News is a flat Markdown announcement with required `date`, `news_type`, `title`, and `show_on_home`; `summary` and `link` are optional. Allowed types are `exhibition`, `artist`, and `general`. `link` is either an internal path or HTTP(S) URL. There is no `has_page`, image, asset transaction, body, or News Detail route.

`/news` merges News with public JA Journal candidates, sorts by date, groups by year, and owns presentation. Home selects `show_on_home` entries with a link, then derives an image only from exact known Artist, Exhibition, or Journal routes. External URLs and other internal paths remain ordinary links and do not yield Home cards. A broken exact known route fails resolution. The News filename is the Content ID but never generates `/news/{contentId}`.

## Editor slice and safety boundary

The fifth slice adds list/workspace read, field editing, schema and conditional validation, token-bound expiring Draft Preview, baseline-conflict-detecting atomic Save, and a Publish boundary that stages exactly one `src/content/news/{contentId}.md` file. `show_on_home: true` requires a link in the Editor draft because Home cannot select an entry without one. No asset, create/delete/rename, cleanup, migration, derivative, or cross-reference writer behavior is added.

The established Action Bar, failure guidance, full async form lock, Save shortcut, Content ID boundary, and Save/Preview/Publish safety boundaries are reused. News has a one-file replacement transaction, so there is no multi-file rollback path; existing manual-recovery terminal handling remains unchanged for workflows that can encounter rollback failure.

## Four-Collection validation-panel decision

Works, Exhibitions, Artists, and News now share the same presentation contract: status, issue summary, Save/Preview/Publish availability, and issue rows. This is mature enough for a display-only `FlatValidationPanel.astro`; Journal retains its locale-aware panel. Each Collection continues to own schemas, rule calculation, issue construction, and capability decisions. No generic repository, common Draft, schema-driven form, serializer, preview store, operation orchestrator, reference writer, or Asset Manager is introduced.

## Remaining work

News known-route reference existence is still enforced by production consumers at build time. Moving this to a reusable reference validator would cross into the deferred reference/repository boundary and is not part of this minimal slice. Home is the next candidate; its singleton and nested section media model should be audited independently before implementation.
