# Artists Architecture — Current

| Property       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Status         | Current architecture authority                                                               |
| Effective date | 2026-08-11                                                                                   |
| Scope          | Artists localization, Production reads, Editor lifecycle, references, and migration evidence |

This document is the current authority for Artists. Earlier prototype, Editor,
Rename, Delete, and migration documents remain useful historical records, but
their flat-Markdown descriptions do not describe the current repository.

## Canonical content topology and identity

Each Artist is one three-file Content Unit:

```text
src/content/artists/<contentId>/
  index.yaml
  ja.md
  en.md
```

The directory name `<contentId>` is the canonical Artist identity. It is used by
routes and external references such as `Works.artist`,
`Exhibitions.artists[]`, known Artist links in News, and the ownership checks
for `Artists.works_layout[].works[]`.

Localized adapter entries use `ja::<contentId>` and `en::<contentId>` as opaque
internal lookup IDs. Consumers must not parse these IDs or store them as routes,
Content IDs, or cross-collection references.

## Schema ownership

`index.yaml` owns shared fields:

- `sort_name`
- `hero.image`
- optional `works_layout[]`, whose entries contain `layout` and Work Content IDs
  in `works[]`
- `medium[]`, the canonical classification/navigation terms

Each locale file owns:

- `name`
- `medium_label`, the required locale-specific public display text
- `short_bio`
- optional `biography`
- `hero_alt`
- optional `seo_title`
- optional `description`

Locale Markdown bodies are currently required to be empty.

Public Artists index and detail surfaces display only the locale-owned
`medium_label`. They must not derive visible medium text from Shared `medium[]`.

## Locale and capability policy

JA and EN are independent. Runtime fallback from JA to EN or EN to JA is
prohibited. A missing, invalid, or unresolved-placeholder locale is not exposed
by that locale's Production query or Detail route.

A missing, invalid, empty, or unresolved-placeholder `medium_label` blocks only
its owning locale. There is no fallback to Shared `medium[]` or to the sibling
locale.

Reserved EN placeholders block EN capability only. They do not block a valid
canonical identity or valid JA capability.

## Production and Editor boundaries

Production reads Artists only through the three-file Artists facade. Production
consumers do not read a legacy flat Artists collection and do not use localized
entry IDs as external identity.

The Artists Editor implements Create, Read, Preview, Save, Publish, Rename, and
Delete as a three-file lifecycle. Save and Create validate and install the full
unit. Rename moves the directory unit and rewrites the bounded Works,
Exhibitions, and News reference graph. Delete moves the complete unit to
recovery after exact backup and incoming-reference checks. Publish stages only
the canonical three-file paths or the exact paths authorized by completed
Rename/Delete evidence.

There is no legacy flat Artists read or write fallback. Read-only detection of a
legacy flat source is intentionally retained as fail-closed compatibility
safety: a mixed repository is refused rather than adapted or persisted.

## Completed migration and immutable evidence

The five canonical Artists were migrated from flat Markdown to 15 three-file
sources on 2026-08-11. The converter, executor, tests, and recovery data remain
historical tooling and audit evidence; they are not runtime fallbacks.

The frozen manifest is
`docs/architecture/artists-migration-manifest-2026-08-11.json`. Its immutable
SHA-256 is:

```text
6618fb544aeb3bb6b75b2904ebf734aba7ea066ad0fa03f62b9d2e7acdb42cde
```

The manifest must not be regenerated, normalized, or edited.
