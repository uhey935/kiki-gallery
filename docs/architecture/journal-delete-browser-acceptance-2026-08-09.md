# Journal Delete Implementation and Browser Acceptance

| Property | Value                                              |
| -------- | -------------------------------------------------- |
| Status   | Implemented and accepted for Journal only          |
| Date     | 2026-08-09                                         |
| Baseline | `e23667a` (`Finalize Delete safety prerequisites`) |
| Deferred | News, Exhibitions, Artists, and Works Delete       |

## Implemented boundary

Journal Delete consumes the finalized shared contracts without changing any other collection. A server-authored plan binds the exact valid `index.yaml`, `ja.md`, and `en.md` bytes, repository HEAD and branch, Retention Policy commit, complete verified backup generation, closed reference graph, routes, recovery destinations, and retained-asset statement. The browser only displays these facts and requires an explicit checkbox before execution.

Execution rebuilds the plan, acquires the non-stealing content lifecycle lock, rechecks the three-file inventory and full reference graph, persists `prepared` content recovery evidence, and atomically renames the complete directory into `.kiki-editor/content-lifecycle/recovery/<operationId>/src/content/journal/<contentId>/`. Completion becomes a durable terminal `completed` record. A failure after the move renames the exact unit back and records `rolled-back`; uncertain rollback preserves the lock and records `manual-recovery-required`.

No asset path or byte is moved, quarantined, staged, or deleted. Delete Publish is a separate action. It reads the completed evidence, begins with a clean index, stages the three authorized preimage paths explicitly, proves the exact staged-name set and deletion status, and commits without pushing. `.kiki-editor/`, `public/`, unrelated content, Create/Rename evidence, and inferred worktree deletions grant no Publish authority.

## Real browser acceptance

Acceptance ran against a fresh Astro development process and an isolated Git repository. The canonical Production repository and assets were not used as mutation targets.

- An empty backup field kept plan review disabled. A nonexistent generation returned stable fresh-backup guidance.
- A verified generation whose manifest and payload exactly matched the current Journal bytes produced a reviewed plan showing route, Git basis, backup identity, three paths, byte sizes, hashes, zero incoming references, and retained assets.
- `Execute reviewed Delete` remained disabled until explicit confirmation.
- An unrelated unsupported local reference in the initial isolated inventory failed closed with parser-uncertainty guidance. The isolated happy-path inventory was then reduced to the supported fixture.
- Confirmed execution showed durable recovery completion while keeping Publish separate.
- Delete Publish committed exactly three `D` paths and no unrelated file or `.kiki-editor/` path.
- The browser navigated to `/editor/journal/workspace/`; the deleted entry was absent and the console contained no errors.

## Deeper isolated acceptance

Isolated Git-repository tests cover missing/stale exact-byte backup proof, inline incoming Journal reference refusal, plan drift, non-stealing lock conflict, atomic post-move rollback of all three original bytes, durable terminal evidence, recovery-byte presence, and evidence-exclusive Publish while an unrelated worktree change remains unstaged. Shared parser, backup proof, evidence transition, and lock tests remain part of the focused gate.

## Preservation and operations

Preview and Save are disabled by the existing workspace lock while Delete is active. Ordinary Journal Publish remains unchanged; only the Delete panel invokes Delete Publish. A failed or uncertain operation uses stable browser guidance. `rollback-failed` is an Editor-wide stop state: preserve the content lifecycle lock, operation record, and recovery bytes, then reconcile manually before any writer continues.

Production loaders, canonical Production content, `public/`, Asset Lifecycle v2, and all non-Journal Delete behavior remain unchanged. Restore, content recovery evidence disposal, asset inference, cascade, force Delete, and automatic push remain prohibited.
