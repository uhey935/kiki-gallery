# Technical Debt

## Current Status (2026-11-18)

This inventory reflects the read-only audit performed on 2026-11-18 against
baseline `90c20bc`. It separates completed items, confirmed findings, and work
that still needs current verification. The audit did not modify application
code or dependencies, and it did not run a build or test suite.

## Completed

### Astro 6 → Astro 7 migration

The migration is complete. The current [package manifest](../../package.json)
declares Astro `^7.2.0`, and the [lockfile](../../package-lock.json) resolves
Astro 7.2.0. The [Dependency & Astro Upgrade Audit (2026-08-07)](./dependency-and-astro-upgrade-audit-2026-08-07.md)
records the migration and its milestone verification, including a successful
build at that time. That historical build result is not a build performed by
the 2026-11-18 audit.

### Unused variables and imports

No unused variables or imports were reported in the 2026-11-18 checks. The
`astro check` covered 468 files and reported 0 errors and 8 hints; it also
emitted 3 deprecated-API diagnostics, listed below. A TypeScript check with
`noUnusedLocals` and `noUnusedParameters` also completed without diagnostics.
These checks support treating this cleanup item as complete for the audited
codebase.

The project does not currently enable `noUnusedLocals` or
`noUnusedParameters` as persistent compiler options. Enabling those checks is
an optional quality improvement, separate from a currently detected unused
variable or import.

## Confirmed technical debt

### Deprecated Zod URL validation method

The current lockfile resolves Zod 4.3.6 through Astro. In the 2026-11-18
`astro check`, the deprecated `.string().url()` method produced diagnostics at
these three locations:

- [Home content schema](../../src/content-schemas/home.ts)
- [News content schema](../../src/content-schemas/news.ts)
- [Works content schema](../../src/content-schemas/work.ts)

Zod 4 provides `z.url()` as the replacement candidate. Before changing these
schemas, verify that accepted and rejected URL values remain appropriate and
that the existing HTTP/HTTPS restrictions continue to hold. Do not treat
standard `new URL()` usage as deprecated; no such deprecation was found.

The earlier inventory listed “deprecated z API” and “deprecated URL validation
API” separately. The current audit found both descriptions refer to the same
three deprecated Zod URL-method usages, so they are consolidated here.

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
