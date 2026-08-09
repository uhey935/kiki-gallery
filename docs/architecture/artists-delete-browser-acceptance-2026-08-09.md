# Artists Delete Browser Acceptance — 2026-08-09

## Scope

Artists Delete only, following the finalized Journal, News, and Exhibitions Delete contract. Works Delete and asset lifecycle behavior remain deferred and unchanged.

## Safety contract verified

- A verified pre-delete backup generation must contain bytes exactly matching the complete current Artist content unit.
- The canonical graph is inventoried fail-closed. Typed `Works.artist`, `Exhibitions.artists[]`, known `News.link`, supported Markdown routes, unresolved target routes, unreadable entries, unsupported files, and symlinks either block Delete or produce parser uncertainty.
- Execution accepts only an identity-bound reviewed plan after explicit confirmation, rechecks drift and references, and acquires the non-stealing content lifecycle lock.
- The complete Artist Markdown unit moves atomically to recovery. Assets remain byte-for-byte at their existing paths and are never inferred as deletion candidates.
- Durable evidence reaches `completed`, `rolled-back`, or `manual-recovery-required`. Rollback proves restored size and SHA-256 before releasing the lock.
- Delete Publish accepts only completed Artists evidence and stages exactly its authorized canonical deletion path.

## Real browser acceptance

Run against an isolated Git repository and verified canonical backup generation using the local Editor.

- Backup path empty: Review disabled.
- Exact backup supplied: reviewed plan displayed identity, Git basis, backup ID, byte size, SHA-256, empty incoming-reference result, and retained-assets policy.
- Before checkbox confirmation: Execute disabled. After confirmation: Execute enabled.
- Happy path: canonical Artist moved to recovery and durable completed evidence created.
- While Delete was active/completed: Artist form editing, Preview, Save, and ordinary Publish remained blocked.
- Delete Publish: committed only `src/content/artists/delete-me.md`; asset files and unrelated paths were not staged.
- Successful Publish navigated to `/editor/artists/workspace/`.
- Full canonical graph refusal: an unresolved internal reference produced stable `parser-uncertainty` guidance without mutation.
- Browser console errors: 0.

## Deeper isolated coverage

Focused tests cover stale backup bytes, typed incoming News refusal, unsupported internal-route uncertainty, reviewed-plan drift, non-stealing lock conflict, evidence-limited Publish with unrelated working-tree changes, byte-for-byte rollback, and manual-recovery evidence with preserved lock after rollback failure.

Result: 6/6 focused Artists Delete tests passed.
