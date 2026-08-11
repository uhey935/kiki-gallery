# News Three-file Write Layer Migration

## Accepted boundary

News Save, Create, Publish, Rename, and Delete treat `src/content/news/<contentId>/index.yaml`, `ja.md`, and `en.md` as the only canonical unit. JA and EN are serialized and validated independently; no locale fallback is introduced. The legacy `src/content/news/<contentId>.md` read and write compatibility paths have been removed, and Production and Editor state load only three-file News units.

Save compares the loaded Editor baseline with a fresh canonical reread, checks every preimage again while staging replacements, and restores every replaced file if installation fails. Create validates a staged three-file unit and atomically installs its directory. Publish stages only the three canonical destination files plus the exact three-file source deletion when publishing a Rename.

Rename binds repository identity and an aggregate hash of the exact three-file unit, atomically moves the directory, verifies the destination bytes, and restores the source on failure. Delete binds a verified backup to three individual file hashes, moves the unit into durable recovery evidence, and publishes exactly three deletions. Content lifecycle locks continue to serialize all ordinary writers.

## Verification

The Editor test suite covers clean serialization, locale isolation, stale baselines, partial replacement rollback, Create collision and rollback, three-file Rename and Publish, exact-backup Delete, drift, lock conflict, rollback, and manual recovery. Translation TODO markers permit Save but block Publish. Production News loader and migration tests continue to verify independent JA/EN behavior.

The three-file browser acceptance is complete in an isolated repository. It finishes Create → Preview → Save → Publish → Rename → Publish → Delete → Delete Publish against one disposable News unit, including the reviewed and explicitly confirmed destructive transition and the exact three-file Delete Publish boundary.

Legacy-format handling now consists only of read-only, fail-closed safety detection. Flat `src/content/news/<contentId>.md` collisions or references block Create, Rename, Delete, and reference-graph operations; they are never accepted as canonical Editor input and are never written or rewritten.

The frozen migration manifest and complete rollback evidence remain part of the accepted boundary. Migration tests recover isolated source fixtures from the frozen original bytes and verify source and generated-file hashes, byte lengths, and rollback integrity. Canonical `src/content/news` contains only three-file units.
