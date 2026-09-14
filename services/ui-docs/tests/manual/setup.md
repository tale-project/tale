# Setup for a manual round

Everything that has to be in place before the first box: the toolchain, the
stack, and the things that silently invalidate a whole pass. The suites
themselves sit in [`suites/`](suites).

## Prerequisites

| Need | Get it |
|---|---|
| **Toolchain** | bun installs and runs everything. `bun install` at the repo root once. |
| **Browser engines** | `npx playwright install chromium` once — the e2e specs and any chauffeur script need it. |
| **A viewport** | 1440×900 is the default; responsive boxes name their own (393 px is the phone). |
| **Docker** | only for the container probe (`bun run docker:test:ui-docs`) and the built-server boxes in [seo.md](suites/seo.md). |

No accounts, no database, no fixtures: the site is static and English-only. The
only state a round touches is the browser's own (theme choice, recent searches
in `localStorage`).

## Baseline

A round is only honest about a tree whose gates were green **before** it
started. Run these on an untouched checkout and note the results in the
[session log](runs/template-session-log.md); anything already red is
environment, not a finding.

| Gate | Command | From |
|---|---|---|
| the whole check | `bun run check` | repo root |
| this service | `bun run --filter @tale/ui-docs typecheck && bun run --filter @tale/ui-docs lint && bun run --filter @tale/ui-docs test` | repo root |
| the manual layer's own shape | `bun run lint:manual` | repo root |

## Starting the stack

Two modes; every suite header says which one it needs.

**Dev (default)** — the Vite server with the content artifacts rebuilt on
start:

```bash
bun run --filter @tale/ui-docs dev        # http://localhost:3003
UI_DOCS_PORT=3005 bun run --filter @tale/ui-docs dev   # when :3003 is taken
```

The SEO artifacts (`/llms.txt`, `/sitemap.xml`, `/docs/<slug>.md`, …) are
served on demand from `content/` in this mode, but nothing is prerendered and
an unknown route answers `200` with the SPA shell — so the boxes in
[seo.md](suites/seo.md) need the built server.

**Built** — the production pipeline and the Bun server that ships in the image:

```bash
bun run --filter @tale/ui-docs build      # dist/, dist-ssr/, dist-seo/
bun run --filter @tale/ui-docs start      # http://localhost:3003
```

Or the container itself, which is what production runs:

```bash
bun run docker:test:ui-docs               # builds the image, probes it on :13003
```

Wait for the front page's `h1` (**The Tale design system**) before continuing.

<a id="reset-choreography"></a>

## Reset choreography

The single source of truth — every "reset" elsewhere in these files means
exactly this.

1. **There is no server-side state to reset.** The site is static; a reset is
   a browser reset: clear `localStorage` for the origin (theme, recent
   searches) and reload.
2. **Reset only at the boundaries the suites name.** [search.md](suites/search.md)
   builds on the recents its earlier boxes create.
3. **A content edit needs a restart in dev.** The search index and the
   frontmatter manifest are built when `dev` starts; a page added or renamed
   afterwards is invisible to search and to the rail until the server restarts.
4. **The automated suites do not share state with a round.** `test:e2e` boots
   its own server on `UI_DOCS_E2E_PORT` (default 3003); run it on another port
   (`UI_DOCS_E2E_PORT=3005`) beside a round.
5. **Exactly one writer at a time.** Nothing else mutates this site; the only
   thing that can invalidate a round is a second dev server of another checkout
   on the same port — check `lsof -i :3003` before trusting what you see.

## Accounts

None. The site has no sign-in.

## Clean room

When the working clone is busy — a dev server on the port, uncommitted edits —
take a clean room instead of judging a tree you cannot describe: a fresh clone
at the SHA under test, its own install, its own stack. The round record names
the SHA either way.
