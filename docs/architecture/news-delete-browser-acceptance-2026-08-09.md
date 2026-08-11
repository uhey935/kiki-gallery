# News Delete Implementation and Browser Acceptance

## Accepted boundary

News Delete is the second collection-specific Delete slice. It consumes the finalized shared Delete prerequisites and the proven Journal lifecycle without changing Journal, Exhibitions, Artists, or Works Delete behavior. News is one canonical three-file unit (`index.yaml`, `ja.md`, and `en.md`) and has no public detail route; the reviewed server plan binds those exact files, repository identity, verified backup generation, closed reference graph, recovery destination, and retained-asset statement.

Execution rebuilds the reviewed plan, acquires the non-stealing content lifecycle lock, rechecks bytes and references, persists `prepared` recovery evidence, and atomically renames the unit directory into `.kiki-editor/content-lifecycle/recovery/<operationId>/src/content/news/<contentId>/`. It records `completed`, `rolled-back`, or `manual-recovery-required` as a durable terminal result. Assets are never moved or inferred for deletion.

Delete Publish accepts completed News evidence only, requires a clean index and unchanged repository identity, stages exactly the three files under `src/content/news/<contentId>/` as deletions, commits them, and leaves unrelated working-tree files unstaged. It never pushes.

## Acceptance evidence

Isolated Git repository tests cover exact-backup gating, unresolved-reference refusal, reviewed-plan drift, non-stealing lock conflict, atomic recovery move, byte-for-byte rollback, manual-recovery lock retention, durable evidence, and three-path-only Publish. The browser contract exposes the stable News endpoint and operator guidance for stale backup proof, references/parser uncertainty, drift, lock conflict, and rollback failure. The workspace disables Preview, Save, ordinary Publish, form mutation, and concurrent Delete controls while Delete owns the UI lifecycle; execution requires review plus explicit checkbox confirmation and successful Publish navigates to the News list.

The three-file News Delete browser acceptance is complete. The Editor browser suite binds a disposable three-file News fixture and completes the full lifecycle in one isolated repository: Create → Preview → Save → Publish → Rename → Publish → Delete → Delete Publish. The flow verifies the reviewed Delete plan, explicit confirmation, successful three-file recovery move, Delete Publish, and navigation back to the News workspace without mutating Production content.

The legacy one-file News read and write paths have been removed from the Editor. The only remaining legacy-format handling is read-only, fail-closed safety detection: a legacy flat Markdown collision or reference discovered during Create, Rename, Delete, or reference-graph review blocks the operation instead of being loaded, edited, or rewritten. Lock conflict, byte drift, rollback, and manual-recovery terminal behavior remain isolated repository-test responsibilities because injecting those filesystem races through the browser would weaken the reviewed operation boundary.

The frozen News migration manifest and its complete rollback evidence remain retained. Migration tests reconstruct isolated legacy fixtures from the frozen original bytes and continue to verify source hashes, generated three-file hashes, byte lengths, and rollback integrity without restoring legacy files to canonical content.

Production loaders, canonical Production content and assets, Asset Lifecycle v2, and all non-News Delete implementations are unchanged. News-like internal routes are unsupported by the current route registry and therefore fail closed as parser uncertainty rather than being treated as a resolvable News detail reference.
