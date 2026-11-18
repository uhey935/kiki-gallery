# Technical Debt

## Current Status (2026-11-18)

This inventory records the 2026-11-18 audit snapshot and subsequent confirmed
resolutions. The snapshot against baseline `90c20bc` remains below as historical
evidence. It did not include a build or test run; later verification is recorded
with the item it resolved.

## Completed

### Astro 6 → Astro 7 migration

The migration is complete. The current [package manifest](../../package.json)
declares Astro `^7.2.0`, and the [lockfile](../../package-lock.json) resolves
Astro 7.2.0. The [Dependency & Astro Upgrade Audit (2026-08-07)](./dependency-and-astro-upgrade-audit-2026-08-07.md)
records the migration and its milestone verification, including a successful
build at that time. That historical build result is not a build performed by the
2026-11-18 audit or the Zod URL API change.

### Unused variables and imports

No unused variables or imports were reported in the 2026-11-18 audit checks. A
TypeScript check with `noUnusedLocals` and `noUnusedParameters` also completed
without diagnostics. The project does not currently enable these options as
persistent compiler settings; enabling them remains an optional quality
improvement, separate from a detected unused variable or import.

### Deprecated Zod URL validation API

Resolved in commit `c2bd543`. The three deprecated `z.string().url()` calls
were replaced with `z.url()` in:

- [Home content schema](../../src/content-schemas/home.ts)
- [News content schema](../../src/content-schemas/news.ts)
- [Works content schema](../../src/content-schemas/work.ts)

The new [URL validation regression tests](../../src/content-schemas/url-validation.test.ts)
passed 15/15 against the old API before replacement and 15/15 after
replacement. The Editor suite passed 407 tests, Home localization 8, News 26,
and Works localization 7.

`astro check` reported 0 errors, 0 warnings, and 5 hints after the change. The
Zod deprecation diagnostics were no longer present. The existing HTTP/HTTPS
refinements in Home and News, Works' existing scheme acceptance, and the
existing internal-path union behavior were preserved. No URL normalization or
new scheme allowlist was introduced.

## Historical audit snapshot (2026-11-18; baseline `90c20bc`)

This read-only audit did not modify application code or dependencies, and it
did not run a build or test suite.

At that baseline, the lockfile resolved Zod 4.3.6 through Astro. The audit's
`astro check` covered 468 files and reported 0 errors and 8 hints, including 3
deprecated `.string().url()` diagnostics in the schema files linked above. The
TypeScript check with `noUnusedLocals` and `noUnusedParameters` completed
without diagnostics. `z.url()` was recorded as the replacement candidate,
subject to verifying accepted URL values and preserving the HTTP/HTTPS
refinements. The two earlier inventory descriptions, “deprecated z API” and
“deprecated URL validation API,” were found to refer to those same usages.
Standard `new URL()` usage was not found to be deprecated.

## Requires current verification

### npm audit

The [Dependency & Astro Upgrade Audit (2026-08-07)](./dependency-and-astro-upgrade-audit-2026-08-07.md)
recorded 0 vulnerabilities after the Astro migration. This is a historical
result, not the current dependency audit result.

On 2026-11-18 at 18:22 JST, `npm audit --json` was run with Node.js 22.22.1 and
npm 10.9.4. The request failed with `ENOTFOUND registry.npmjs.org`, so the
audit did not complete and the current vulnerability count is unknown. Repeat
the audit in an environment that can reach the npm registry, then record its
timestamp, runtime, npm version, and result here.
