# Technical Debt

## Current Status (2026-11-20)

This inventory distinguishes historical audit evidence, completed remediation,
and current advisory status. The 2026-11-18 historical audit snapshot
against `90c20bc` is preserved below.

The current dependency update was committed as `8f2e0e8` on
`security/dependency-update-2026-11-18`. At baseline
`8f5d2c495a65f9cbc10258fea531261e1a324588`, the 2026-11-20 audit reports
0 vulnerabilities. The previously remaining picomatch advisory was withdrawn;
this is not a package-update remediation. The 21 → 13 → 0 audit history and
its distinct causes are retained below.

## Completed

### Astro 6 → Astro 7 migration

The Astro 6 to Astro 7 migration is complete. The
[Dependency & Astro Upgrade Audit (2026-08-07)](./dependency-and-astro-upgrade-audit-2026-08-07.md)
records its historical milestone verification.

The subsequent dependency security update was committed as `8f2e0e8`.
The current [package manifest](../../package.json) declares
`astro@^7.4.12`, `@astrojs/markdown-remark@^7.3.9`, and
`@astrojs/check@^0.9.12`. The lockfile resolves versions 7.4.12,
7.3.9, and 0.9.12 respectively.

After the update, `npm ci` succeeded with Node.js 22.23.5.
`astro check` reported 469 files, 0 errors, 0 warnings, and 0 hints.
The static build generated 122 pages. The recorded regression runs
passed 601 test executions, including overlap between route suites.
These results do not constitute browser or deployed-environment acceptance.

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

## Dependency audit history and current status

### picomatch ReDoS advisory (withdrawn)

The [Dependency & Astro Upgrade Audit (2026-08-07)](./dependency-and-astro-upgrade-audit-2026-08-07.md)
recorded 0 vulnerabilities at that historical milestone.

The 2026-11-18 registry-backed audit before the dependency update reported
21 vulnerable packages: 1 critical, 19 high, and 1 moderate.
The production-dependency audit (`--omit=dev`) reported 18.

With the dependency versions subsequently committed as `8f2e0e8`,
`npm audit --json` reported 13 high,
0 critical, and 0 moderate findings, with no audit error.
`npm audit --omit=dev --json` reported 11 high findings.
All 13 full-audit package findings trace to one advisory:
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
a reported picomatch regular-expression denial-of-service (ReDoS) issue
involving repeated extglobs, subsequently withdrawn as described below.

Installed picomatch versions include 4.0.7 and 2.3.2 under
`anymatch`. The advisory originally identified versions `<=4.0.7` as affected
and listed no patched version when checked on 2026-11-18.
The 13 findings represent affected dependency packages, not
13 independently established vulnerabilities.

#### Reverification and withdrawal (2026-11-20)

At baseline `8f5d2c495a65f9cbc10258fea531261e1a324588` on `main`, with
working tree and index clean before this documentation edit,
`npm audit --audit-level=high` reproduced `found 0 vulnerabilities`
(exit code 0; Node.js 20.11.0, npm 10.2.4). The initial restricted-network
attempt failed with `ENOTFOUND registry.npmjs.org`; the subsequent
registry-connected retry succeeded. This audit-only runtime is below the
project's Node.js requirement and does not establish application compatibility.

The [official GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
checked on 2026-11-20, records withdrawal on 2026-11-18 because the report
was determined not to be a security issue. Its last-updated date is
2026-11-19, distinct from the withdrawal date. The earlier 13 High findings
are retained as historical registry responses, not current unresolved findings.

`npm ls picomatch` confirms that `picomatch@4.0.7` and nested
`picomatch@2.3.2` through `anymatch` remain installed. No package or lockfile
was updated for this verification. The transition from 13 High to 0 reflects
the advisory withdrawal, not a fix delivered by upgrading these packages;
the earlier 21-to-13 transition followed the dependency update above.
Zero audit findings reflect the registry's known advisory data at that time
and do not guarantee the absence of unknown vulnerabilities.

#### Reachability assessment (2026-11-18; historical)

A read-only static code audit of the Editor HTTP routes, Content ID
validation, image uploads, Save/Publish operations, content loaders,
and relevant Astro/Vite dependency call sites found no path by which
ordinary external input becomes an attacker-controlled picomatch
extglob pattern.

Content IDs and managed image names are constrained; hero image
destinations are derived from validated identities and formats.
Vite HTTP file paths are matched against configured patterns rather
than used to construct them. The inspected watcher uses
`disableGlobbing: true`, and the inspected build glob patterns
are fixed or source-defined.

This is a scoped static reachability assessment, not proof that
every possible runtime path is unreachable. The dependency versions
originally flagged by the now-withdrawn advisory remain installed.

#### Cloudflare Pages deployment assessment (2026-11-18; historical)

At that time, the inspected Pages project `kiki-gallery` used Git integration,
Production branch `main`, automatic deployment, build command
`npm run build`, and output directory `dist`.

The inspected Production deployment was built on 2026-09-01
from commit `19c2283`, not from the then-current security-update
commit. Its build log recorded Node.js 22.16.0, 122 generated
pages, no Wrangler configuration file, and
`No functions dir at /functions found. Skipping.`
It ended with successful static asset publication.

The current local source has no `functions/` directory,
and the inspected local `dist` contains neither `_worker.js`
nor `_routes.json`. These checks support a static Pages
deployment assessment for the inspected configuration.
They do not verify any uninspected external Worker,
runtime configuration, or future deployment.

The Cloudflare Production build environment has been configured
with `NODE_VERSION=22.23.5`. Preview configuration was being
set separately; its saved state was not independently verified
in this audit. The actual Node.js version must be confirmed
in the next deployment build log.

#### Risk treatment and re-evaluation

Status as of 2026-11-20: advisory withdrawn; no current npm audit findings.
The earlier unresolved-vulnerability classification and conditional risk
acceptance are superseded by the withdrawal, not by a dependency patch.
The historical reachability assessment remains useful scoped evidence.

Maintain strict Content ID and filename validation; do not
interpret user-controlled values as glob patterns.
Keep the development-only Editor API and development server
unexposed to the public internet, and preserve static-only
production deployment assumptions.

Reassess when new or revised advisories appear, when Editor inputs or
glob-handling code change, when dependencies or plugins change the relevant
call paths, or when deployment configuration changes. Continue monitoring
both the 4.0.7 and nested 2.3.2 dependency paths, and repeat audit and
appropriate regression verification for future dependency updates.

## Requires current verification

### Deployment and ongoing dependency verification

The earlier 2026-11-18 `npm audit` attempt with Node.js 22.22.1
and npm 10.9.4 failed with `ENOTFOUND registry.npmjs.org`.
That failed attempt is superseded by the successful registry-backed
audits described under Dependency audit history and current status, including
the 2026-11-20 verification above.

The task owner reports that baseline
`8f5d2c495a65f9cbc10258fea531261e1a324588` is already deployed to
Cloudflare Pages production. That deployment was not independently inspected
in this documentation-only verification; the 2026-11-18 assessment above
is historical. Verify from deployment evidence that both
Production and Preview use Node.js 22.23.4 or later.
Production was configured with `NODE_VERSION=22.23.5`;
the Preview setting requires independent confirmation.
Verify the actual runtime version in the applicable deployment build logs.

Confirm that the deployed output remains static, without
unexpected Pages Functions, `_worker.js`, or external Worker
routing. Re-run npm audit periodically and when dependencies or advisory
data change, and record the outcome. Browser acceptance and
deployment verification remain separate from the completed
local regression tests.
