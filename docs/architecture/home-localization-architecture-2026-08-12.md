# Home Localization Architecture

**Status:** Implementation-ready target  
**Date:** 2026-08-12  
**Runtime status:** Not migrated, not Production-cutover, and not Editor-localized

This document is the target authority for localizing the singleton Home Content
Unit. It is an implementation contract, not a description of the current
runtime. The current runtime remains the corrected flat
`src/content/home/home.md` source until an evidenced migration and separate
Production cutover are completed.

## 1. Scope and invariants

- Canonical Content ID is `home`; Home remains a singleton composition layer.
- Home is not generalized into a multi-entry collection.
- Production content and asset bytes are outside this architecture phase.
- Home has no Create, Rename, or Delete lifecycle.
- Locale fallback, generated prose, and generated translation are prohibited.
- Existing Home routes and the current Editor remain authoritative until their
  separately approved replacements cut over.

## 2. Canonical topology

The target inventory is exactly:

```text
src/content/home/home/
├── index.yaml
├── ja.md
└── en.md
```

The directory name supplies Content ID `home`; files must not duplicate it.
Load, Save, migration, and Publish validation fail closed for any missing or
extra file, symlink, or mixed presence of the legacy `home.md` and target
directory. The exact three-file shape is one atomic Content Unit.

## 3. Shared state

`index.yaml` uses a strict named-section object. The target shape is:

```yaml
home_hero:
  media:
    type: image # image | video
    image: /images/home/custom-hero.webp # optional; conditional on type
    video: /videos/home/custom-hero.mp4 # optional; conditional on type
    poster: /images/home/custom-hero-poster.webp # optional video poster

sections:
  artists:
    destination: artists
    image:
      src: /images/home/artists-square.jpg
  about:
    destination: about
    image:
      src: /images/home/about-landscape.jpg
```

`home_hero` is optional. Its `media` is a strict discriminated image/video
object: `image` is required only for `type: image`; `video` is required only for
`type: video`; `poster` is permitted only for video. Unknown fields fail.

The official composition is always Artists then About. Object serialization
order is not semantic authority and arbitrary reordering is not a promised
capability. Section identities, logical destinations, the design labels
`Artists` and `About`, section images, and hero media identity are Shared.
Locale-specific URLs and duplicate localized labels are not stored.

Responsive landscape/square/portrait variants are not part of this contract.
Each section retains its one corrected canonical image.

### Obsolete `home_hero.layout`

`home_hero.layout` has no Production or Preview consumer, canonical value, or
defined behavior. It is omitted from the target. Migration tooling must reject
or explicitly flag unexpected legacy `layout` input and must not silently carry
it forward.

## 4. Localized state

Both `ja.md` and `en.md` have YAML frontmatter and no Markdown body:

| Field         | Type             | Required | Owner       |
| ------------- | ---------------- | -------- | ----------- |
| `about_intro` | non-empty string | Yes      | Home locale |
| `seo_title`   | non-empty string | No       | Home locale |
| `description` | non-empty string | No       | Home locale |

No body is introduced merely for symmetry: Home remains component-driven.
There are no `hero_alt`, `artists_image_alt`, or `about_image_alt` fields.

`about_intro` is independently owned by Home. It is neither a facade over the
About page nor a duplicate of its full statement. The old hard-coded GALLERY
crossing copy is obsolete residue and is not a migration source. A human-written,
current KiKi Gallery JA introduction is required before real migration; a
human-written EN introduction is required before EN capability. AI prose and AI
translation cannot become canonical automatically.

## 5. Accessibility

- Hero media is decorative and renders with `alt=""`; the visible
  `KiKi Gallery` heading names the page and brand.
- Artists and About images are decorative and render with `alt=""`; their link
  or section-title context supplies the accessible name.
- Cards must retain accessible link/DOM semantics. `aria-labelledby` may bind a
  card to its visible section title when needed.

If media later becomes informational, semantic alt is an architecture change,
not a reason to create fictional localized fields now.

## 6. SEO and OGP

`seo_title` and `description` are optional and do not block locale capability.
Their deterministic fallback is `KiKi Gallery`. This description fallback is
technically valid but editorially low quality; human JA and EN descriptions
belong on the release checklist. Prose must not be generated automatically.

Home must not depend on the currently missing `/default-og.jpg`. Emit
`og:image` only for a separately valid explicit OGP image, or use a future valid
global default once the site-wide SEO policy supplies one. The hero is never
silently promoted to OGP. Global default OGP correction is a separate follow-up.

## 7. Locale capability and route publication

JA Home is capable only when all are true:

1. Shared state is valid.
2. `ja.md` is valid and has a human-approved `about_intro`.
3. Required shared assets exist.
4. Required JA destination routes are available.
5. every destination projection succeeds; and
6. no required placeholder remains unresolved.

EN applies the same rules to `en.md`, additionally requiring render-capable
`/en/about/` and `/en/artists/` while those destinations remain required. There
is no cross-locale fallback. A non-capable locale has no Home route.

`/en/` is generated only when EN Home capability is true. Merely adding a page
source does not publish a route, and partial or placeholder Home must remain
absent. The future Astro boundary must compute capability before returning a
static path (or equivalent route output); this document does not implement it.

About is a required composition element. If `/en/about/` is unavailable, EN
Home is non-capable and `/en/` remains absent. The About section cannot be
omitted to force publication and must never link from EN Home to JA `/about/`.

## 8. Destination and site-wide locale projection

Shared Home stores logical identities. Projection owns URLs:

| Identity  | JA          | EN             |
| --------- | ----------- | -------------- |
| `artists` | `/artists/` | `/en/artists/` |
| `about`   | `/about/`   | `/en/about/`   |

The site-wide boundary is conceptually:

```ts
type LocaleRouteDecision =
  | { kind: "available"; href: string }
  | { kind: "unavailable" };

projectLocaleRoute(/* route identity, Content ID if any, target locale */)
  : LocaleRouteDecision;
```

It must cover Home; Artists index/detail; Exhibitions index/detail; Works
detail; News index; Journal index/detail; About; Privacy; and unknown/404.
Detail projection is available only when the same canonical Content ID is
capable in the target locale.

The Header shows a locale switch only for an available counterpart. It must not
blindly prefix a pathname, always point EN to `/en/`, or fall back to another
locale. This global boundary may be implemented before or alongside cutover,
but is required before EN Home is publicly linkable; Home does not own the
global implementation.

## 9. Dynamic composition boundaries

JA consumes JA facades. EN consumes only EN-capable children, never JA
fallbacks. Empty children do not block the Home route:

- zero Featured Exhibitions omits the entire section;
- zero Stories omits the entire section;
- the static Artists card renders only when its destination is capable; and
- individual dynamic cards render only when their entries are locale-capable.

Empty list UI is not rendered to preserve a heading.

The Exhibitions facade is the single featured-selection authority. It returns
already selected, locale-aware entries; Home must not duplicate status,
grouping, sorting, or selection rules.

Stories use one boundary:

```text
News + Journal
→ locale-capable entries
→ normalized Home story projection
→ descending date sort
→ at most 6
```

Routes and images are locale-aware projections. Raw source strings cannot
bypass capability. Existing Artist-News link responsibility fragmentation must
be resolved through the Home/News projection boundary rather than page-local
URL logic.

## 10. Hero and static assets

When no custom hero is configured, the shared fallback remains
`/images/home/fallback-hero.webp`. Strictly validated custom image and video
media remain supported and decorative. Media behavior is Shared and is not
localization-owned; `layout` does not return.

Home assets remain simple static references. Localization adds no Works-style
asset manager, upload/replace lifecycle, quarantine, candidate ledger, or asset
Publish manifest. Migration must not rename, re-encode, copy, or derive assets;
current URLs and bytes are preserved.

`artists-square.jpg` and `about-landscape.jpg` currently contain WebP bytes.
That mismatch is accepted compatibility input and must not be normalized during
localization. Filename/format hygiene is separate future work.

## 11. Editor target

Home remains a singleton Editor with Shared, JA, and EN drafts over the exact
three-file baseline. Shared, JA, and EN dirty state is independent, as are JA
and EN Preview capability decisions.

The supported lifecycle is Load, Preview, Save, and Publish. Create, Rename,
and Delete do not exist. Save atomically installs `index.yaml`, `ja.md`, and
`en.md`, rolling back the entire unit on failure. Publish accepts exact
three-file evidence only and rejects drift or any other path.

Preview must use Production-equivalent facades and projections, with no locale
fallback, for hero, Artists, About, intro, Featured Exhibitions, Stories, route
projection, locale capability, and SEO metadata where practical.

This is the Editor target only; the current Editor is not changed in this phase.

## 12. Migration and rollback contract

Migration converts the one singleton `src/content/home/home.md` into the exact
three target files. Its immutable evidence must include:

- source SHA-256, byte length, and `originalBase64`;
- exact target bytes and SHA-256 values;
- explicit source-to-target mapping decisions;
- current Home asset inventory and hashes; and
- byte-exact rollback material and instructions.

No asset mutation is permitted. The migration must validate the source shape,
reject unexpected `home_hero.layout`, require a clean recognized topology, and
install all targets atomically.

Tooling and fixture-only reserved placeholders may be built before editorial
copy exists. Real canonical migration is blocked until the required
human-approved JA `about_intro` exists. It cannot treat partial output as
canonical.

EN tooling/fixtures may reserve an explicit placeholder only for required
`about_intro`. Optional SEO fields should remain absent unless a test needs to
distinguish absence. Final JA migration permits no placeholder; EN capability
and cutover permit none. No AI translation or generated copy is accepted.

## 13. Dependencies and release gates

About Localization is not a blocker for this architecture, migration tooling,
or necessarily a JA-only migration. It is a blocker for EN Production cutover
because `/en/about/` is required. It should be completed as a separate phase
before Home EN cutover.

Capability-aware Header projection is a global prerequisite for publicly
linkable EN Home, but it is not owned by Home. Human content gates are:

- JA: current, human-approved Home `about_intro` before real migration.
- EN: human-approved Home `about_intro`, and all EN dependencies capable,
  before `/en/` publication.

## 14. Deferred, non-blocking follow-ups

- valid global OGP default;
- asset filename/format hygiene;
- responsive image system;
- Home asset manager;
- structured dynamic-section configuration;
- alternative section ordering; and
- semantic custom-hero alt if hero media becomes informational.

These do not expand the present implementation contract.

## 15. Implementation verdict

The architecture is **implementation-ready**. This verdict authorizes later,
separately reviewed tooling and implementation work; it does not claim that the
target is migrated, live in Production, or available in the localized Editor.
Real migration and EN cutover remain subject to the explicit human content and
route dependency gates above.

## 16. Migration foundation record

The reusable Home schemas, exact-three-file repository, capability primitives,
deterministic converter, dry-run manifest builder, and isolated-fixture executor
are implemented under `src/content-loaders/home/`. They are not connected to
the Production loader, routes, or Editor.

The frozen structural evidence is
[`home-localization-manifest-2026-08-12.json`](../migrations/home-localization-manifest-2026-08-12.json).
It binds the current source and asset bytes plus rollback evidence, while
honestly recording final target hashes as pending human input. Its
`realMigrationAllowed` value remains `false`; this foundation record does not
change the target-only status of this architecture.
