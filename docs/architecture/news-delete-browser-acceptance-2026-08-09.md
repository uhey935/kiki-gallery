# News Delete Implementation and Browser Acceptance

## Accepted boundary

News Delete is the second collection-specific Delete slice. It consumes the finalized shared Delete prerequisites and the proven Journal lifecycle without changing Journal, Exhibitions, Artists, or Works Delete behavior. News is one canonical Markdown file and has no public detail route; the reviewed server plan binds that exact file, repository identity, verified backup generation, closed reference graph, recovery destination, and retained-asset statement.

Execution rebuilds the reviewed plan, acquires the non-stealing content lifecycle lock, rechecks bytes and references, persists `prepared` recovery evidence, and atomically renames the file into `.kiki-editor/content-lifecycle/recovery/<operationId>/src/content/news/<contentId>.md`. It records `completed`, `rolled-back`, or `manual-recovery-required` as a durable terminal result. Assets are never moved or inferred for deletion.

Delete Publish accepts completed News evidence only, requires a clean index and unchanged repository identity, stages exactly `src/content/news/<contentId>.md` as one deletion, commits it, and leaves unrelated working-tree files unstaged. It never pushes.

## Acceptance evidence

Isolated Git repository tests cover exact-backup gating, unresolved-reference refusal, reviewed-plan drift, non-stealing lock conflict, atomic recovery move, byte-for-byte rollback, manual-recovery lock retention, durable evidence, and one-path-only Publish. The browser contract exposes the stable News endpoint and operator guidance for stale backup proof, references/parser uncertainty, drift, lock conflict, and rollback failure. The workspace disables Preview, Save, ordinary Publish, form mutation, and concurrent Delete controls while Delete owns the UI lifecycle; execution requires review plus explicit checkbox confirmation and successful Publish navigates to the News list.

Real-browser acceptance used an isolated Git repository and verified missing-backup refusal, canonical parser-uncertainty refusal, exact backup review facts, the disabled-before-confirmation execution gate, the complete happy-path recovery move, disabled Preview/Save/ordinary Publish during the completed Delete boundary, separate Delete Publish, navigation to `/editor/news/workspace/`, a commit containing only `D src/content/news/2023-11-20.md`, completed durable evidence, and zero browser console errors. Lock conflict, byte drift, rollback, and manual-recovery terminal behavior remain covered by the isolated repository tests because injecting those filesystem races through the browser would weaken the reviewed operation boundary.

Production loaders, canonical Production content and assets, Asset Lifecycle v2, and all non-News Delete implementations are unchanged. News-like internal routes are unsupported by the current route registry and therefore fail closed as parser uncertainty rather than being treated as a resolvable News detail reference.
