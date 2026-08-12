# Artists Rename Browser Acceptance Closure

> **Historical Exhibitions reference evidence.** Exhibition paths in this
> document record the former flat, single-Markdown topology. They are not the
> current Exhibitions reference-scanner contract after the three-file migration.
> See [Exhibitions Localization Architecture](./exhibitions-localization-architecture-2026-08-12.md).

> **Status: Historical browser-acceptance record.** This records the flat
> Artists implementation before the 2026-08-11 three-file migration; its path
> examples are not the current Artists Rename contract. See
> [Artists Architecture — Current](./artists-architecture-current.md).

| Property    | Value                                                              |
| ----------- | ------------------------------------------------------------------ |
| Date        | 2026-08-09                                                         |
| Basis       | `e257e6c` plus the Artists Rename milestone working tree           |
| Environment | Fresh Astro server in an isolated Git repository and bare upstream |
| Scope       | Reference-aware Artists Rename and evidence-limited Publish        |

## Accepted browser flow

The accepted fixture added a known News link to `/artists/yuka-mori`, then
renamed `yuka-mori` to `yuka-mori-browser-acceptance`. Before execution the
browser displayed the old/new identity and route plus one Work `artist`, two
Exhibition `artists[]` edits, and one News `link` edit. Execute remained
disabled until the exact reviewed plan was explicitly confirmed.

Execute opened the new saved-unpublished Artist workspace. The Works,
Exhibitions, and News Editor workspaces visibly exposed the new Artist ID or
route. Draft Preview completed, evidence-limited Publish committed only the
old/new Artist paths and the four reviewed reference files, and a post-Publish
field edit saved successfully in the renamed workspace.

The representative collision attempted to rename `keisuke-matsuda` to the
existing `alana-wilson` ID. Planning returned `destination-conflict` with
stable guidance and made no canonical change.

## Isolated verification

Focused isolated-repository tests cover invalid IDs, case-fold collision,
unsupported known routes, graph drift, lifecycle lock conflict, injected
multi-file install failure with byte-for-byte rollback, all mandatory reference
classes, and exact evidence-bound Publish staging. Isolated commit `6c8c477`
contained only:

- the old/new Artist paths;
- `src/content/works/yuka-mori-01.md`;
- `src/content/exhibitions/group-exhibition-2026-03.md`;
- `src/content/exhibitions/yuka-mori-2025-07.md`; and
- `src/content/news/2026-02-14.md`.

The production repository was restored after an early server-target discovery
and verified to have zero canonical content or public-image diff before final
validation. Works Rename, Delete, Production loaders, and asset paths/bytes
were not changed.
