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
| **A. Live**  | `https://tale.dev/docs`                                     | production base path is `/docs/` (`DOCS_BASE_URL`)                    |
| **B. Local** | `bun run --filter @tale/docs dev` → `http://localhost:3002` | builds the per-locale search index first, then Vite; base path is `/` |

Content comes from the repo-root [`docs/`](../../../../docs/) tree
(`docs/{en,de,fr}/**.md` + `docs/nav.json`); the URL of a page is its slug —
`docs/en/platform/chat/basics.md` serves at `{base}/platform/chat/basics`,
German at `{base}/de/platform/chat/basics`.

## 2. Conventions

- **`{base}`** in the guides = `https://tale.dev/docs` (mode A) or
  `http://localhost:3002` (mode B).
- **Labels**: controls name their i18n key from
  [`services/docs/messages/en.yml`](../../messages/en.yml) (shared-UI
  controls from `packages/ui/src/i18n/messages/en.yml`). A few controls are
  hard-coded English (noted inline in the guides) — treat untranslated output
  on `/de`/`/fr` for those as a **candidate finding**, not a locale bug in
  your run.
- **Checkable expectations**: URL/hash changes, visible elements, clipboard
  contents, values that survive a reload.
- **Screenshots**: `services/docs/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/`
  — create the folder before a run.

## 3. Smoke — the shell renders

| Check          | Route / control                           | Verify                                                                                                                               |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Landing        | `{base}/`                                 | h1 **Tale documentation** renders; sidebar + header visible                                                                          |
| Sidebar        | `{base}/`                                 | the six top groups render: **Start here**, **Cloud**, **Self-hosted**, **Platform**, **Tutorials**, **Development** (`nav.groups.*`) |
| A content page | `{base}/self-hosted/install/quickstart`   | body + **On this page** TOC render                                                                                                   |
| Search         | header **Open search** (`nav.openSearch`) | the dialog opens with the **Search documentation…** input                                                                            |
| Locales        | `{base}/de`, `{base}/fr`                  | localized landing renders                                                                                                            |

```
Smoke: ___/5 checks pass   Console errors: ___   Status: PASS / FAIL
```
