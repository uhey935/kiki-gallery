# Works Rename Implementation and Browser Acceptance Closure

> **Historical / Superseded:** This is retained flat-runtime browser evidence.
> Current three-file Rename and full lifecycle acceptance are tracked by
> [Works Localization Architecture](./works-localization-architecture-2026-08-12.md).

| Property | Value                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Status   | Historical / superseded flat-runtime acceptance                                |
| Date     | 2026-08-09                                                                     |
| Scope    | Reference-aware Works Rename and evidence-limited Publish                      |
| Excluded | Delete, Production loaders, asset moves/deletes, canonical production mutation |

## Implemented boundary

Works Rename now moves one byte-identical `src/content/works/<id>.md` unit and
byte-preservingly rewrites exact Artist `works_layout[].works[]` and Exhibition
`works[]` references. Execution requires a server-authored reviewed plan and an
explicit confirmation, acquires the content lifecycle lock before the Asset
Lifecycle v2 repository lock, revalidates the complete prospective graph, and
records durable preimages, staged identities, lock ownership, and completed
steps. Any failed installation restores every content/reference byte and proves
asset and lifecycle metadata remained unchanged.

Candidate-ledger writes now participate in the existing Asset Lifecycle v2
repository lock. This is coordination only: ledger schema, ownership identity,
retention, quarantine, deletion, and recovery state transitions are unchanged.

Rename Publish reads one completed operation record and stages only its exact
old/new Work paths and planned Artist/Exhibition edits. It verifies the old path
is a deletion, the new Work bytes match the old Work identity, and each staged
reference matches its prospective hash. Rename Publish rejects an asset
manifest and never infers, materializes, moves, deletes, or stages assets or
`.kiki-editor/` evidence.

## Real browser acceptance

Acceptance ran against two isolated Git repositories with local bare remotes;
canonical production content and public assets were not mutated.

- Collision `reiko-kinoshita-02` visibly failed closed.
- The reviewed plan displayed `reiko-kinoshita-01 → browser-accepted-work`,
  the old/new routes, and the exact Artist and Exhibition edits.
- Execute remained disabled before confirmation and enabled only after the
  exact-plan checkbox was selected.
- Execute transitioned the URL to the renamed Works workspace and displayed
  the asset-unchanged result.
- Artist and Exhibition workspaces visibly contained the new Work ID.
- All four image URLs remained the original `/images/works/reiko-kinoshita-*`
  URLs.
- Rename-after-workspace Preview emitted no browser error; Save remained
  available and completed after Publish.
- A held Asset Lifecycle repository lock visibly refused execution.
- Evidence-limited Publish completed and its commit contained exactly:
  `src/content/works/reiko-kinoshita-01.md` deletion,
  `src/content/works/published-browser-work.md` addition, and the exact
  Artist/Exhibition edits. It contained no public asset or `.kiki-editor/` path.

## Deeper isolated acceptance

Node tests cover case-fold/exact collision, non-empty unpublished asset manifest,
asset lock conflict, canonical/Git plan drift, symlinked asset root, injected
multi-file installation failure, byte-for-byte rollback, asset byte/path
identity, and the exact Rename Publish commit boundary.
