# Artists Localization Expansion Phase 7-1

> **Status: Historical design record — implemented and superseded.** This
> document records the fixture-only Phase 7-1 state before the 2026-08-11
> three-file migration. It is not the current Production or Editor contract.
> See [Artists Architecture — Current](./artists-architecture-current.md).

## Status and scope

Phase 7-1 is a fixture-only architecture prototype. It does not switch Production,
change `src/content/artists`, modify the Editor, or add translations. Its purpose is
to prove that localized Artist data can be separated from canonical Artist identity
without changing existing Works, Exhibitions, or News reference values.

## Three-file unit

Each future Artist unit is represented by one canonical identity and two independent
locale sources:

```text
<contentId>/
  index.yaml
  ja.md
  en.md
```

`<contentId>` is the only external reference identity. The localized adapter may use
internal IDs such as `ja::<contentId>` and `en::<contentId>`, but those IDs must never
be written into Works or Exhibitions references.

### Shared identity (`index.yaml`)

- `sort_name`
- `hero.image`
- `works_layout[]`
- `medium[]` (canonical shared taxonomy in this phase)

### Locale data (`ja.md`, `en.md`)

- `name`
- `short_bio`
- `biography?`
- `hero_alt`
- `seo_title?`
- `description?`

Markdown body content is not consumed by the current Artists routes. Phase 7-1
therefore requires an empty body; a non-empty body is a structural error. A future
phase must define body semantics before accepting it.

## Locale and capability rules

JA and EN are validated and published independently. Runtime fallback between them
is prohibited. A missing or invalid locale is not queryable and receives no detail
route. Unresolved `__TODO_...` placeholders are content-quality errors. In the
migration specification placeholders are generated only for EN, so the EN locale is
non-capable while a valid JA locale and the canonical identity remain available.

Identity capability is separate from locale capability. A valid `index.yaml` keeps
the canonical `<contentId>` resolvable even when one locale cannot be published.

## Legacy-to-three-file migration mapping specification

| Legacy field           | Target                     | Rule                                                             |
| ---------------------- | -------------------------- | ---------------------------------------------------------------- |
| `name`                 | `index.yaml: sort_name`    | Copy as canonical sort value                                     |
| `hero.image`           | `index.yaml: hero.image`   | Copy                                                             |
| `works_layout`         | `index.yaml: works_layout` | Copy without changing Work IDs                                   |
| `medium`               | `index.yaml: medium`       | Copy as shared canonical taxonomy                                |
| `display_name ?? name` | `ja.md: name`              | Resolve once in the converter; never at runtime                  |
| `short_bio`            | `ja.md: short_bio`         | Copy                                                             |
| `biography`            | `ja.md: biography`         | Copy when present                                                |
| `hero_alt`             | `ja.md: hero_alt`          | Copy                                                             |
| `seo_title`            | `ja.md: seo_title`         | Copy when present                                                |
| `description`          | `ja.md: description`       | Copy when present                                                |
| `name`                 | `en.md: name`              | Copy the current English/Romanized name                          |
| localized EN fields    | `en.md`                    | Emit explicit placeholders; keep EN non-capable until translated |

A later executable migration needs a frozen manifest containing source hashes,
mapped output hashes, content IDs, and reference evidence. Rollback evidence must
preserve the original Markdown bytes and the deterministic source-to-output mapping.
Phase 7-1 supplies only the mapping contract and tests; it does not migrate content.

## Route registry specification

| Locale | Index          | Detail                     |
| ------ | -------------- | -------------------------- |
| JA     | `/artists/`    | `/artists/<contentId>/`    |
| EN     | `/en/artists/` | `/en/artists/<contentId>/` |

Index routes are registry constants. A locale detail route is emitted only when that
locale is capable. Route parameters always use canonical `<contentId>`, never a
localized entry ID.

## Reference contract

Existing `reference("artists")` values in Works and Exhibitions continue to resolve
against identity adapter entries whose IDs are exactly `<contentId>`. The prototype
tests both existing reference schemas without rewriting their values. News and any
other consumers follow the same rule: localized presentation is selected only after
canonical identity resolution.
