# Setup & smoke

Bring a local instance up, sign in, and confirm every page loads. Every guide in
this directory assumes the environment and the authenticated session this file
produces. Run this first; run it once per session.

These are the manual / AI-directed playbooks — they drive a **running** instance
through a browser. They are distinct from the automated Playwright suite
(`services/platform/tests/e2e/`) and the vitest projects (`test`, `test:ui`,
`test:browser`), which boot and tear down their own stack.

## 1. Start the stack

Two modes. Pick by what you're testing.

### A. Deterministic, offline (recommended for chat / AI-driven runs)

Replicates the hermetic stack the e2e suite uses: the **`lib/mocks` gateway**
(OpenAPI-driven, port 4141) stands in for every third-party API — a canned chat
reply plus Prism-mocked AI endpoints and integration APIs — so chat, AI, and
integration connectors all work offline with no API keys and no cost. Every new
org is seeded with the `E2E Assistant` agent, the mock provider, the
`Summarize Text` prompt, and the `test` workflow.

```bash
# Terminal 1 — the mock gateway (chat SSE + AI + integration APIs on :4141)
bun --filter "lib/mocks" start

# Terminal 2 — platform dev pointed at the hermetic fixtures config
cd services/platform && \
  TALE_DEV_SKIP_DOCKER=1 \
  TALE_CONFIG_DIR="$(pwd)/e2e/fixtures/config" \
  TALE_PROVIDER_KEY_E2E_MOCK=tale-e2e-mock-key \
  TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 \
  TALE_MOCK_INTEGRATIONS_BASE=http://127.0.0.1:4141 \
  bun scripts/dev.ts
```

(The values mirror `services/platform/playwright.config.ts` — keep them in sync
with that file and `tests/e2e/fixtures/config/default/providers/e2e-mock.json`.
`TALE_MOCK_INTEGRATIONS_BASE` redirects integration connectors' outbound HTTP to
the gateway so you can connect/test integrations offline. The integration catalog
in the fixtures is a symlink to the real `builtin-configs/integrations`.)

### B. Full local dev (real provider, full feature set)

```bash
bun run dev          # repo root: turbo dev for platform + backing services (excludes web/docs)
# or, platform only, skipping the Docker backing services:
bun run --filter @tale/platform dev:fast
```

Then configure a model provider in **Settings → Providers** (an OpenRouter key)
so the AI can respond. Without a provider, chat and tool tests fail with a
provider error — that's environment, not a chat bug; note the distinction.

The app serves at **http://localhost:3000**. Wait for the log-in page to render
before continuing. Override the host with `E2E_BASE_URL` if needed.

## 2. Sign in

A fresh database has no users, so the **first** account is created one of two
ways:

- **First-run wizard** — open `/setup` and complete it (owner account →
  workspace → optional provider). Only reachable while no user exists.
- **Sign-up endpoint** — the UI hides sign-up after the first user, but
  `POST /api/auth/sign-up/email` still accepts new accounts. This is how the e2e
  suite mints throwaway owners. Password must satisfy the policy
  (length + lower + upper + digit + special), e.g. `TaleE2E!Passw0rd`.

A freshly signed-up user lands on `/dashboard/create-organization` — complete
the create-org wizard (name → **Next** → **Skip** the provider step → **Go to
dashboard**). A user who already has an org goes straight to `/dashboard/{org}`.

For an AI session, [`scripts/save-auth-state.ts`](scripts/save-auth-state.ts)
mints an authenticated owner + org and writes a Playwright `storageState` file so
the browser starts signed in (see the [qa-browser](../../.claude/skills/qa-browser/SKILL.md)
skill). Otherwise sign in at `/log-in` with an existing local account.

`{org}` throughout the guides is the 16+ character organization id in the
dashboard URL (`/dashboard/AbCd…/chat`).

## 3. Determinism notes (mode A)

The mock returns a fixed canned reply for any prompt. Keyword **scenario
triggers** in a message exercise specific UI paths (a message with no trigger
gets the plain canned reply, byte-for-byte):

| Trigger in the message | Exercises                                         |
| ---------------------- | ------------------------------------------------- |
| `e2e:reasoning`        | reasoning / thinking-timeline disclosure          |
| `e2e:nextsteps`        | a `[[NEXT_STEPS]]` suggestion block               |
| `e2e:humaninput`       | a `request_human_input` tool card                 |
| `e2e:error`            | an HTTP 500 on generation → the provider-error UI |

Integrations are deterministic too: connecting an API-key/token integration
(Settings → Integrations) runs the connector's real `testConnection`, whose
outbound HTTP the stack redirects to the gateway — so it succeeds offline against
the spec-backed mock. See
[`packages/mocks/src/overrides/canned.ts`](../../packages/mocks/src/overrides/canned.ts)
for the exact chat payloads, [`packages/mocks/README.md`](../../packages/mocks/README.md)
for the gateway architecture, and
[`tests/e2e/README.md`](../../services/platform/tests/e2e/README.md) for the full determinism
contract.

## 4. Conventions

- **Screenshots**: `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/` — create the
  folder before a run: `mkdir -p services/platform/tests/screenshots/$(date +%Y-%m-%d_%H_%M)/<area>`.
- **Browser traces/sessions** (AI runs): land in `.playwright-mcp/` (gitignored)
  when the Playwright MCP runs with `--save-session`.
- **Language**: the app renders in the browser/account locale. The Playwright MCP
  is pinned to `en-US` (`--config=playwright-mcp.config.json`), but a stored
  personalization preference can still override it (a fresh account defaulted to
  **French** in testing). If visible labels don't match `en.json`, set the
  workspace language to English (Settings → Personalization) or match the
  active-locale value of the cited key.
- **Labels**: every control referenced in a guide names its i18n key
  (`namespace.key`) resolvable from `services/platform/messages/en.json`. Locate
  by role + visible name, never by CSS.
- **Persisted writes**: verify by reloading and reading the field back, not by
  the transient success toast.

## 5. Smoke — every page loads

Sign in, then visit each route and confirm it renders (content or a real empty
state), no connection error, and no critical console error. This is the run-first
quick pass; deep coverage lives in the per-area guides.

| Route                                                 | Verify                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| `/log-in`                                             | login form renders                        |
| `/dashboard/{org}`                                    | redirects into `/chat`                    |
| `/dashboard/{org}/chat`                               | composer + agent/model pickers + starters |
| `/dashboard/{org}/projects`                           | list or empty state                       |
| `/dashboard/{org}/agents`                             | list (seeded `E2E Assistant` in mode A)   |
| `/dashboard/{org}/agents/organigram`                  | org chart canvas                          |
| `/dashboard/{org}/agents/metrics`                     | workforce dashboard                       |
| `/dashboard/{org}/automations`                        | list or empty state                       |
| `/dashboard/{org}/automations/metrics`                | metrics                                   |
| `/dashboard/{org}/conversations/open`                 | inbox list or empty state                 |
| `/dashboard/{org}/documents`                          | list or empty state                       |
| `/dashboard/{org}/knowledge-entries`                  | list or empty state                       |
| `/dashboard/{org}/products`                           | list or empty state                       |
| `/dashboard/{org}/customers`                          | list or empty state                       |
| `/dashboard/{org}/vendors`                            | list or empty state                       |
| `/dashboard/{org}/websites`                           | list or empty state                       |
| `/dashboard/{org}/settings/account`                   | profile + security                        |
| `/dashboard/{org}/settings/personalization`           | theme + language                          |
| `/dashboard/{org}/settings/organization`              | org details                               |
| `/dashboard/{org}/settings/teams`                     | teams list                                |
| `/dashboard/{org}/settings/branding`                  | branding + preview                        |
| `/dashboard/{org}/settings/integrations`              | integration catalog                       |
| `/dashboard/{org}/settings/api/rest`                  | API keys                                  |
| `/dashboard/{org}/settings/providers`                 | provider list                             |
| `/dashboard/{org}/settings/skills`                    | skills list                               |
| `/dashboard/{org}/settings/governance/content-models` | governance entry (index redirects here)   |
| `/dashboard/changelog`                                | release notes                             |
| `/docs`                                               | embedded Swagger API docs                 |

```
Smoke: ___/27 routes load   Console errors: ___   Status: PASS / FAIL
```
