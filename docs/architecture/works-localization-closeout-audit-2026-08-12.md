# Works Localization Closeout Audit

| Property | Value |
| --- | --- |
| Status | Complete |
| Date | 2026-08-12 |
| Authority | [Works Localization Architecture](./works-localization-architecture-2026-08-12.md) |

## Documentation inventory

### A. Current authority

- `works-localization-architecture-2026-08-12.md`
- `content-model-specification.md`
- `README.md` reading order

### B. Current supporting evidence

- `tests/browser/works-lifecycle.spec.ts`: isolated Create, JA Preview, Save,
  Publish, Edit, Asset Replace/Cancel, Rename, and Delete fail-closed acceptance.
- `works-asset-manager-architecture-and-safety-specification.md` remains useful
  for asset safety history but is not current topology authority.
- Asset Lifecycle v2, backup/recovery, retention, and delete-safety documents
  remain current for their cross-cutting contracts.

### C. Historical / superseded

- Works Asset Manager flat-runtime specification.
- Works Rename asset semantics and browser acceptance dated 2026-08-09.
- Works Delete asset semantics and browser acceptance dated 2026-08-09.
- Collection Framework, Editor platform/finalization, lifecycle readiness, and
  earlier browser documents that explicitly describe a flat Work. These are
  retained as chronological design and safety evidence; their Works topology is
  superseded by the current authority.

### D. Corrected stale material

- Current authority status and runtime statements.
- Architecture reading order and Content Model Works ownership/topology.
- Operator-facing Create/Delete wording that implied one Work Markdown file.

### E. Migration / rollback evidence — retain unchanged

- `../migrations/works-localization-manifest-2026-08-12.json`
- Works converter, executor, migration tests, original bytes, target hashes,
  rollback evidence, and asset-invariance evidence.

## Runtime and Editor audit

Production uses `worksLocalized` through the Works Production facade. There is
no Production `getCollection("works")`, flat glob loader, flat canonical
fallback, locale fallback, or external localized-entry ID. JA and EN capability
are independent; an EN-non-capable Work has no EN route.

Editor Create, Load, Preview, Save, Publish, Rename, and Delete operate on the
exact `index.yaml`, `ja.md`, and `en.md` unit. Legacy/mixed inventory handling is
read-only and fail-closed. Reference scanners consume canonical Content IDs;
the asset scanner consumes only Shared `images[].src` and does not count
localized alts.

The internal names `FlatCreateWorkspace` and `flatCreateRoute` are intentional
cross-collection control-plane names. They dispatch to the Works-owned
three-file adapter and are not flat Works runtime dependencies.

## Contracts and retained evidence

- `Work.index.artist`, Artist `works_layout[].works[]`, and Exhibition
  `works[]` store canonical Content IDs.
- Markdown and News references store `/works/<contentId>` routes, never
  `ja::<contentId>` or `en::<contentId>`.
- Shared image sources align exactly by index with JA and EN alts. Shared has no
  alt, localized files have no src, duplicate Shared src is rejected, Reiko 01
  retains four ordered sources, Replace preserves both alts, and there is no
  persistent image ID.
- Localization does not alter canonical asset URL, bytes, hashes, candidate
  ledger, quarantine, deletion manifest, retention, locks, no-overwrite,
  replacement, or Publish evidence contracts.
- `.works-create-recovery-<contentId>.json` is durable evidence for an uncertain
  Create. It records target paths, intended/observed hashes and lengths,
  rollback failure, and `manualRecoveryRequired`; surviving state blocks
  same-ID recreation until manual reconciliation is independently verified.

## Legacy classification and deletion decision

Flat Works matches are classified as historical documents/tests, immutable
migration/recovery tooling, or read-only fail-closed detection. No candidate
proved all deletion requirements (zero references, no runtime or safety role,
and no historical/recovery value), so this audit deletes no legacy code or
evidence.

Known Journal/Home navigation timeouts are tracked separately from the isolated
Works browser acceptance and do not change the Works verdict.
