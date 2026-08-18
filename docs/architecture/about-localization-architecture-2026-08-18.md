# About Localization Architecture

> Runtime status (2026-08-18): the provisional exact three-file unit is live at
> `/about/` as a JA review-only development projection. Shared hours remain
> pending, EN remains placeholder, and `/en/about/` is intentionally absent.
> The singleton Editor now supports Load, locale-isolated Preview, atomic
> exact-three-file Save, and exact-path Git Publish. This is not final closure:
> formal publication still requires approved Shared hours/facts, approved JA
> and EN content/alts, Header locale projection, and formal route activation.

Status: Provisional canonical/runtime cutover implemented; formal locale capability pending

Date: 2026-08-18

Foundation status: implemented. Strict schemas, exact singleton repository,
pure capability/facade and route primitives, semantic extraction, deterministic
converter/planner, frozen provisional manifest, and fixture-only executor live
under `src/content-loaders/about/`. They are intentionally not registered in
Production or Editor. The evidence file is
`docs/migrations/about-localization-manifest-2026-08-18.json`.

Provisional cutover status: implemented. The exact canonical unit now exists at
`src/content/about/about/{index.yaml,ja.md,en.md}`. JA is explicitly `review`,
EN is `placeholder`, and Shared hours are `pending`; formal JA and EN
capability are both false. `/about/` uses the documented JA development
projection, while `/en/about/` remains absent. This is current runtime authority
for the provisional state, not approval of its editorial or factual values.

## 1. Scope and authority

This document defines the implemented structural target and current provisional
runtime for the About singleton. `src/pages/about.astro` is now presentation
only and reads canonical content through the About Production facade. It
publishes the JA review projection at `/about/`; `/en/about/` is absent.

The completed provisional migration did not authorize asset changes, formal
locale publication, Editor implementation, Header implementation, staging,
committing, or pushing.

The legacy `GALLERY crossing` statement is historical source evidence. It is
not canonical target copy and must not be migrated as the current KiKi Gallery
statement. New JA and EN statements require human approval; tooling must never
promote AI-generated prose automatically.

## 2. Canonical singleton and topology

The canonical identity is `about`. About is one singleton, not a multi-entry
Collection:

```text
src/content/about/about/
├── index.yaml
├── ja.md
└── en.md
```

The directory name is the Content ID single source of truth. No file repeats
`contentId`, `slug`, or route. The repository requires the exact three-file
inventory in lexical order and fails closed for a missing or extra entry,
symlink, non-regular entry, unsafe directory, or a mixed legacy canonical
content state. The existing hard-coded page may coexist only during a reviewed
migration/cutover transaction; it must never be treated as a second canonical
content unit.

About has no Create, Rename, Delete, duplicate, or generic collection CRUD.

## 3. Shared schema

The smallest truthful target is:

```yaml
images:
  hero:
    src: /images/about/about-hero.jpg
  gallery:
    - src: /images/about/about-01.jpg
    - src: /images/about/about-02.jpg
    - src: /images/about/about-03.jpg
    - src: /images/about/about-04.jpg

hours:
  status: pending

contact: {}
```

Once facts are approved, `hours` uses the other branch of a strict
discriminated union:

```yaml
hours:
  status: approved
  timezone: Asia/Tokyo
  open_days: [wed, thu, fri, sat]
  opens: "12:00"
  closes: "18:00"
  closed_days: [sun, mon, tue]

contact:
  email: info@example.com
  map_url: https://example.com/map
  instagram_url: https://instagram.com/example
```

The example contact values above illustrate types only and are not migration
inputs. The implementation must not copy them.

Rules:

- `images.hero.src` is one required absolute public asset path.
- `images.gallery` has exactly four `{ src }` entries in display order.
- Gallery sources are non-empty absolute public asset paths and unique.
- Shared has no hero or gallery `alt` fields.
- `hours.status: pending` admits no schedule fields and makes every formal
  locale non-capable.
- `hours.status: approved` requires `timezone: Asia/Tokyo`, non-empty unique
  `open_days`, `opens`, `closes`, and explicit `closed_days`.
- Weekdays use `mon | tue | wed | thu | fri | sat | sun`.
- Times use validated zero-padded 24-hour `HH:MM`; `opens < closes` for this
  first single-interval model.
- `open_days` and `closed_days` must be disjoint and together cover all seven
  weekdays exactly once. Order is Monday through Sunday within each list.
- Split daily hours, holiday exceptions, appointments, and multiple intervals
  are outside this first model and require a schema change rather than prose
  overrides.
- `contact` is strict and may contain only optional `email`, `map_url`, and
  `instagram_url`. Empty `contact: {}` is valid.
- Optional contact absence does not block capability. An invalid or fake value
  does; `...`, `#`, generic service home pages, and known placeholder account
  tokens are not accepted canonical URLs.
- No phone or generic social array is introduced.

The factual hours conflict in current repository sources is deliberately not
resolved here. Human-approved hours are required to move the discriminant from
`pending` to `approved`.

## 4. Localized schema and Markdown body

Each `ja.md` and `en.md` has strict frontmatter followed by the institutional
statement as Markdown body:

```md
---
content_status: placeholder
address: __ABOUT_ADDRESS_PENDING__
images:
  gallery:
    - alt: __ABOUT_GALLERY_ALT_1_PENDING__
    - alt: __ABOUT_GALLERY_ALT_2_PENDING__
    - alt: __ABOUT_GALLERY_ALT_3_PENDING__
    - alt: __ABOUT_GALLERY_ALT_4_PENDING__
seo_title:
description:
---

**ABOUT_STATEMENT_PENDING**
```

`seo_title` and `description` are omitted rather than serialized as empty in a
real target. The example shows unresolved tooling state, not publishable copy.

Localized fields are:

| Field                  | Required | Ownership |
| ---------------------- | -------- | --------- |
| `content_status`       | Yes      | Locale    |
| `address`              | Yes      | Locale    |
| `images.gallery[].alt` | 4 items  | Locale    |
| `seo_title`            | No       | Locale    |
| `description`          | No       | Locale    |
| Markdown body          | Yes      | Locale    |

`content_status` is `placeholder | review | approved`:

- `placeholder` permits deterministic tooling/fixtures but never Preview or a
  formal route. Reserved placeholder markers must never be rendered.
- `review` contains real draft text, may be Previewed in the Editor, and never
  produces a formal route.
- `approved` is human-approved locale content and may contribute to formal
  capability.

The implemented reserved tooling markers are
`__TODO_ABOUT_{JA|EN}_{STATEMENT|ADDRESS}__` and
`__TODO_ABOUT_{JA|EN}_ALT_{1|2|3|4}__`. The provisional manifest stores these
markers only in planned target evidence, sets every human gate false, and sets
`realMigrationAllowed: false`. It does not create the canonical target
directory.

Address is locale-owned display text. This milestone does not add a structured
LocalBusiness address or treat one locale as a source for the other. Map URL,
when approved, remains Shared.

The Markdown body must be non-empty. A body containing any reserved placeholder
marker is content-quality invalid regardless of `content_status`. The body is
not reused by Home and is not generated from the legacy statement.

## 5. Hours presentation

Hours and closed-day display strings are Derived, never canonical localized
facts. A locale presenter consumes the approved Shared schedule and returns
locale-appropriate labels and values. It may vary punctuation, weekday labels,
and ordering only; it must not alter days or times.

There is no localized display override in the first implementation. If future
requirements need appointment notes, holiday exceptions, or editorial
qualifiers, they require an explicit modeled field and architecture review.

## 6. Image and accessibility contract

The hero is Shared and decorative. Production renders it without localized alt
and removes it from the accessibility tree (`aria-hidden` presentation or an
equivalent empty-alt image contract).

Gallery images are informational slots:

- Shared source count = JA alt count = EN alt count = exactly `4`.
- Slot correspondence is positional and stable.
- Shared files contain only sources; localized files contain only alts.
- Every capable locale has four trimmed, non-empty, non-placeholder alts.
- Duplicate Shared sources are rejected.
- Missing, unsafe, undecodable, or format-mismatched required assets block both
  locales; invalid localized alt blocks only its locale.
- The Editor must show the Shared image beside each locale alt without copying
  the source into localized draft state.

## 7. Issues and capabilities

Repository/loader issues retain scope and category. At minimum they distinguish
`structure`, `unit-integrity`, `asset`, `factual-approval`, and
`content-quality`, with an optional `ja | en` locale.

JA formal capability requires all of:

1. exact, safe, schema-valid Shared/JA/EN unit topology;
2. valid Shared images, hours, and contact structure;
3. `hours.status === approved`;
4. `ja.md` valid with `content_status === approved`;
5. non-placeholder JA address and Markdown body;
6. exactly four valid JA gallery alts;
7. all five required assets present, regular, decodable, and matching their
   admitted format;
8. successful `about + ja` route projection.

EN applies the same rules to EN source/address/body/alts and the `about + en`
projection. Neither locale falls back to its sibling. Optional SEO and absent
optional contact links do not block capability.

Structural corruption of the singleton is unit-wide and fails the build.
Locale content-quality failure isolates formal capability to that locale when
the exact unit remains structurally safe.

### Development and Preview capability

Formal Production and Editor Preview are separate decisions:

- `placeholder`: load/save allowed when structurally valid; Preview denied.
- `review`: locale Preview allowed when Shared is structurally valid, required
  assets exist, and that locale is renderable; formal route denied.
- `approved`: Preview allowed; formal route additionally requires approved
  hours and all formal checks.

Preview uses the Production About renderer and locale presenter through a
token-bound Editor-only route. It may show a clear Editor chrome status but
must not expose raw reserved TODO markers or create a public route. No general
JA development Production projection is approved; the current `/about/`
remains unchanged until formal JA cutover.

## 8. Routes and consumers

The route registry owns projection from canonical identity and locale:

| Identity/locale | Capable route |
| --------------- | ------------- |
| `about + ja`    | `/about/`     |
| `about + en`    | `/en/about/`  |

A formally non-capable locale has no formal static path. The registry exposes capability and a
normalized trailing-slash URL; consumers do not construct paths themselves.

The sole temporary exception is the explicit JA development projection:
structurally valid `review` JA content may continue to generate `/about/` while
clearly remaining formally incapable. Placeholder content is never projected,
and there is no equivalent EN development route.

Target Production pipeline:

```text
exact About unit
→ strict repository and owned issues
→ localized facade
→ locale capability
→ About route registry
→ /about/ and conditional /en/about/
```

After cutover, `about.astro` (or its replacement route renderer) owns only
presentation, CSS hooks, and parallax behavior. It no longer owns institutional
content, facts, metadata, image identities, or alts.

## 9. Home dependency

The dependency is one-way:

```text
EN About formally capable
→ /en/about/ available
→ Home EN `about` destination available
→ Home EN may satisfy that destination requirement
```

About never reads Home `about_intro`. Home continues to own that independent
editorial copy and must not derive it from, fall back to, or duplicate the About
statement. About capability alone does not make EN Home capable; every existing
Home requirement still applies.

## 10. Header dependency

The future site-wide locale projection consumes the About registry:

- `about + ja` projects `/about/` only when JA is capable.
- `about + en` projects `/en/about/` only when EN is capable.
- Header displays a counterpart switch only when projection is available.
- Header must not hard-code `/en/about/`, blindly prefix paths, or fall back to
  locale Home.

Header implementation is a separate dependency and is not authorized by this
architecture phase.

## 11. Editor target

About Editor is a singleton workspace with Shared, JA, and EN draft scopes. It
reuses generic Home singleton primitives only where their contracts are truly
generic: exact-three-file loading, immutable source preimages, scope dirty
state, tokenized Preview, exclusive/atomic three-file Save, canonical reread,
exact-evidence Publish, drift detection, rollback, and recovery evidence.

It must introduce About-owned schema, serializer, validation, presenter,
Preview model, and form fields. Home-specific `about_intro`, fixed Home image
literals, and Home capability constants are not generalized into About.

Actions:

- Load: always loads the one `about` workspace.
- Preview: locale-isolated and governed by the Preview matrix above.
- Save: validates a complete exact-three-file draft, compares all three source
  preimages, installs all three atomically, and rereads canonical state.
- Publish: remains separate and stages/commits exactly the three canonical
  About files backed by saved-baseline evidence. It never stages assets,
  migration evidence, unrelated files, or pushes.
- Create/Rename/Delete: absent from service, route, UI, and capability models.

Preview must render the Production-equivalent About page. Save capability must
not be confused with formal route capability.

## 12. Current source extraction mapping

| Current source value                                   | Target treatment                                                                                      | Classification                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `About` page/section headings                          | Remain component-owned navigation/presentation copy unless later localization requires modeled labels | Presentation-only                                                       |
| Two `GALLERY crossing` paragraphs                      | Preserve only as source evidence; do not populate JA body                                             | Human-approved replacement required; obsolete as current canonical copy |
| `〒220-0004 ... むつみビル3階`                         | No automatic target value                                                                             | Human verification/replacement required                                 |
| `Wed–Sat 12:00–18:00`                                  | No automatic schedule value because repository evidence conflicts                                     | Human-approved replacement required                                     |
| `info@kiki-gallery.com`                                | Candidate only; no automatic target value                                                             | Human verification required                                             |
| Address `href="..."`                                   | Do not migrate                                                                                        | Obsolete/drop                                                           |
| Instagram `href="..."`                                 | Do not migrate                                                                                        | Obsolete/drop                                                           |
| Five `/images/about/...` paths                         | Copy exactly to Shared slots                                                                          | Verbatim reusable                                                       |
| Four generic English alts                              | Do not auto-approve for either locale                                                                 | Human-approved localized replacement required                           |
| Hero `aria-hidden` and parallax                        | Preserve in renderer/CSS                                                                              | Presentation-only                                                       |
| `title="About"` and `description="About KiKi Gallery"` | No generated target prose; human may supply optional localized metadata                               | Human-approved replacement or omission                                  |
| Canonical/OG URL construction                          | Keep derived in layout/route infrastructure                                                           | Derived/presentation-only                                               |

Extraction must record exact source spans, not merely parsed values.

## 13. Migration evidence

Because the source is Astro code, this is a semantic extraction with human
inputs, not a byte-for-byte content conversion. A frozen manifest must bind:

- exact `src/pages/about.astro` path, bytes, length, and SHA-256;
- relevant `src/styles/about.css` identity when renderer invariance depends on
  it;
- every extracted source span/value and its mapping classification;
- explicit status and provenance for each human-approved factual/editorial
  input;
- deterministic generated bytes, lengths, and SHA-256 for `index.yaml`,
  `ja.md`, and `en.md` once inputs are finalized;
- original source-component bytes or an immutable Git object identity for
  rollback;
- exact target topology and collision/drift preconditions;
- all five About asset paths, lengths, SHA-256 values, decoded dimensions, and
  decoded JPEG format before and after;
- a declaration that Home `about-landscape.jpg` is outside this migration.

The converter/executor must reject source drift, manifest drift, unapproved
facts, unexpected source/target inventory, unsafe paths, target collisions,
asset drift, or post-install validation failure. A dry run produces evidence
without mutation. Migration execution and Production cutover require separate
authorization.

The implemented executor entry point is fixture-only. It verifies and preserves
the Astro source rather than removing it, supports dry-run, collision/drift and
generated-evidence checks, staged exact-three-file validation, post-install
reread, rollback, and durable manual-recovery evidence. Calling it with a plan
that is not explicitly marked `fixtureOnly: true` is rejected. Canonical
migration execution remains unimplemented and unauthorized.

The architecture audit observed these source identities on 2026-08-18. They
are design evidence only; migration tooling must recalculate and freeze the
complete bytes immediately before an authorized migration:

- `src/pages/about.astro` SHA-256:
  `752a155e9fd22b11c38991298267bc2e35f9fefc500d47000c6613395c0bc9c8`
- `src/styles/about.css` SHA-256:
  `8e7f11bc68e6133854efbe2d6c3ae3bc2f5bf9da72975d60f8943fe37c561427`

## 14. Asset invariants

The following evidence was observed on 2026-08-18 and must be frozen again by
the migration manifest immediately before implementation:

| Path                                 |     Bytes | Dimensions | Decoded format | SHA-256                                                            |
| ------------------------------------ | --------: | ---------: | -------------- | ------------------------------------------------------------------ |
| `public/images/about/about-hero.jpg` | 1,970,340 |  1627×2440 | JPEG           | `b314db5991203b2ee96d9d54bdbf18f55a35d7373ce371292b83d59b6408a081` |
| `public/images/about/about-01.jpg`   |   379,888 |  1199×1500 | JPEG           | `689b96be9ade5ccab0ce8d5e868f4cb540dda7fec0361417f49448cdd8bdb857` |
| `public/images/about/about-02.jpg`   | 2,672,081 |  2000×3000 | JPEG           | `1c8ef9d08e5b8fcad7cfd00aadd842c5917f3a7f01b91fd07d2afde42b1b68fd` |
| `public/images/about/about-03.jpg`   |   774,365 |  2400×3000 | JPEG           | `ea24701ad05b79a257308678c4b008a3e2bac4932cbd87ded39af4b97381207b` |
| `public/images/about/about-04.jpg`   | 1,364,808 |  3000×2400 | JPEG           | `b431325885306f5532b6a6a7c0a45d224ba7c7ddb6f617a0e19ac858c52969b1` |

Localization, migration, Editor Save, and Publish do not change, move, upload,
replace, stage, or claim ownership of these assets. No About asset manager is
introduced.

## 15. SEO and structured data

Localized `seo_title` and `description` are optional and do not block routes.
Missing values use the existing deterministic site-level non-prose behavior;
the implementation must not generate editorial text. Any missing global OGP
asset/domain policy remains a separate site-wide concern.

Organization/LocalBusiness structured data and a fully structured address are
future enhancements. About Localization must not invent them as part of this
slice.

## 16. Human gates and implementation order

Architecture is ready now. Subsequent gates are distinct:

1. Architecture approval permits implementation of schemas, repository,
   capability/facade/route contracts, Editor, fixtures, and migration tooling.
2. Real migration generation requires approved Shared hours/contact inputs and
   approved localized inputs, or produces only explicit non-capable temporary
   evidence. It may not infer disputed facts.
3. JA Production cutover requires approved JA statement, display address, four
   alts, approved Shared hours, valid required assets, and a successful JA route
   projection.
4. EN Production cutover independently requires the equivalent approved EN
   content plus approved Shared facts and a successful EN route projection.
5. EN Home additionally requires `/en/about/` availability and every existing
   Home EN capability prerequisite.
6. Header locale-switch exposure requires the separate site-wide
   capability-aware projection implementation.

Unresolved real copy, address, hours, contact links, and alts block migration or
locale cutover as stated; they do not block approval of this architecture.

## 17. Verification target

Implementation verification must eventually cover strict schema ownership,
exact topology, symlink/non-regular rejection, hours invariants, image-slot
cardinality/order/duplicates, asset existence and decoded format, placeholder
isolation, Preview/formal capability matrices, no fallback, route absence,
Home dependency, source/manifest/asset drift, deterministic serialization,
atomic Save rollback/recovery, exact Publish evidence, and Production-equivalent
JA/EN rendering.

This architecture phase itself requires documentation formatting and
`git diff --check` only. Production sources and assets must remain unchanged.
