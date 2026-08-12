# Works Delete Implementation and Browser Acceptance

> **Historical / Superseded:** This is retained flat-runtime browser evidence.
> Current three-file Delete and full lifecycle acceptance are tracked by
> [Works Localization Architecture](./works-localization-architecture-2026-08-12.md).

| Property | Value                                                              |
| -------- | ------------------------------------------------------------------ |
| Status   | Historical / superseded flat-runtime acceptance                    |
| Date     | 2026-08-09                                                         |
| Baseline | `5eadcd4` (`Finalize Works delete asset lifecycle semantics`)      |
| Scope    | Works content Delete, cross-writer exclusion, content-only Publish |

## Outcome

Works Delete now uses the established exact-backup, closed-reference,
reviewed-plan, explicit-confirmation, durable recovery, and evidence-only
Publish contracts. Execution acquires the content lifecycle lock before the
Works asset repository lock and releases in reverse order. It atomically moves
only `src/content/works/<content-id>.md` into content recovery.

The reviewed plan inventories outgoing Artist and ordered image references,
current and prospective asset referrers, canonical asset byte identities, and
the complete Asset Lifecycle v2 evidence tree. It declares empty asset path,
byte, lifecycle, orphan-observation, quarantine, and physical-delete action
sets. Execution and rollback re-hash the canonical asset root and lifecycle
evidence and fail closed if either changes.

All ordinary Editor Save, Create, Publish, Preview-create, and Works upload
routes now use the same non-stealing server-side content lifecycle gate.
Rename and Delete routes keep their existing transaction-owned lock handling.
This prevents direct API calls from bypassing the workspace disabled state.

## Browser acceptance

Real browser acceptance ran against an isolated Git repository and verified:

- missing/stale exact backup refusal and a successful exact-byte proof;
- reviewed identity, Git basis, recovery move, incoming graph, and asset
  consequence display;
- explicit confirmation gating before execution;
- content-only Delete with visible asset URL unchanged;
- Save, Preview, ordinary Publish, and editing disabled while Delete is active;
- representative Artist `works_layout` incoming-reference refusal;
- asset repository lock conflict refusal without lock stealing;
- completed-evidence Publish committing only the single deleted Works Markdown;
- navigation to the Works list after Publish; and
- no browser console warnings or errors.

Isolated repository tests additionally cover stale bytes, parser uncertainty,
unsafe/symlinked asset roots, dual-lock conflict, injected post-move rollback,
byte-exact restoration, asset/lifecycle invariance, manual-recovery terminal
evidence, and one-path Publish authorization.

## Preserved boundaries

Production loaders, canonical production content, canonical production assets,
Asset Lifecycle v2 identities and state transitions, retention timing, and
orphan observation behavior are unchanged. Works Delete creates no lifecycle
observation and grants no asset mutation authority.
