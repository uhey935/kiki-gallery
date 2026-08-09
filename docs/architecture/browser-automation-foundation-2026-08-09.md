# Browser Automation Foundation and Regression Coverage

| Property | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Date     | 2026-08-09                                                                 |
| Scope    | Maintainable browser foundation plus representative lifecycle smoke suite  |
| Safety   | Disposable clone, local bare remote, deterministic fixture, localhost only |

## Finalization status

| Layer                    | Status              | Evidence                                                                                                                    |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Foundation               | Complete            | Playwright configuration, disposable runner, deterministic lifecycle fixture, and operating documentation at `af35744`      |
| Runtime prerequisites    | Available for retry | Playwright Chromium, headless shell, and FFmpeg revision 1234 installed successfully; retry used supported Node.js v24.14.0 |
| Actual browser execution | Environment-blocked | Chromium process started, then macOS denied its Mach rendezvous service before a browser context or Editor flow could run   |

The Browser Automation Foundation is complete at `af35744`. Its reviewed scope
is the Playwright dependency and configuration, npm entry point, disposable
repository runner, deterministic News lifecycle fixture, and operating
documentation described below. The existing Editor and Journal service suites,
Astro check, and production build pass without changes to Editor behavior,
production content, or public assets.

Chromium Runtime Verification was deliberately not run for this milestone. A
future **Browser Automation Runtime Verification** milestone must install or
select a compatible Chromium runtime and execute `npm run editor:test:browser`
from a clean checkout. That future result is runtime evidence, not a condition
of this foundation milestone.

## Runtime verification attempt

The first Runtime Verification attempt ran on 2026-08-09 at 14:17 JST from the
clean `34c771e` checkout. The runner successfully created its no-hardlink
temporary clone, initialized and attached the local bare remote, pushed the
isolated `main` baseline, linked the installed dependencies, and started the
isolated Astro server. Playwright then stopped in its first `browser` fixture,
before creating a browser context or executing any Editor assertion or
mutation, because its Chromium headless-shell executable was not installed:

```text
/Users/reset/Library/Caches/ms-playwright/chromium_headless_shell-1234/
chrome-headless-shell-mac-arm64/chrome-headless-shell
```

This is a local runtime prerequisite failure, not an automation implementation
failure and not a Chromium process/launch restriction. No lifecycle flow
(Preview, Save, Publish, Create, Rename, or Delete) executed, so runtime
verification remains incomplete. Install the pinned runtime with
`npx playwright install chromium`, then rerun `npm run editor:test:browser`.

The runner's `finally` cleanup removed the temporary repository and bare remote.
After the attempt, the source checkout remained clean, `src/content/` and
`public/` had no diff, and no `kiki-browser-*` sandbox remained in the system
temporary roots. The ignored `test-results/` directory retains only the local
failed-run evidence (status, trace, and error context); it is not milestone
evidence of an executed Editor flow.

## Runtime verification retry

The retry ran on 2026-08-09 at 14:24 JST after Playwright successfully installed
its pinned Chromium 1234, Chromium headless shell 1234, and FFmpeg 1011 into a
disposable runtime directory. The runner used Node.js v24.14.0, satisfying the
repository's `>=22.12.0` requirement. This completes prerequisite setup for the
attempt and rules out the earlier missing-executable boundary.

The runner again successfully created its no-hardlink temporary clone and local
bare remote, pushed the isolated `main` baseline, linked dependencies, and
started Astro without the earlier unsupported-Node warning. Playwright launched
the installed headless-shell process, but macOS stopped it before browser context
creation:

```text
FATAL:base/apple/mach_port_rendezvous_mac.cc:159
bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.<pid>:
Permission denied (1100)
```

The same result with supported Node.js identifies a host process-isolation
restriction, not a missing browser, automation failure, or product regression.
Preview, Save, Publish, Create, Rename, and Delete remain unexecuted, so actual
browser Runtime Verification is still incomplete. Run the same command from a
macOS shell or CI host that permits Chromium Mach service registration; no code
change is justified by this environment-only boundary.

The first retry sandbox was removed by the runner. Chromium's restricted process
termination left the second sandbox's linked-dependency repository behind after
its local bare remote had been removed; the residual sandbox was identified and
removed explicitly during final verification. Before/after SHA-256 manifests for
every file under `src/content/` and `public/` were identical, the source checkout
had no production diff, and no `kiki-browser-*` temporary directory remained.
Local `test-results/` evidence is ignored and does not represent an executed
lifecycle flow.

## Audit and choice

The manual six-collection release record and later Create, Rename, and Delete
acceptance records contain strong evidence but no repeatable browser harness.
The repository used Node's test runner for service contracts and Astro for
development, checking, and build; no browser runner was present. Playwright is
the only new test dependency. It fits the npm and TypeScript ecosystem and
supports popup, navigation, disabled-control, and console assertions without
application-specific test hooks.

## Isolation contract

`npm run editor:test:browser` clones the current checkout without hardlinks,
creates and attaches a local bare remote, shares only installed dependencies,
starts Astro on `127.0.0.1`, and runs one serial test. Every Save, Publish,
Rename, backup, and Delete occurs inside that temporary repository. The
deterministic News fixture is created and removed during the flow. The runner
always terminates the server and deletes its sandbox.

This is test infrastructure only. Editor behavior, mutation semantics,
Production consumers, content, assets, and development-only route injection are
unchanged.

## Initial regression coverage

- Editor launch, Dashboard, and News collection navigation.
- Validation fail-closed behavior before Create.
- Draft Preview popup and rendering.
- First Save and evidence-limited ordinary Publish to the isolated remote.
- Reviewed Rename followed by its separate Publish.
- Shared lifecycle-lock conflict failing Save closed.
- Verified-backup Delete and its separate evidence-authorized Publish.
- Expected final navigation and zero browser console/page errors.

Service tests remain responsible for exhaustive graph ambiguity, stale plans,
baseline drift, rollback/push failure, lock ownership races, token binding and
expiry, and exact staging matrices.

## Deferred browser cases

Deferred work includes other collection and Journal locale permutations, Works
native file selection and Replace/Cancel, multiple tabs, terminal manual
recovery guidance, injected failures, responsive and visual regression, and a
broader accessibility pass. Add them only when browser value exceeds maintenance
cost and retain disposable-repository isolation.
