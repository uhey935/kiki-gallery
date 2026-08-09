# KiKi Gallery

Astro site and local-only content Editor for Works, Journal, Exhibitions,
Artists, News, and Home.

## Requirements

- Node.js 22.12.0 or newer (Node 24 LTS is also supported by the current
  toolchain)
- npm and Git
- A clean branch with an upstream remote before using Publish

Confirm the runtime with `node --version` before installing. The Editor writes
canonical repository files and Publish creates and pushes a Git commit, so do
not run it from a shared or unexpectedly dirty checkout.

## Setup and commands

```sh
npm ci
npm run dev
```

Open the public site at `http://localhost:4321/` and the Editor at
`http://localhost:4321/editor/`.

| Command                       | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `npm run dev`                 | Development site and local Editor                     |
| `npm run check`               | Astro and TypeScript diagnostics                      |
| `npm run build`               | Production static build in `dist/`                    |
| `npm run preview`             | Serve the production build locally                    |
| `npm run editor:test`         | Editor, Publish, preview, and asset lifecycle tests   |
| `npm run editor:test:browser` | Isolated browser smoke and lifecycle regression suite |
| `npm run journal:test`        | Journal loader and production-boundary tests          |

If the user-level npm cache is not writable, use an isolated cache rather than
changing machine-wide ownership as part of a release:

```sh
npm ci --cache /tmp/kiki-gallery-npm-cache
```

## Editor operations

The completed local Editor supports Preview, Save, and Publish for all six
collections; Create for Works, Journal, Exhibitions, Artists, and News; and
reviewed Rename and content-only Delete for those five non-singleton
collections. Home remains an intentional singleton without Create, Rename, or
Delete.

Destructive content operations require reviewed plans and explicit
confirmation. Delete additionally requires an exact verified backup and keeps
assets unchanged. Batch Replace, non-Works asset management, storage migration,
cross-collection ownership, and derivatives remain deferred.

Read [Editor v1 Operations](docs/operations/editor-v1-operations.md) before
operating Save, Publish, or asset lifecycle recovery. Architecture authority
and reading order are listed there. The current completion decision is recorded
in [Editor Final Completion Audit](docs/architecture/editor-final-completion-audit-2026-08-09.md).
