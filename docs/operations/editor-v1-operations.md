# Editor v1 Operations

## Safe start

1. Use Node.js 22.12.0 or newer and run `npm ci`.
2. Confirm `git status --short` is empty, the intended branch is checked out,
   and it has the intended upstream.
3. Run `npm run dev`, then open `/editor/`.
4. Select one existing Content ID. Check the initial values and confirm the
   action status is saved, not dirty.
5. Use Draft Preview before Save. Preview tokens expire, are bound to their
   Content ID and locale, and are local development state only.
6. Save first, review the repository diff, then Publish. Publish stages only
   the selected Content Unit and the exact saved Works asset manifest.

Command/Ctrl+S invokes Save when Save is available. While Save, Preview,
Upload, or Publish is pending, the full form and every action are locked.

## Publish and recovery

Publish requires a clean safe repository, attached branch, matching upstream,
no unrelated staged files, a saved baseline, and publishable validation.

- `canonical-mismatch`: stop and reload. Reconcile the external change before
  reapplying the draft.
- commit failure before a commit exists: preserve the working tree, inspect Git
  state, and retry only after the cause is understood.
- `committed-push-failed`: the commit exists locally. Stop using that workspace,
  record the commit shown by the UI, inspect branch/upstream state, and push the
  existing commit manually. Do not Save or Publish again from the stale page.
- `journal-save-rollback-failed` or `asset-save-rollback-failed`: stop all Editor
  mutation. Preserve the working tree and `.kiki-editor` evidence, compare the
  selected canonical files/assets with Git and the recorded baseline, restore
  a consistent unit manually, then reload.

Never discard or overwrite recovery evidence merely to clear a lock.

## `.kiki-editor` and Asset Lifecycle v2

`.kiki-editor/` is ignored by Git and is never production input. It may contain
temporary uploads and durable asset-lifecycle state: candidate ledgers, locks,
quarantine records and bytes, and deletion manifests.

- Keep it on reliable local storage with repository-scoped access.
- Back it up together with the repository before any quarantine or physical
  delete operation. A ledger or manifest proves history but cannot reconstruct
  physically deleted bytes.
- Preserve durable ledger, quarantine record, deletion manifest, and lock as
  one evidence set. Do not copy only selected files between repositories.
- A retained lock or `manual-recovery-required` manifest stops all lifecycle
  mutation until an operator reconciles actual bytes and evidence.
- Physical delete has no browser UI or HTTP route in v2. It remains an explicit
  operator procedure with a positive retention period, two observations, a
  fresh locked review, and per-asset confirmation. Do not perform destructive
  asset operations during ordinary browser acceptance.

## Release check

Before a release milestone, run Editor and Journal tests, Astro check, a
production build, Prettier check, and `git diff --check`. Confirm `dist/`
contains no Editor mutation/API routes or Draft Preview artifacts, and compare
canonical content/assets with the captured pre-check hashes.

## Documentation reading order

1. This operations guide.
2. `docs/architecture/editor-v1-finalization-2026-08-07.md`.
3. `docs/architecture/editor-v1-release-readiness-2026-08-07.md`.
4. `docs/architecture/journal-architecture-current.md` for Journal.
5. `docs/architecture/works-asset-manager-architecture-and-safety-specification.md`.
6. The three Asset Lifecycle v2 milestone documents for quarantine and delete
   details. Older prototype and migration documents are historical evidence.
