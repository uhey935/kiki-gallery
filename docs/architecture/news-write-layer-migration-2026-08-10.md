# News Three-file Write Layer Migration

## Accepted boundary

News Save, Create, Publish, Rename, and Delete now treat `src/content/news/<contentId>/index.yaml`, `ja.md`, and `en.md` as the only writable canonical unit. JA and EN are serialized and validated independently; no locale fallback is introduced. Legacy `src/content/news/<contentId>.md` remains read-only compatibility input until migration completion.

Save compares the loaded Editor baseline with a fresh canonical reread, checks every preimage again while staging replacements, and restores every replaced file if installation fails. Create validates a staged three-file unit and atomically installs its directory. Publish stages only the three canonical destination files plus the exact three-file source deletion when publishing a Rename.

Rename binds repository identity and an aggregate hash of the exact three-file unit, atomically moves the directory, verifies the destination bytes, and restores the source on failure. Delete binds a verified backup to three individual file hashes, moves the unit into durable recovery evidence, and publishes exactly three deletions. Content lifecycle locks continue to serialize all ordinary writers.

## Verification

The Editor test suite covers clean serialization, locale isolation, stale baselines, partial replacement rollback, Create collision and rollback, three-file Rename and Publish, exact-backup Delete, drift, lock conflict, rollback, and manual recovery. Translation TODO markers permit Save but block Publish. Production News loader and migration tests continue to verify independent JA/EN behavior and retained legacy sources.
