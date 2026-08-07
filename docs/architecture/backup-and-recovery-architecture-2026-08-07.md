# Backup & Recovery Architecture / Tooling

| Property | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| Date     | 2026-08-07                                                                           |
| Scope    | Editor v1 production inputs and Editor-only durable state                            |
| Boundary | Operator CLI only; no HTTP route, scheduler, retention deletion, or remote transport |

## Protection model and scope

Git remains authoritative for committed canonical content and assets. A pushed commit protects `src/content/` and `public/images/` against workstation loss. Git does not protect uncommitted Save results, unpushed commits, ignored `.kiki-editor/` state, or quarantined bytes moved out of `public/images/works/`.

One explicit generation therefore captures `src/content/`, `public/images/`, and `.kiki-editor/` together. This includes all Collection content and production images plus candidate ledgers, quarantine records and bytes, deletion manifests, durable recovery evidence, and repository-lock evidence when present. Git HEAD and branch are recorded as context. `.git/`, dependencies, build output, preview tokens, and the operating system are excluded. The destination must be outside the repository so it cannot recurse or become Production input.

## Format and integrity

Each immutable backup directory contains `manifest.json` and `payload/`. The schema-versioned manifest lists every regular file with repository-relative path, SHA-256, byte size, mode, creation time, roots, missing roots, Git context, and whether a lock was captured. Symbolic links and special files fail creation. A generation is staged in a sibling temporary directory and renamed only after all writes complete.

`verify` rejects malformed, duplicate, escaping, or out-of-scope paths, requires regular non-symlink payload files, and recomputes every size and SHA-256. Restore always verifies first. Archive packaging, encryption, remote copying, credentials, and storage availability remain operator responsibilities.

Creation is an offline operator action: stop the Editor and every lifecycle writer first, then create and verify the generation before resuming. The CLI does not claim transactional consistency across independent filesystem reads while a writer is active.

## Restore model

The safe default restores only `.kiki-editor/`, after Git has restored the repository at the recorded commit. `--include-canonical` additionally replaces `src/content/` and `public/images/` exactly; it is reserved for disaster recovery of uncommitted or unavailable canonical bytes.

Restore stages all selected bytes, moves current roots to rollback locations, then installs complete roots. A filesystem failure attempts to return every moved root. Files absent from the selected generation disappear through exact root replacement, preventing mixed evidence generations.

A current lifecycle `repository.lock` blocks restore because its owner may still be mutating state. A lock captured in a backup is integrity-checked and retained there as evidence, but never restored as active: ownership and expiry cannot cross a recovery event safely. Inspect its owner record and reconcile assets, ledger, quarantine records, and manifests. Preserve the backup as stop-state evidence rather than manufacturing lock ownership.

## Failure handling

- Creation failure removes the staged generation and leaves no completed destination.
- Verification failure forbids restore; never edit a manifest to make corrupt bytes pass.
- A current lock requires lifecycle manual recovery before restore.
- Restore failure reports a conflict after rollback. Preserve both backup and repository and inspect each root before retrying.
- A restored `manual-recovery-required` manifest remains durable stop-state evidence.
- Successful restore does not prove application validity. Run focused verification, Editor and Journal tests, Astro check, and build before mutation or release.

## Retention-policy boundary

This milestone only creates, verifies, and restores explicit generations. It does not choose a schedule, minimum generation count, quarantine expiry, deletion age, encryption regime, storage provider, or automatic pruning. Asset quarantine retention is not backup retention. No physical delete should proceed unless a separately approved operator policy confirms that an independently stored, verified generation contains the quarantined bytes and complete evidence set.

Until policy governance exists, preserve milestone, pre-quarantine, pre-physical-delete, and manual-recovery generations. Backup expiry and deletion remain explicit operator decisions outside this CLI.

## Disaster recovery

1. Stop Editor and lifecycle writers. Preserve the damaged repository and lock evidence.
2. Recover Git into a new local repository at the manifest's HEAD when available; verify branch and remote separately.
3. Run `npm run backup -- verify <backup-directory>` on an independent copy.
4. Run default restore for Editor state. Add `--include-canonical` only when canonical content/assets cannot be recovered from Git or the generation intentionally contains later Save work.
5. Compare canonical changes with the recorded Git HEAD. Inspect captured lock, quarantine bytes/records, ledger, and prepared or manual-recovery manifests as one evidence set.
6. Run Editor tests, Journal tests, Astro check, and production build. Compare production content/assets with the backup manifest and intended Git state.
7. Resume localhost-only Editor operation only after reconciliation. Review any recovered diff before committing or pushing.

## Preserved boundaries

No create/delete/rename feature, browser action, Production route, remote upload, scheduler, automatic retention, physical-delete authorization, Content Model change, or Asset Lifecycle semantic change is introduced. The CLI is an operator tool run from the repository root and does not broaden the localhost-only Editor boundary.
