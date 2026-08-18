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

Projection requires the target route family to exist according to
`public-route-families.ts`. Detail and formal singleton surfaces additionally
require their existing target-locale Production capability. Index availability
is never inferred from entry counts. The result is either an exact canonical
counterpart URL or `unavailable`; there is no Home, source-locale, or first-entry
fallback.

Current intentional JA development routes for Home and About remain valid JA
targets despite not being formally publishable. Their EN implementations exist
behind one conditional static-path page, but targets still require formal
capability before projection or generation. Privacy is static route existence
only.

All emitted public URLs use the trailing-slash convention. Journal's registry
may format reserved future EN strings, but EN Journal remains unavailable until
its page-family authority changes in the separate publication phase.

## Header behavior

The Header detects locale through the shared parser and requests the opposite
locale projection for the current logical identity. It renders a counterpart
anchor and separator only when available; otherwise it retains only the current
language indication. It never fabricates `/en/` or `/` as a locale fallback.

Global navigation uses the same projector for the current locale. Existing EN
Artists, Exhibitions, and News routes are linked. EN Home and About remain
unlinked while formal capability is false; Journal and Privacy remain
unimplemented. The logo uses the current
locale Home when available and the existing JA Home otherwise. Shop remains an
external non-localized destination. Works continues without a Header by design,
while its route identity remains supported for future consumers.

## Current unavailable EN routes

- Home (implementation present; formal activation false)
- Journal index and detail
- About (implementation present; formal activation false)
- Privacy

Implementation availability is static architectural truth. Formal activation
comes from the singleton Production facade. Projection requires both, so the
mere presence of `src/pages/en/[...singleton].astro` cannot expose a Header
link or build a route.
