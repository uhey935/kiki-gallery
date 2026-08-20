# Artists localized medium label — 2026-08-20

## Decision

Artists retain Shared `medium[]` unchanged as canonical
classification/navigation data. Each `ja.md` and `en.md` owns a required,
non-empty `medium_label` used as the only visible medium text on that locale's
Artists index and detail surfaces.

Missing, invalid, empty, or unresolved-placeholder `medium_label` blocks only
the owning locale. Runtime fallback to Shared `medium[]` or the sibling locale
is prohibited.

## Canonical content cutover

The five current development Artist units were updated explicitly with these
approved values:

- JA: `陶芸`
- EN: `Ceramics`

The values were not inferred from Artist identity, biography, or Shared
`medium[]`. The frozen 2026-08-11 migration manifest and historical converter
evidence remain unchanged.

## Verification boundary

The cutover requires strict localized schema and locale-isolation coverage,
Production projection of both `medium[]` and `medium_label`, public and Preview
rendering from `medium_label` only, Editor hydration/serialization coverage,
and confirmation that all five canonical units remain capable in JA and EN.
