# Exhibitions Three-File Lifecycle Browser Acceptance

| Property    | Value                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Status      | Current lifecycle acceptance complete                                                          |
| Date        | 2026-08-12                                                                                     |
| Authority   | [Exhibitions Localization Architecture](./exhibitions-localization-architecture-2026-08-12.md) |
| Environment | Disposable clone with an isolated local bare remote                                            |

## Accepted lifecycle

The focused browser run exercised the current three-file Editor implementation,
not the superseded flat lifecycle. It opened the existing
`alana-wilson-2027-04` workspace, requested and reviewed a Rename plan,
confirmed and executed the operation, followed the redirect to the renamed
workspace, and completed evidence-limited Publish.

The run proved:

- the old Exhibition directory was absent after execution;
- the destination directory contained exactly `en.md`, `index.yaml`, and
  `ja.md`;
- the shared News link in `src/content/news/2027-03-05/index.yaml` changed to
  the destination canonical Content ID;
- Publish contained exactly the three old paths, three new paths, and that one
  News shared-source path when Git rename detection was disabled for path-set
  inspection; and
- the renamed workspace kept Delete planning disabled without a verified backup
  path and displayed the backup requirement.

The same focused run also passed the existing Exhibitions Create, validation,
Preview, Save, and Publish operator flow. Two Exhibitions-specific browser tests
passed. All mutations and commits occurred only inside the disposable clone;
Production content and assets were unchanged.

Rename and Delete service tests remain the authority for drift, collision,
symlink, reference-parser uncertainty, rollback, manual-recovery, exact-backup,
incoming-reference refusal, and evidence-limited staging edge cases.
