# Phase 2 Home Editor audit

## Production contract

- `home` is glob-loaded, but production destructures only its first entry and fails when none exists. The Editor narrows this to singleton `src/content/home/home.md`; create, delete, and rename are outside the boundary.
- The current schema has optional `home_hero`, not required `hero_image`. Hero media is either an image or a video with poster; layout is optional.
- Production locates `artists` and `about` by ID and throws if either is absent. Each section owns one canonical `image.src`; array order does not control current display order. Responsive source switching is not part of the current contract.
- Section href accepts URL or absolute internal path. No cross-collection route abstraction is introduced.
- Home owns Markdown asset references, not files in `public`. The current Artists and About section references resolve to existing assets. Upload, replacement, deletion, and orphan cleanup remain out of scope.
- `title` and `description` are schema fields but are not consumed by the current page. They remain editable to avoid a lossy boundary.

## Editor boundary

Home gets a dedicated singleton workspace and collection-specific state, draft, serializer, preview store, Save, and Publish modules. It reuses mature UX state and the display-only flat validation panel. Save atomically replaces `home.md` after baseline checks. Publish stages only `src/content/home/home.md`. Draft Preview is tokenized, expiring, Content-ID-bound, and renders the consumer-relevant hero and section media.

The schema requires exactly one `artists` and one `about` section and one canonical image path for each. Obsolete `landscape`, `square`, and `portrait` fields are rejected fail-closed; no runtime compatibility fallback is retained.

## Phase 2 platform assessment

The platform supports singleton navigation and nested forms without a generic repository, serializer, form schema, preview store, or orchestrator. Reference-existence validation should wait: collection link semantics differ, production consumers remain authoritative, and a common validator would mix route knowledge, asset existence, and ownership before a stable reference contract exists.
