# Exhibitions Delete Implementation and Browser Acceptance

| Field     | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| Scope     | Exhibitions content Delete only                                           |
| Baseline  | `cf70660` (`Implement safe News delete`)                                  |
| Deferred  | Artists and Works Delete                                                  |
| Preserved | Production loaders, canonical assets, Asset Lifecycle v2, other Delete UI |

Exhibitions Delete is the third collection-specific Delete slice. It applies the finalized shared Delete prerequisites and the Journal/News recovery lifecycle to one canonical Exhibition Markdown file. The reviewed server plan binds the exact file bytes, `/exhibitions/<contentId>/` route, repository identity, verified backup generation, closed canonical reference graph, recovery destination, and retained-asset statement.

Planning walks every canonical content source and fails closed for unreadable, symlinked, unsupported, or unresolved inputs. Supported Markdown routes and the finalized Exhibition-to-News `link` adapter are incoming references: either blocks Delete without cascade or automatic rewrite. Execution rebuilds the plan, acquires the non-stealing content lifecycle lock, rechecks bytes and references, atomically moves the file to recovery, and persists `prepared`, `completed`, `rolled-back`, or `manual-recovery-required` evidence. Rollback proves the original byte length and SHA-256 before releasing the lock; uncertain rollback retains the lock for manual recovery.

Delete Publish accepts completed Exhibitions evidence only. It requires a clean index and unchanged repository identity, stages exactly `src/content/exhibitions/<contentId>.md` as a deletion, verifies the full staged-name set and deletion status, commits without pushing, and leaves unrelated working-tree files unstaged. It never stages `.kiki-editor/`, `public/`, or inferred asset paths.

Isolated Git repository tests cover exact-backup gating, incoming-reference and parser-uncertainty refusal, reviewed-plan drift, non-stealing lock conflict, atomic recovery move, byte-for-byte rollback, manual-recovery lock retention, durable terminal evidence, and evidence-limited Publish. The browser UI exposes stable guidance for backup, graph, drift, lock, and recovery failures; execution requires reviewed facts plus an explicit checkbox. Preview, Save, ordinary Publish, Rename, and form mutation are excluded while Delete owns the workspace lifecycle.

Real-browser acceptance used an isolated repository. It verified missing-backup refusal, canonical parser uncertainty, a known News incoming-link refusal, exact backup facts and the public Exhibition route, disabled execution before confirmation, happy-path atomic Delete, post-Delete editing/action exclusion, separate evidence-only Publish, navigation to `/editor/exhibitions/workspace/`, a commit containing only `D src/content/exhibitions/alana-wilson-2027-04.md`, completed durable evidence, unchanged `public/`, and zero browser console errors.

Production loaders, canonical Production content/assets, Asset Lifecycle v2, and Journal/News/Artists/Works Delete behavior are unchanged. Assets remain at their exact paths and bytes. Restore, asset inference, cascade, force Delete, and automatic push remain prohibited.
