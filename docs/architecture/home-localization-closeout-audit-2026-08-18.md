# Home Localization Closeout Audit

**Date:** 2026-08-18  
**Decision:** Implementation complete; editorial and EN publication gates open

## Current state

Home is the singleton exact-three-file unit
`src/content/home/home/{index.yaml,ja.md,en.md}`. Shared, JA, and EN Editor state,
Load, locale Preview, atomic Save, and exact-three-file draft Publish are
implemented. Home has no Create, Rename, or Delete. Runtime and Editor have no
locale fallback.

JA `/` is intentionally served by the temporary-copy development projection.
The raw `__TODO_HOME_JA_ABOUT_INTRO__` comment is machine-detectable but is not
part of parsed or rendered `about_intro`. JA Preview, Save, and draft Publish
are supported; formal JA capability remains false. Final JA approval requires a
human-approved replacement for `ja.md` field `about_intro` and removal of its
temporary marker/status. The current sentence is not approved canonical prose.

EN `en.md` contains the machine-detectable
`__TODO_HOME_EN_ABOUT_INTRO__` value. EN Preview and formal Production capability
are blocked, JA is never substituted, and `/en/` is absent. The only Home-owned
required EN copy field still awaiting approval is `en.md` `about_intro`.
Optional `seo_title` and `description` remain editorial quality follow-ups, not
capability gates.

## Dependencies and routes

`/` and `/about/` exist. `/en/` and `/en/about/` do not. About Localization is a
Home architecture dependency and an EN Production cutover dependency, but not
a JA runtime blocker. Temporary JA therefore does not disable `/`, while the EN
placeholder and missing EN About route prevent accidental `/en/` exposure.

The Header still unconditionally links to `/en/`. This is not a Home
implementation blocker today, but it is required remediation before EN Home
publication. The target global locale switch asks the route registry for the
same Content ID/page identity in the other locale, renders a link only when that
counterpart is capable, never blindly prefixes a path, and never falls back to
the current locale.

## Legacy `home.md` classification

There are zero Production flat reads/loaders/fallbacks and zero Editor flat
reads or Save/Preview/Publish/staging paths. Remaining references are allowed:

- `src/content-loaders/home/repository.ts`: read-only fail-closed legacy/mixed
  topology detection.
- Home migration manifest/converter/executor and frozen JSON: source evidence,
  staged legacy input, and byte-exact rollback.
- Home foundation/state/browser tests: fixtures and assertions proving legacy
  rejection and absence from Publish.
- Artists/Exhibitions delete tests: historical cross-collection fixtures.
- `editor-phase-2-home.md` and `editor-final-completion-audit-2026-08-09.md`:
  explicitly marked historical/superseded records.

## Evidence and invariance

Frozen manifest SHA-256 is
`10a93185439a12174313e9506001ddeb8843200864ddc020a5751579c3b2f117`.
Its three target hashes match canonical files; source and rollback
`originalBase64` reconstruct the 230-byte source with SHA-256
`e6ff731bab106185610314c04fe429e75da04c531a8d635796254de4ce93b08a`.

The inventory is one directory, exactly three regular files, with no symlink,
legacy file, extra, or residue. Assets remain static references with no asset
lifecycle:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `artists-square.jpg` | 95,398 | `44868dca47e3d150ac60e1af73b366e771541e381d06e6ee4743e6d26296c653` |
| `about-landscape.jpg` | 322,786 | `d1a0d07a85e02fa70beff1fe0207c658a8bb7d53b701627861eff0d0fd77e414` |
| `fallback-hero.webp` | 462,102 | `7f513a9a5035eaf7fac76314676274cf1e1b74da842a5228971a9c0dfd387006` |

## Preview fidelity

Preview covers hero media/fallback, Artists, About, localized `about_intro`,
locale-projected destinations, Featured Exhibitions, and combined Stories.
Intentional differences remain: it is a draft shell rather than pixel-identical
Production presentation; dynamic cards are reduced to titles; SEO/OG metadata
is not previewed; and Production-only analytics/navigation context is not a
draft concern. These differences do not introduce data or locale fallback.

## Closeout decision

- Home Localization implementation: **complete**.
- JA content approval: **open** (`ja.md` `about_intro`).
- EN content approval: **open** (`en.md` `about_intro`).
- EN route prerequisites: **open** (About Localization, `/en/about/`, and
  capability-aware Header projection).

The expansion can close as implementation-complete. Formal project/content
close and EN publication must remain open until the explicitly listed human
editorial and global route prerequisites are satisfied.
