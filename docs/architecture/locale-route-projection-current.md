# Locale Route Projection — Current Architecture

| Property | Value                                                    |
| -------- | -------------------------------------------------------- |
| Status   | Implemented / current authority                          |
| Date     | 2026-08-18                                               |
| Scope    | Public locale counterpart routing and Header consumption |

## Boundary and dependency direction

`src/content-boundaries/locale-routes.ts` is the single public counterpart
projection boundary. The dependency direction is:

```text
Header -> locale-routes -> public route-family authority
                        -> collection/singleton Production facades
                        -> existing route registries
```

The boundary never imports UI, layouts, pages, or Editor modules. Production
facades are loaded only when a capability-gated surface reaches that check.

## Logical identity and parsing

Supported identities are Home; Artists index/detail; Exhibitions index/detail;
Work detail; News index; Journal index/detail; About; and Privacy. News has no
detail identity and Works has no index identity. Detail identity uses the
canonical lowercase kebab-case Content ID, never an Astro Store ID such as
`ja::<id>` or `en::<id>`.

Input accepts paths with or without a trailing slash and ignores query/hash.
Only the complete first `en` segment selects English; `/enough/` and `/energy/`
are not English paths. Unknown, malformed, extra-segment, Editor, API, preview,
asset, and 404 paths have no public identity.

## Availability and projection

Three conditions are distinct:

1. **Route-family existence**: `public-route-families.ts` records whether a
   public Astro page implementation exists for that surface and locale.
2. **Locale capability**: the collection or singleton Production facade decides
   whether the target-locale content is formally usable. Detail identities and
   formal singleton targets require this capability, except for the explicit JA
   Home/About development-projection fallback described below. An index does
   not infer availability from entry counts.
3. **Static path generation**: Astro emits the paths returned by each page's
   `getStaticPaths` (or the concrete static page). A detail page implementation
   can exist while a particular entry's path is omitted for lack of capability.

Projection requires route-family existence and, where applicable, target-locale
capability. It returns an exact canonical counterpart URL or `unavailable`;
there is no unrelated root-Home, source-locale, or first-entry fallback.

Home and About retain an explicit JA development-projection fallback when
formal capability is not satisfied. When formal capability succeeds, the
formal JA projection takes precedence. EN has no equivalent development
fallback and requires formal capability for projection and static path
generation.

This describes locale counterpart projection. In page rendering, `/` requires
formal JA Home capability; `/about/` uses the formal JA entry first and falls
back to `developmentJa()` only when formal capability is not satisfied. EN
Home and About static paths are emitted only for formal-capable entries.
Privacy is static route existence only.

All emitted public URLs use the trailing-slash convention. JA and EN Journal
index and detail page families are implemented. The index route is generated
independently of entry count; each detail path is generated only for entries
returned by the Journal Production facade for that locale. The Journal registry
formats the corresponding canonical JA/EN detail URLs.

## Header behavior

The Header detects locale through the shared parser and requests the opposite
locale projection for the current logical identity. It renders a counterpart
anchor and separator only when available; otherwise it retains only the current
language indication. It never fabricates `/en/` or `/` as a locale fallback.

Global navigation uses the same projector for the current locale. The EN
Artists, Exhibitions, News, and Journal index route families are implemented.
EN Home and About are generated only when their formal singleton capability is
true. Privacy has static JA and EN implementations but is not a global-nav
item. The logo uses the current locale Home when available and the existing JA
Home otherwise. Shop remains an external non-localized destination. Works
continues without a Header by design, while its route identity remains
supported for future consumers.

## Capability-gated EN routes

Home and About have implementations in
`src/pages/en/[...singleton].astro`, but that page emits each route only when
the corresponding singleton Production facade returns formal capability.
Journal detail similarly emits only capable EN entries. These gates do not
change route-family existence. The Journal and Privacy EN page implementations
are present; Privacy is a static page and does not depend on content capability.
