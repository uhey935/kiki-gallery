# Exhibitions Rename Browser Acceptance Closure

| Field  | Value                                                                        |
| ------ | ---------------------------------------------------------------------------- |
| Date   | 2026-08-08                                                                   |
| Basis  | `1218481` (`Implement safe Exhibitions rename`)                              |
| Result | Accepted without implementation changes                                      |
| Scope  | Reference-aware Exhibitions Rename browser flow and evidence-limited Publish |

## Acceptance environment

The browser milestone ran from a fresh Astro development process with the
current routes active. The end-to-end mutation ran in an isolated clone with
its own local bare remote, based exactly on `1218481`. This allowed the real
Publish commit and push path to complete without changing the production
repository, canonical production content, or assets.

The accepted example renamed `alana-wilson-2027-04` to
`alana-wilson-2027-04-acceptance`. Its reviewed plan identified the Exhibition
source, old and new routes, Git branch and HEAD, source hash, and the known
`src/content/news/2027-03-05.md` reference update.

## Browser acceptance

- Opened the saved Exhibitions workspace from the collection index.
- Reviewed the server-authored Rename plan and confirmed execution remained
  disabled until the exact-plan checkbox was selected.
- Executed Rename and verified navigation to the new Content ID workspace.
- Verified the Exhibition bytes were unchanged and the known News `link`
  scalar alone changed to the new route.
- Verified Preview still created a valid draft preview and clean Save remained
  disabled.
- Edited the renamed workspace, verified Save became enabled, and completed a
  normal Save after Publish as an independent post-Rename check.
- Completed Publish. The isolated remote advanced to `401b869`, whose exact
  path set was the old Exhibition deletion, new Exhibition addition, and the
  single planned News modification. The later Save was not part of that
  Publish commit.
- Exercised destination collision against `group-exhibition-2026-03`; the UI
  reported the collision and performed no mutation.

The existing isolated Git-repository test coverage remains the acceptance
authority for drift, byte-exact rollback, unsupported references, symlink
safety, lifecycle lock conflicts, and evidence-limited staging edge cases.
Those cases were not redundantly replayed in the browser.

## Boundary verification

No implementation defect was found, so the Rename architecture, API, UI, and
tests were unchanged. Artists, Works, Delete, Production loaders, and asset
ownership remain out of scope. Production `src/content` and `public/images`
remain byte-identical to `1218481`.
