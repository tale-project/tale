# Setup & smoke

Bring the marketing site up (or point at the live one) and confirm every page
loads. Every guide in this directory assumes the environment this file
produces. Run this first; run it once per session.

These are the manual / AI-directed playbooks — they drive a **running** site
through a browser. They are distinct from the automated Playwright smoke suite
([`tests/e2e/specs/smoke.spec.ts`](../e2e/specs/smoke.spec.ts)) and the vitest
i18n suite (`lib/i18n/messages.test.ts`), which boot and tear down their own
server. The site is public — **no sign-in exists or is needed**.

## 1. Pick a mode

| Mode              | Command / URL                                                                                                                                     | Forms endpoint                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A. Live site**  | `https://tale.dev`                                                                                                                                | real — see the live-safety rule in [forms.md](forms.md)                               |
| **B. Local prod** | `bun run --filter @tale/web build`, then `WEB_DISCORD_WEBHOOK_URL=<your test webhook> bun run --filter @tale/web start` → `http://localhost:3001` | works; delivery goes to **your** webhook                                              |
| **C. Local dev**  | `bun run --filter @tale/web dev` → `http://localhost:3001`                                                                                        | **absent** — `/api/forms/submit` exists only in `server.ts`; a dev submit fails (404) |

Mode A is the default for a full pass (it exercises the prerendered HTML, the
SEO artifacts, and the real form pipeline). Mode B is required for the Discord
**delivery** rows in [forms.md](forms.md) — create a throwaway Discord webhook
so test submissions never reach the team channel. Mode C is fine for
everything except forms and prerendered-HTML checks ([seo.md](seo.md) F-rows
need the built output or the live site — the dev server serves the unbuilt
`index.html` fallback head).

## 2. Conventions

- **Routes**: English pages live at the root (`/pricing`); German and French
  are URL-prefixed (`/de/pricing`, `/fr/pricing`). `{lang}` in the guides
  means `de` or `fr` — there is **no** `/en` prefix (it redirects to `/`).
- **Labels**: every control referenced in a guide names its i18n key
  resolvable from [`services/web/messages/en.yml`](../../messages/en.yml);
  shared-UI controls (theme/language switcher) resolve from
  `packages/ui/src/i18n/messages/en.yml` + `global.yml`. Locate by role +
  visible name, never by CSS.
- **Checkable expectations**: a URL change, an element/text that becomes
  visible, a response status, or a value that survives a reload. For
  prerendered head checks, read the **served HTML** (`curl` / view-source),
  not the hydrated DOM.
- **Screenshots**: `services/web/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/`
  — create the folder before a run.
- **Live-site safety**: never send a real submission through the production
  contact/demo forms — every delivered submission pings the team's Discord.
  [forms.md](forms.md) documents the honeypot probe that verifies the
  endpoint without delivering.

## 3. Smoke — every page loads

Visit each route and confirm it renders (hero/heading visible), no blank
screen, and no console error. Deep coverage lives in the per-area guides.

| Route                                      | Verify                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `/`                                        | hero **The Orchestrator for AI Agents** (`home.hero.title`)         |
| `/pricing`                                 | heading **Simple, Transparent Pricing** (`pricing.title`)           |
| `/hardware-pricing`                        | heading **Hardware Pricing** (`hardwarePricing.title`)              |
| `/contact`                                 | heading **Contact us** (`contact.title`) + form                     |
| `/request-demo`                            | heading **What drives your business?** (`requestDemo.title`) + form |
| `/legal/privacy-policy`                    | legal document renders                                              |
| `/legal/terms-of-service`                  | legal document renders                                              |
| `/legal/data-processing-agreement`         | document + **DPA**/**TOM** tabs (`legal.tabs.*`)                    |
| `/legal/technical-organizational-measures` | document + tabs                                                     |
| `/legal/personalization`                   | legal document renders                                              |
| `/de`                                      | German hero **Der Orchestrator für KI-Agents**                      |
| `/fr`                                      | French hero **L'orchestrateur pour agents IA**                      |

```
Smoke: ___/12 routes load   Console errors: ___   Status: PASS / FAIL
```
