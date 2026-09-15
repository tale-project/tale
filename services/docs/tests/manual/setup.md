# Setup & smoke

Bring the docs site up (or point at the live one) and confirm the shell
renders. Every guide in this directory assumes the environment this file
produces. Run this first; run it once per session.

These are the manual / AI-directed playbooks — they drive a **running** site
through a browser. They are distinct from the automated Playwright smoke suite
([`tests/e2e/specs/smoke.spec.ts`](../e2e/specs/smoke.spec.ts)) and the large
vitest **content** suite (`services/docs/tests/*.test.ts` — links, images,
navigation, locale mirrors, structure), which run headless against the
markdown corpus. The site is public — **no sign-in exists or is needed**.

## 1. Pick a mode

| Mode         | Command / URL                                               | Notes                                                                 |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| **A. Live**  | `https://docs.tale.dev`                                     | default dedicated docs origin; a subpath deployment can set `DOCS_BASE_URL`                    |
| **B. Local** | `bun run --filter @tale/docs dev` → `http://localhost:3002` | builds the per-locale search index first, then Vite; base path is `/` |

Mode B is the **dev** server — it serves no prerendered HTML, no 301
redirects, no security headers, and registers no service worker. Rows that
depend on those ([seo.md](suites/seo.md), [navigation.md](suites/navigation.md) F9–F12)
need the **built** site instead: `bun run --filter @tale/docs build` then
`bun run --filter @tale/docs start` (Bun server over `dist/` + `dist-seo/`
on `http://localhost:3002`).

> **Service-worker warning**: the docs site is a PWA — once visited, a
> service worker serves cached pages. A manual session against a **rebuilt**
> site must bypass it (hard reload / devtools → Application → Service
> workers → Unregister, or a fresh browser profile), or content checks
> return the **previous** build's pages as false negatives.

Content comes from the repo-root [`docs/`](../../../../docs/) tree
(`docs/{en,de,fr}/**.md` + `docs/nav.json`); the URL of a page is its slug —
`docs/en/platform/chat/basics.md` serves at `{base}/platform/chat/basics`,
German at `{base}/de/platform/chat/basics`.

## 2. Conventions

- **`{base}`** in the guides = `https://docs.tale.dev` (mode A) or
  `http://localhost:3002` (mode B).
- **Labels**: controls name their i18n key from
  [`services/docs/messages/en.yml`](../../messages/en.yml) (shared-UI
  controls from `packages/ui/src/i18n/messages/en.yml`). Resolve service overrides
  and regional fallback when checking a label. Code-copy, heading-link, search
  and page-action controls must follow the selected language.
- **Checkable expectations**: URL/hash changes, visible elements, clipboard
  contents, values that survive a reload.
- **Screenshots**: a task-specific directory outside the clone, recorded in the
  session log. These QA captures are evidence; shipped images use the docs pipeline.

## 3. Smoke — the shell renders

| Check          | Route / control                           | Verify                                                                                                                               |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Landing        | `{base}/`                                 | h1 **Tale documentation** renders; rail + header strip visible                                                                          |
| Sidebar        | `{base}/`                                 | the six top groups render: **Start here**, **Cloud**, **Self-hosted**, **Platform**, **Tutorials**, **Development** (`nav.groups.*`) |
| A content page | `{base}/self-hosted/install/quickstart`   | body + **On this page** TOC render                                                                                                   |
| Search         | header **Open search** (`nav.openSearch`) | the dialog opens with the **Search documentation…** input                                                                            |
| Locales        | `{base}/de`, `{base}/fr`                  | localized landing renders                                                                                                            |

```
Smoke: ___/5 checks pass   Console errors: ___   Status: PASS / FAIL
```
