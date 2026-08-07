# Works Asset Manager Architecture & Safety Specification

| Property      | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Status        | Approved implementation specification                   |
| Last reviewed | 2026-08-07                                              |
| Scope         | Assets for existing Works entries in the local Editor   |
| Supersedes    | No existing content, workflow, or storage specification |

This document fixes the architecture and safety boundary for the first Works Asset Manager. It does not authorize implementation beyond the first slice named at the end.

## Goals

- Define one canonical Works asset root and the relationship between stored files and `images[].src`.
- Separate reversible Draft operations from filesystem mutation.
- Define safe upload, replacement, removal, ordering, Save, Preview, and Publish semantics.
- Preserve the existing local-only Editor and static Production boundary.
- Preserve a migration seam for a future localized Works content model without introducing that model now.
- Provide stable failure classes and a testable set of invariants before mutation code is added.

## Non-goals

- Implementing upload, replacement, removal, asset optimization, or cleanup.
- Migrating or renaming current assets, correcting their extensions, or moving storage.
- Splitting Works into shared and localized files.
- Creating, deleting, or renaming Works entries.
- Managing assets for Journal or other collections.
- Adding production-hosted mutation, authentication, remote object storage, or a generic asset repository.
- Automatically deleting orphans or rewriting references outside the selected Work.

## Current-state inventory

The authoritative observations on 2026-08-07 are:

- Works source is one flat Markdown file per entry under `src/content/works/<contentId>.md`.
- `images` is an ordered, non-empty array in frontmatter. Each item has a required `src` and required `alt`; duplicate `src` values within one Work are rejected.
- `src` and `alt` currently coexist in that flat file. Architecturally, `src` identifies shared media while `alt` is localized presentation content, even though the current storage cannot separate them.
- All seven referenced Works files are directly under `public/images/works/`. Every current Works image reference resolves to one of them. Three assets are each referenced by more than one Work; there are no orphans and no audit errors.
- The seven current files have unique SHA-256 values; there are no byte-identical duplicates.
- Current file sizes range from 28,597 to 2,593,218 bytes. Decoded dimensions observed by file inspection are 1400×1750 or 1750×1400 where reported.
- File extensions are not a reliable format signal. Two `.png` names contain WebP, two `.jpg` names and one `.jpeg` name contain AVIF. Therefore existing references cannot be subjected retroactively to a new extension/content invariant without an explicit migration.
- Production passes `images[].src` directly to ordinary HTML `<img>` elements. It does not import assets through Astro Image, generate derivatives, or transform the URL.
- `public/` is copied as static output. The current Production build, rather than the Editor, owns no optimization step for these images.
- Works Save replaces only `src/content/works/<contentId>.md`, after content-ID, regular-file, symlink, baseline, raw-byte, temporary-file, and rename checks.
- Works Preview stores a cloned Draft behind a dev-only expiring UUID token. It does not write canonical files.
- Works Publish stages the canonical Markdown plus only newly materialized assets carried by the accumulated Save manifest. It verifies canonical and staged bytes, commits the exact changed-path set, then pushes.
- Save, Preview creation/rendering, and Publish routes are injected only during `astro dev`; Production has no mutation endpoint.

The extension/content mismatches are migration debt, not an Asset Manager implementation blocker. Existing referenced assets remain readable under a compatibility rule; every newly admitted asset must satisfy the stricter rules below.

## Canonical asset model

### Root and identity

The canonical Works asset root remains:

```text
public/images/works/
```

Its canonical public URL prefix is:

```text
/images/works/
```

`images[].src` stores only that root-relative public URL. It must not store a filesystem path, `file:` URL, absolute origin, query string, fragment, encoded separator, backslash, or dot segment. The Asset Manager converts between URL and filesystem path through one collection-owned resolver; it must never concatenate unvalidated request text onto the root.

An asset is identified by its normalized public URL. Content hash is metadata for validation, deduplication guidance, baseline comparison, and Publish verification; it is not the public identity and does not make content-addressed storage part of v1.

### Naming

For newly admitted files, the canonical basename is:

```text
<contentId>-<ordinal-or-label>.<canonical-extension>
```

- The complete basename must match `^[a-z0-9]+(?:-[a-z0-9]+)*\.(avif|jpg|png|webp)$`.
- The maximum basename length is 120 ASCII characters.
- `jpeg` input is normalized to `.jpg`; permitted canonical extensions are `.avif`, `.jpg`, `.png`, and `.webp`.
- The extension is selected from decoded content, not the client filename or declared MIME type.
- A generated name is only a proposal. Reservation uses exclusive creation and must fail on any existing directory entry, including a symlink; it never overwrites or silently suffixes a collision.
- Replacement normally retains the existing public URL only when the decoded format maps to the same canonical extension. A format change proposes a new URL and makes the old asset a removal candidate.
- Reordering never renames files. Ordinals in existing names are labels, not mutable array positions.

Existing nonconforming names and extension/content mismatches are grandfathered only for read, reference, reorder, and unchanged Save/Publish. They may not be used as evidence that a new upload is valid. Replacing one must produce a conforming asset; migration of the old path is deferred.

### Source of truth and references

The filesystem bytes under the canonical root are the source of truth for asset content. The ordered `images[].src` array is the source of truth for a Work's references and display order. Neither side alone proves ownership.

Asset ownership must therefore be represented as a reference graph built by parsing all canonical Works sources:

```text
public URL -> set of { contentId, images index }
```

The graph is recomputed from canonical sources for destructive decisions; client-supplied reference counts are never trusted. Shared references are valid. No naming convention implies exclusive ownership.

## Mutation boundaries

### Draft-only operations

- **Upload selection** reads and validates input into a request-scoped temporary asset record. It does not create a canonical file.
- **Reorder** changes only the Draft `images` array.
- **Remove** removes a reference from the Draft and records the prior URL as a removal candidate. It does not delete a canonical file.
- **Replace** creates a validated temporary candidate, updates the Draft reference to its proposed URL, and records the previous URL as a removal candidate. It does not overwrite the previous file.
- **Existing asset selection** may add a canonical reference only after server-side resolution and validation. A free-form URL is not an asset-selection API.

All pending records are bound to the Work content ID, an unguessable Editor-session token, a byte hash, validated media metadata, and a short expiry. The server, not the browser, is authoritative for pending bytes and metadata.

### Canonical mutation

Canonical mutation occurs only through Save. It may promote new temporary files and replace the Markdown reference set. Physical deletion is not part of the first implementation and must not occur merely because a Draft reference is removed.

Upload and replace are modeled as **create new canonical path**, never in-place overwrite. Remove is modeled first as **remove reference**. A later cleanup operation may delete an unreferenced file only after a fresh repository-wide reference scan, baseline/hash verification, and explicit confirmation.

## Media admission and resource limits

The upload boundary applies all checks before a candidate can enter the pending store:

1. Enforce request/body limits while streaming; do not buffer an unbounded body.
2. Reject zero-byte input and compressed/archive containers.
3. Decode with a maintained image decoder in a resource-limited worker/process. Header-only trust is insufficient.
4. Derive format, width, height, frame count, and animation state from decoded content.
5. Permit only single-frame JPEG, PNG, WebP, or AVIF. SVG, GIF, TIFF, BMP, HEIC/HEIF, animated images, and all other formats are rejected in v1.
6. Require declared MIME, decoded format, and resulting canonical extension to agree. The client filename is advisory only.
7. Apply all initial limits: at most 20 MiB encoded bytes, width and height each from 1 through 12,000 pixels, and at most 40 megapixels. These constants live in one Works-owned policy module and may be tightened from measured fixtures.
8. Reject malformed, truncated, decoder-failing, or trailing-polyglot input. Metadata is stripped only if/when a derivative pipeline is explicitly introduced; v1 must not claim sanitization by extension change.

SHA-256 is computed while ingesting bytes. If the hash matches an existing canonical asset, the API returns a stable duplicate result with the existing URLs and performs no mutation; the user may explicitly choose an existing reference. Equal names with different bytes are collisions and fail. Equal bytes do not authorize automatic cross-Work replacement or deletion.

## Original and derivative responsibility

For the current architecture, the admitted, validated file in `public/images/works/` is the original canonical web asset. The Editor does not generate derivatives, rewrite quality, strip metadata, or transcode in the first slice. Production continues to serve the referenced public file directly.

Astro Image is not in the current Works flow, so this specification must not pretend the Production build will optimize uploads. Introducing responsive derivatives requires a separate design covering manifest ownership, deterministic generation, invalidation, cache policy, and Production rendering. Generated output must never be mixed into the canonical reference graph or staged implicitly.

## Save interaction and transaction model

### Transaction boundary

Save treats one Work Markdown file plus only that request's newly promoted asset paths as one logical transaction. The transaction uses this order:

1. Validate Draft, content ID, baseline Draft, canonical raw Markdown bytes, pending-token ownership/expiry, proposed paths, and candidate hashes.
2. Rebuild the reference graph and validate every retained existing URL.
3. Serialize the final Markdown and stage it as a new regular temporary file in the Works content directory.
4. For each new asset, copy or move bytes into a fresh temporary file inside the canonical asset root using exclusive creation; reread metadata/hash and verify a regular non-symlink file.
5. Reserve/promote asset targets using no-overwrite semantics. Record exactly which targets this transaction created.
6. Recheck the canonical Markdown baseline and relevant asset path states immediately before the Markdown rename.
7. Atomically rename the staged Markdown over the existing Markdown file.
8. Reread the Work and all referenced asset bytes/metadata. Return the fresh saved baseline plus an exact asset manifest.

If a failure occurs before step 7, remove only temporary files and canonical asset targets proven to have been created by this transaction. If step 7 fails, perform the same cleanup. The pre-existing Markdown and all pre-existing assets remain untouched.

If post-rename verification fails, attempt to restore a transaction-owned backup of the exact prior Markdown bytes, then remove transaction-created assets. If restoration itself fails, return `asset-save-rollback-failed`, preserve evidence for manual recovery, and block retry from assuming success.

The Markdown rename is the visibility point. It must never reference an asset before that asset is fully written and verified. Assets created just before a failed or crashed Markdown rename can become orphans; they cannot create broken Production references and are detected by the orphan audit. Cross-directory atomicity is not claimed.

### Retry and baseline semantics

An identical retry is idempotent only when each target path already contains the expected hash and the canonical Markdown equals the expected serialized result. Any other existing target is a collision. A successful Save returns a new baseline containing raw Markdown bytes and the exact `{url, sha256, size, format, width, height}` manifest for every referenced asset. Subsequent Save and Publish compare against it.

Reference removal is committed in Markdown during Save. Physical deletion is deferred and is not rolled into this transaction.

## Preview interaction

Three options were considered:

| Option                        | Canonical write                                     | Lifetime/control                    | Decision                                                                                                            |
| ----------------------------- | --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Browser object URL            | No                                                  | Bound to one browser document       | Reject as the rendering contract; a new Preview page cannot reliably consume the originating document's object URL. |
| Public temp directory         | No canonical write, but easy to expose accidentally | Requires cleanup and path hardening | Reject as an unscoped static surface.                                                                               |
| Dev-only tokenized temp store | No                                                  | Server-owned, expiring, auditable   | Adopt.                                                                                                              |

Pending image bytes remain outside `public/` in a process-owned temporary directory. Preview model creation binds their opaque IDs to the existing Preview token. A dev-only route streams a validated pending image only when Preview token, Work content ID, pending asset ID, and expiry all match. Responses use the decoder-derived MIME, `nosniff`, and no-store caching. The Preview model rewrites pending `src` values only in its clone; canonical Draft semantics and filesystem remain unchanged.

Removing a pending image from the in-memory Asset Draft removes only its reference. Its temporary token remains available until normal TTL expiry rather than being released immediately, preserving retry and accidental-removal recovery without introducing a separate discard/undo protocol. Save materializes and releases only tokens still referenced by the submitted Asset Draft. Existing canonical files are never deleted by this interaction.

The pending store needs explicit caps: per-file admission limits above, maximum 20 pending assets per Work token, maximum 100 MiB per Work token, global byte/record caps, ten-minute default TTL, expiry sweeping, and cleanup on successful Save where safe. Capacity exhaustion fails closed and never evicts a record actively referenced by a Preview response without returning a stable expiry/capacity failure.

## Publish interaction

Publish expands from one Markdown path to an exact **saved Work manifest**:

- the one canonical Markdown path;
- newly created or replaced asset paths referenced by that saved version;
- later, explicitly approved deleted paths, but none in the first implementation slice.

It must continue to reject pre-existing staged changes, unsafe repository context, dirty Drafts, stale canonical baselines, and an empty target diff. Before staging, it rereads every manifest path with `lstat`, rejects symlinks/non-regular files/root escape, and verifies bytes against the saved SHA-256 manifest. It stages explicit paths only, never a directory or glob.

After staging, Publish requires the staged name set to equal the expected changed-path set exactly. It compares the staged Markdown blob byte-for-byte and every staged asset blob by SHA-256 with the saved manifest. It then repeats a working-tree hash/stat check to detect changes between inspection and staging. Any mismatch unstages only transaction paths and returns `asset-publish-canonical-mismatch`. The existing commit-then-push and `committed-push-failed` distinction remains.

Untracked new assets are allowed only when named in the saved manifest. Unrelated modified or untracked assets are not staged. A saved reference removal does not stage deletion of the old asset; cleanup/publish of deletions is deferred.

The Workspace treats the manifest as the current unpublished materialization set. Each successful Save merges that transaction's newly materialized assets into the set and rebinds the whole set to the new canonical Markdown baseline; existing references are never added merely because they appear in Markdown. A pre-commit failure retains this set for retry. A successful commit consumes it even when push subsequently fails, because `committed-push-failed` must be retried as a push rather than as another Publish commit. Assets already tracked with no Git difference naturally fall out of the explicit stage set.

## Orphans and existing references

An orphan is a regular file directly under the canonical root whose normalized URL has zero references in all successfully parsed canonical Works entries. Files outside the root, nested directories, symlinks, and sources that cannot be parsed are reported separately as audit uncertainty, not classified as safe-to-delete orphans.

The Asset Manager may report:

- referenced by this Work;
- referenced by other Works (with content IDs);
- unreferenced candidate;
- unknown because the reference graph is incomplete or invalid.

Remove never physically deletes. Shared files remain valid after one Work removes its reference. Automated orphan cleanup, retention duration, trash location, and Git deletion Publish are deferred. Until those policies are approved, cleanup is a read-only report plus an explicitly manual repository action outside the Editor.

## Locale-split seam

Asset bytes and `src` identity are shared; `alt` is localized. Asset services therefore accept/return asset references without `alt`:

```ts
type WorkAssetRef = { src: string };
type LocalizedWorkImage = WorkAssetRef & { alt: string };
```

The current Draft adapter joins them into the flat `images` array and preserves ordering. Asset mutation code must not parse or author localized fields, and localized validation must not own filesystem mutation. A future three-file model can place the ordered shared reference list in shared data and locale-aligned alt text in locale files without changing asset identity, admission, storage, or Publish hashing. The exact future alignment key/index model remains a locale-split decision; v1 must not invent persistent asset IDs solely in anticipation of it.

## Production and security boundary

- Every upload, pending-asset stream, Save, and Publish endpoint is injected only for `astro dev`. A Production artifact assertion must prove these endpoints and server code are absent from build output.
- Local-only is not a trust exemption. Request values are hostile, including content ID, filename, MIME, pending ID, URL, token, and serialized Draft.
- Resolve a constant root with `realpath`; validate each path component; use `lstat`; reject roots, parents, sources, temporaries, or targets that are symlinks or non-regular files. Recheck immediately before promotion, rename, deletion, staging, and streaming.
- Reject `/`, `..`, percent-encoded traversal/separators, Unicode separator lookalikes, NUL, control characters, backslashes, absolute filesystem paths, nested paths, and case-fold collisions where the host filesystem treats them as equal.
- Use exclusive temporary/target creation with restrictive permissions. Temporary files live outside `public/` until promotion and never use a client filename.
- Decoder work has byte, pixel, frame, memory, and time limits. Decoder crashes or timeouts fail the request without promoting bytes.
- Never follow a submitted symlink and never use recursive filesystem mutation for a single asset.
- Baseline hashes and repeated `lstat`/hash checks narrow TOCTOU windows. Operations fail closed when identity changes; no design can treat a prior check as a permanent capability.
- Error responses expose stable codes and safe guidance, not absolute paths, Git remote credentials, decoder internals, or arbitrary exception text.

## Safety invariants

1. Canonical Works assets exist only as regular, non-symlink files directly beneath the resolved canonical root.
2. New canonical filenames are ASCII-normalized, format-correct, bounded, and collision-free.
3. No operation overwrites or deletes a pre-existing asset implicitly.
4. A successful Markdown Save never introduces a reference to missing, unverified, or pending-only bytes.
5. Failed Save preserves prior Markdown and prior assets; cleanup targets only files proven transaction-created.
6. Reference removal and physical deletion are separate decisions.
7. Shared-reference counts come from a fresh server-side canonical scan.
8. Preview never mutates `src/content/works/` or `public/images/works/`.
9. Publish stages exactly the saved manifest and verifies staged blobs, not merely paths.
10. Production contains no Asset Manager mutation or pending-preview surface.
11. Existing extension/content mismatches are compatibility inputs, never precedents for new admission.
12. Asset policy and operations remain Works-owned until a second proven collection requires identical behavior; no B2 generic abstraction is introduced.

## Failure taxonomy

Codes are stable API values. Messages may improve without changing recovery meaning.

| Stage       | Stable code                        | Meaning / UI guidance                                                                                    |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Request     | `asset-invalid-request`            | Malformed or missing input; correct the request/selection.                                               |
| Path        | `asset-unsafe-path`                | URL/name/root/path is outside policy; choose another file/name and do not retry unchanged.               |
| Upload      | `asset-too-large`                  | Encoded bytes, dimensions, or pixels exceed policy; resize/re-export.                                    |
| Upload      | `asset-unsupported-format`         | Decoded format/frame model is not permitted; export JPEG, PNG, WebP, or AVIF.                            |
| Upload      | `asset-type-mismatch`              | MIME, decoded content, and proposed extension disagree; re-export the source.                            |
| Upload      | `asset-decode-failed`              | Zero-byte, corrupt, truncated, malformed, or decoder-failing input; choose a valid image.                |
| Upload      | `asset-capacity-exceeded`          | Pending-store quota is full; remove pending items or wait for expiry.                                    |
| Upload      | `asset-duplicate`                  | Bytes already exist; offer explicit reuse without mutation.                                              |
| Upload/Save | `asset-name-conflict`              | Proposed canonical path exists with different bytes; choose a different label.                           |
| Pending     | `asset-temp-not-found`             | Token/asset binding is absent; upload again.                                                             |
| Pending     | `asset-temp-expired`               | Temporary bytes expired; upload again.                                                                   |
| Pending     | `asset-temp-unsafe`                | Temporary bytes or filesystem identity changed; do not retry unchanged.                                  |
| Reference   | `asset-reference-invalid`          | Existing URL cannot be resolved/validated; repair the reference.                                         |
| Reference   | `asset-reference-shared`           | Destructive cleanup is blocked because another Work references it; remove only this reference.           |
| Save        | `canonical-mismatch`               | Markdown changed since baseline; reload before retry.                                                    |
| Save        | `asset-save-failed`                | Promotion or Markdown replacement failed and rollback succeeded; retry after checking filesystem state.  |
| Save        | `asset-save-rollback-failed`       | Prior state could not be fully restored; stop and request manual recovery.                               |
| Preview     | HTTP 404 + `no-store`              | Pending token ownership, expiry, or integrity validation failed; upload again when Save also rejects it. |
| Publish     | `asset-publish-manifest-mismatch`  | Requested/staged path set differs from saved manifest; inspect/reload.                                   |
| Publish     | `asset-publish-canonical-mismatch` | Working or staged asset bytes changed; reload/re-save before retry.                                      |
| Publish     | `publish-failed`                   | Pre-commit Git operation failed; repository remains uncommitted by this attempt.                         |

Existing Works Save/Preview/Publish codes remain authoritative for failures unrelated to assets. Routes transport the originating code unchanged. The UI maps codes to next actions centrally and retains the server message as detail.

## Test matrix

| Boundary           | Required evidence                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory/resolver | Current URL↔path mapping; root-prefix ambiguity; nested path, absolute path, backslash, encoded traversal, Unicode/control/NUL rejection; case-fold collision.                                                                                                               |
| Filesystem         | Regular root/file acceptance; symlinked root, parent, source, temp, and target rejection; directory/FIFO rejection; exclusive-create collision.                                                                                                                              |
| Admission          | Real JPEG/PNG/WebP/AVIF fixtures; spoofed MIME/extension; current mismatch fixtures; zero-byte, truncated, malformed, animated, huge-header/pixel-bomb, oversize-byte, boundary dimensions, decoder timeout.                                                                 |
| Hash/dedup         | Same bytes/different name; same name/different bytes; no false duplicate; byte-for-byte preservation after promotion.                                                                                                                                                        |
| References         | One Work, multiple Works, duplicate within Work, missing file, invalid Work source causing unknown graph, remove without delete, reorder without rename.                                                                                                                     |
| Save               | Temp-dir fixture with real files; Markdown stale baseline; asset changed after validation; target appears mid-operation; promotion failure; Markdown rename failure; verification failure; rollback success/failure; idempotent exact retry; no pre-existing-byte change.    |
| Preview            | Pending image renders through token; wrong Work/token/asset; expiry; clone rewrite only; no canonical writes; MIME/`nosniff`/cache headers; per-token/global capacity.                                                                                                       |
| Publish            | New untracked manifest asset; unrelated untracked/modified asset excluded; pre-staged refusal; exact staged path set; staged Markdown byte check; staged asset hash check; working file changes before/after stage; push-failure distinction; reset limited to target paths. |
| Orphans            | Unique, shared, unreferenced, nested, symlink, and incomplete-graph classifications; no deletion side effect.                                                                                                                                                                |
| Production         | Build contains referenced public bytes unchanged; no injected Asset Manager/pending Preview endpoints or server mutation modules; existing Production pages/assets remain equivalent before UI integration.                                                                  |
| Compatibility      | All seven current Works assets remain readable/referenceable; nonconforming existing assets cannot be newly admitted as conforming uploads.                                                                                                                                  |

Tests use isolated temporary repository roots, deterministic fixture bytes, injected filesystem/Git clocks where needed, and SHA-256/byte assertions. TOCTOU tests intentionally mutate targets at each check-to-use boundary. Real image fixtures are small, licensed/generated test data committed only under test fixtures.

## Open questions and deferred decisions

- Whether and when to migrate the five existing extension/content mismatches.
- Whether canonical originals should later be transcoded, metadata-stripped, or supplemented by responsive derivatives.
- Exact persistent alignment of shared `src` ordering and localized `alt` after a Works three-file split.
- Retention period, trash semantics, confirmation UI, and Publish behavior for physical orphan deletion.
- Whether cross-Work reuse should remain explicit selection or gain a searchable asset library.
- Final quota tuning from real gallery source images and decoder benchmarks.
- Crash recovery journal for the small interval between asset promotion and Markdown rename.
- New/Delete/Rename workflows and whether newly created Work assets receive a dedicated naming reservation.
- A generic asset abstraction remains deferred until another collection supplies the same concrete contracts.

None blocks a read-only inventory/admission implementation. Migration, locale split, New/Delete, physical deletion, and derivative generation require separate approval.

## Implemented v1 boundary

The completed v1 boundary is **new Works asset addition**: inventory and strict admission, temporary storage and Preview, Asset Draft editing, canonical materialization through Save, and manifest-limited Publish.

It includes:

- resolve and audit the canonical root;
- parse all Works references into the reference graph;
- inventory regular files, hashes, decoded format, dimensions, sizes, extension/content consistency, shared references, orphans, and unknown states;
- validate supplied image bytes against naming, format, decoding, limits, collision, and duplicate policies before temporary storage and again before materialization;
- return stable failure codes and actionable UI guidance;
- promote only referenced temporary assets, atomically replace Markdown with rollback, and release referenced tokens only after successful canonical reread;
- accumulate newly materialized asset manifests across Saves and Publish only the explicit Markdown-plus-manifest path set.

Physical deletion, deferred cleanup, storage migration, and locale splitting remain explicitly outside v1.

## Works Asset Replace Semantics — first slice

Replace is a Draft-level substitution, not a filesystem replacement:

`existing reference A` → `temporary candidate B` → `materialize new canonical B` → `commit Markdown with B at A's former index`

The first slice replaces one selected existing image. It retains that image's localized `alt` text, while the user may edit the text separately. The old canonical asset A is neither overwritten nor deleted and is not added to the new Publish manifest. B uses the existing upload admission, temporary-store ownership, Preview URL, materialization, Save transaction, and Publish-manifest boundaries.

### Invariants

1. Replace accepts an existing Draft image and substitutes only its selected array position.
2. The replacement remains temporary until Save; Preview resolves it through the scoped temporary route.
3. Save validates the unchanged Markdown baseline before any canonical asset mutation.
4. B is created at a fresh canonical path with no-overwrite promotion and verified before Markdown can reference it.
5. A remains byte-for-byte present regardless of Replace success or failure.
6. A failed materialization or Markdown commit preserves the prior Markdown reference to A, rolls back only transaction-created B, and retains B's temporary token for retry.
7. A successful Save releases B's token, returns a new existing-reference Asset Draft, and publishes only the Markdown plus B's exact manifest entry.
8. Replace does not imply orphan status, physical deletion, cleanup scheduling, storage migration, or locale splitting.

### Failure semantics

Upload/admission, temporary ownership/expiry, path collision, stale baseline, materialization, Markdown commit, and rollback failures retain their v1 stable error codes and recovery guidance. No Replace-specific filesystem error exists because Replace introduces no new mutation primitive. Selecting a non-existing Draft item for Replace is rejected before upload state is substituted; a temporary replacement must be removed or saved before that position can be replaced again.

### First-slice exclusions

Batch replacement, replacement of a still-temporary image, undo with immediate token release, reuse from an asset library, old-asset orphan classification, physical deletion, and cleanup Publish are deferred.
