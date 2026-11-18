# KiKi Gallery

Astro site and local-only content Editor for Works, Journal, Exhibitions,
Artists, News, Home, and About.

## Requirements

- Node.js 22.12.0 or newer (Node 24 LTS is also supported by the current
  toolchain)
- npm and Git
- A clean branch with an upstream remote before using Publish

Confirm the runtime with `node --version` before installing. The Editor writes
canonical repository files. Ordinary and Rename Publish create and push a Git
commit; the separate Delete Publish commits locally without pushing. Do
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

The local Editor has seven registered targets: Works, Journal, Exhibitions,
Artists, News, Home, and About. All support Preview, Save, and Publish subject
to their collection-owned validation. Create, reviewed Rename, and content-only
Delete are available for the five non-singleton collections. Home and About
are singletons without Create, Rename, or Delete.

Each canonical Content Unit consists of `index.yaml`, `ja.md`, and `en.md` in
its Content ID directory. About's Editor lifecycle is implemented independently
of formal public-locale approval: Save and Git Publish do not themselves approve
hours or localized copy. At baseline `19c22839b238127068005aeccf378403222db6b5`,
About hours and both locale statuses are `approved`, and JA/EN public routes are
implemented. Pending/review/placeholder states remain supported validation
states, not a description of that baseline's current content.

Destructive content operations require reviewed plans and explicit
confirmation. Delete additionally requires an exact verified backup and keeps
assets unchanged. Works asset management and managed Hero upload for Journal,
Artists, and Exhibitions are implemented; Batch Replace, storage migration,
cross-collection ownership, and derivatives remain deferred. Home's legacy path
input UI remains a known pending UI task.

Read [Editor v1 Operations](docs/operations/editor-v1-operations.md) before
operating Save, Publish, or asset lifecycle recovery. Use the
[architecture index](docs/architecture/README.md) for current authorities and
reading order. The
[Editor Final Completion Audit](docs/architecture/editor-final-completion-audit-2026-08-09.md)
is historical completion evidence; its earlier topology and scope statements do
not override the current implementation or collection-specific authorities.
