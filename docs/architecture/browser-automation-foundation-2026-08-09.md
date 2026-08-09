# Browser Automation Foundation and Regression Coverage

| Property | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Date     | 2026-08-09                                                                 |
| Scope    | Maintainable browser foundation plus representative lifecycle smoke suite  |
| Safety   | Disposable clone, local bare remote, deterministic fixture, localhost only |

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
