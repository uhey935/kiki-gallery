# Dependency & Astro Upgrade Audit — 2026-08-07

## Scope and safety boundary

This milestone updates dependencies without changing the Editor v1 content model,
Editor architecture, Asset Lifecycle v2 behavior, production content, or canonical
assets. Phase 4 Release Readiness was already committed as `f32e214` before this
work began, and the working tree was clean.

## Environment and baseline

- Validation runtime: Node.js 24.14.0 (the host default, Node.js 20.11.0, does not
  satisfy the repository's `>=22.12.0` engine requirement)
- npm: 10.2.4
- Astro: 6.0.4
- Lockfile: `package-lock.json`
- Direct dependency tree: valid (`npm ls --depth=0`)
- Editor tests: 136 passed
- Journal tests: 21 passed
- Astro check: 0 errors, 0 warnings, 7 existing hints
- Production build: 81 pages
- npm audit: 13 vulnerabilities (10 high, 2 moderate, 1 low)

The audit findings were rooted in Astro and its transitive build/runtime
dependencies. Updating only to the latest Astro 6 release was insufficient:
published advisories included ranges through Astro 7.0.9.

## Update candidate classification

| Package                    |             Baseline | Candidate | Class               | Decision                                                             |
| -------------------------- | -------------------: | --------: | ------------------- | -------------------------------------------------------------------- |
| Astro                      |                6.0.4 |     6.4.8 | minor               | Superseded; does not clear all current advisories                    |
| Astro                      |                6.0.4 |     7.2.0 | major               | Updated; required to leave the affected advisory ranges              |
| Prettier                   |                3.8.1 |     3.9.6 | minor               | Updated; compatible range, formatting verified                       |
| `@astrojs/markdown-remark` | implicit via Astro 6 |     7.2.2 | explicit dependency | Added because Editor preview imports its public API directly         |
| `@types/node`              |              24.13.3 |    26.1.2 | major               | Deferred; current types match the validation runtime major           |
| TypeScript                 |                5.9.3 |     7.0.2 | major               | Deferred; `@astrojs/check` currently declares TypeScript 5/6 support |
| `@astrojs/check`           |               0.9.10 |    0.9.10 | current             | Retained                                                             |
| `prettier-plugin-astro`    |               0.14.1 |    0.14.1 | current             | Retained                                                             |
| YAML                       |                2.9.0 |     2.9.0 | current             | Retained                                                             |

Transitive dependencies were refreshed within their declared ranges using
`npm audit fix`; no override or forced incompatible update was used.

## Astro 7 compatibility review

The Astro 7 migration guide identifies Vite 8, removed deprecated transition
internals, removed `@astrojs/db`, stabilized experimental flags, and changed
integration container-renderer imports as possible migration points. Repository
search confirmed that none of those APIs or configuration flags are in use.

Astro 7 no longer installs `@astrojs/markdown-remark` as its internal Markdown
implementation. Three Editor preview routes import `createMarkdownProcessor`
from that package. The package was therefore promoted from an undeclared
transitive dependency to a direct dependency at 7.2.2. No preview code or
behavior was changed.

References:

- <https://docs.astro.build/en/guides/upgrade-to/v7/>
- <https://docs.astro.build/en/upgrade-astro/>
- npm advisory report captured during this milestone

## Applied changes

- `astro`: `^6.0.4` → `^7.2.0`
- `prettier`: `^3.8.1` → `^3.9.6`
- Added `@astrojs/markdown-remark`: `^7.2.2`
- Refreshed `package-lock.json`, including safe transitive security updates

No application source, Editor behavior, architecture, production content, or
canonical assets were changed.

## Final verification

- `npm audit`: 0 vulnerabilities
- `npm outdated`: only deferred major candidates remain (`@types/node`, TypeScript)
- Editor tests: 136 passed
- Journal tests: 21 passed
- Astro check: 0 errors, 0 warnings, 7 pre-existing hints
- Production build: 81 pages
- Production content/assets: no diff
- Formatting: changed source and documentation files pass Prettier
- `git diff --check`: clean

The dependency tree and all validations were also reproduced after a clean
`npm ci` install using Node.js 24.14.0.
