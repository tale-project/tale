# Setup & smoke

Bring a local instance up, sign in, and confirm every page loads. Every guide in
this directory assumes the environment and the authenticated session this file
produces. Run this first; run it once per session.

These are the manual / AI-directed playbooks — they drive a **running** instance
through a browser. They are distinct from the automated Playwright suite
(`services/platform/tests/e2e/`) and the vitest projects (`test`, `test:ui`,
`test:browser`), which boot and tear down their own stack.

## 1. Start the stack

Three modes. Pick by who's running and what's under test.

### A. Deterministic, offline (mock gateway)

**For:** any run — human or AI — that needs deterministic, offline assertions:
canned replies are byte-stable, no keys, no cost.

Replicates the hermetic stack the e2e suite uses: the **`lib/mocks` gateway**
(OpenAPI-driven, port 4141) stands in for every third-party API — a canned chat
reply plus Prism-mocked AI endpoints and integration APIs — so chat, AI, and
integration connectors all work offline with no API keys and no cost. Every new
org is seeded with the `E2E Assistant` agent, the mock provider, the
`Summarize Text` prompt, and the `test` workflow.

```bash
# Terminal 1 — the mock gateway (chat SSE + AI + integration APIs on :4141)
cd services/platform && bun lib/mocks/start.ts

# Terminal 2 — platform dev pointed at the hermetic fixtures config
cd services/platform && \
  TALE_DEV_SKIP_DOCKER=1 \
  TALE_CONFIG_DIR="$(pwd)/tests/e2e/fixtures/config" \
  TALE_CONFIG_BUILTIN_DIR="$(pwd)/tests/e2e/fixtures/config/default" \
  TALE_PROVIDER_KEY_E2E_MOCK=tale-e2e-mock-key \
  TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 \
  TALE_MOCK_INTEGRATIONS_BASE=http://127.0.0.1:4141 \
  bun scripts/dev.ts
```

(The values mirror `services/platform/playwright.config.ts` — keep them in sync
with that file and `tests/e2e/fixtures/config/default/providers/e2e-mock.json`.
`TALE_CONFIG_BUILTIN_DIR` pins the built-in catalog to the fixture's `default/`
org dir, so every new org — wizard-created or API-minted — scaffolds from the
hermetic fixtures (the `e2e-mock` provider, the **E2E Assistant** agent) instead
of the real `builtin-configs/` catalog; without it, `scaffoldNewOrganization`
falls back to the real catalog and `save-auth-state.ts`'s wait for "E2E
Assistant" never resolves. `TALE_MOCK_INTEGRATIONS_BASE` redirects integration
connectors' outbound HTTP to the gateway so you can connect/test integrations
offline. The integration catalog in the fixtures is a symlink to the real
`builtin-configs/integrations`.)

> **Wizard-created orgs are mock-wired too, with `TALE_CONFIG_BUILTIN_DIR` set**
> (observed live): with the var set as above, an org minted through the
> create-organization wizard scaffolds from the same hermetic fixtures as an
> e2e-minted org — the mock provider, the seeded `test` workflow, and the
> agents the fixtures declare. (Without the var, a wizard org instead gets the
> builtin **Assistant** agent and a real **OpenRouter** provider blocked on "No
> API key configured" — that symptom means the var is missing, not that
> wizard orgs are inherently unwired.) The org's live config lands under
> `tests/e2e/fixtures/config/<org-slug>/`.

### B. Full local dev (real provider, full feature set)

**For:** developers manually verifying in-progress working-tree code — host hot
reload (Vite HMR + the Convex watcher) against the real stack. Guides mark
cases that need live credentials as "mode B" rows.

```bash
bun run dev          # repo root: turbo dev for platform + backing services (excludes web/docs)
# or, platform only, skipping the Docker backing services:
bun run --filter @tale/platform dev:fast
```

Then configure a model provider in **Settings → Providers** (an OpenRouter key)
so the AI can respond. Without a provider, chat and tool tests fail with a
provider error — that's environment, not a chat bug; note the distinction.

In modes A and B the app serves at **http://localhost:3000**. Wait for the
log-in page to render before continuing. Override the host with `E2E_BASE_URL`
if needed.

### C. Containerized stack with a seeded login (`docker:dev`)

**For:** unattended AI-tester sessions — one command, a deterministic login,
and a versioned build as the system under test; nothing to click through
before testing starts.

```bash
bun run docker:dev        # repo root; requires Docker; first run builds images
bun run docker:dev:down   # tear down when finished
```

- The app serves through the Caddy proxy at **https://localhost** (self-signed
  cert — run `docker exec tale-proxy caddy trust`, or ignore HTTPS errors in
  the driving browser; `save-auth-state.ts` below already does).
- **Readiness**: `curl -skf https://localhost/api/health` returns
  `{"status":"ok","version":"…"}` once the platform is up.
- **Seeded login**: the entrypoint creates **`dev@tale.test` /
  `TaleDev!Passw0rd`** owning a "Dev Workspace" org on every boot (idempotent;
  default-on via `TALE_DEV_SEED_USER=1` in `compose.dev.yml`, loopback-only by
  design — [`lib/utils/dev-seed-config.ts`](../../lib/utils/dev-seed-config.ts)).
  Skip the wizard and sign in at `/log-in`.
- **Real chat needs one env var in the shell that invokes `docker:dev`**:
  `TALE_PROVIDER_KEY_OPENROUTER=<key>`. The invoker's environment is forwarded
  into the platform container
  ([`scripts/docker-dev-env-override.ts`](../../../../scripts/docker-dev-env-override.ts))
  and pushed into the Convex deployment env, where the builtin OpenRouter
  provider reads it (`secretsEnv` in
  [`builtin-configs/providers/openrouter.json`](../../../../builtin-configs/providers/openrouter.json)).
  This is **operator prep, not a tester step** — a tester session starts with
  the environment already configured, so "No API key configured" during a run
  is a reportable defect, not an environment note.

## 2. Sign in

On mode C the seeded `dev@tale.test` account already exists — sign in at
`/log-in` and skip the rest of this section. On modes A and B a fresh database
has no users, so the **first** account is created one of two ways:

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
writes a Playwright `storageState` file so the browser starts signed in (see the
[test-code](../../.agents/skills/test-code/SKILL.md) skill). By default it mints
a fresh owner + org (modes A/B); set `QA_AUTH_EMAIL` / `QA_AUTH_PASSWORD` to
sign in as an existing account instead — e.g. the mode C seeded login:

```bash
E2E_BASE_URL=https://localhost \
  QA_AUTH_EMAIL=dev@tale.test QA_AUTH_PASSWORD='TaleDev!Passw0rd' \
  bun services/platform/tests/manual/scripts/save-auth-state.ts
```

Otherwise sign in at `/log-in` with an existing local account.

`{org}` throughout the guides is the 16+ character organization id in the
dashboard URL (`/dashboard/AbCd…/chat`).

### Extras some guides need

- **A second user account in the org** — notifications F8–F11,
  settings F23 all need two members. Mint one via `POST /api/auth/sign-up/email`
  and add it under Settings → Organization, or run
  [`scripts/save-auth-state.ts`](scripts/save-auth-state.ts) twice.
- **Sample upload artifacts** — an automation-bundle zip (zip a copy of
  `builtin-configs/automations/github/create-pull-requests`) for automations F14, an integration config package
  (zip a copy of `builtin-configs/integrations/tavily`) for integrations F12,
  and a skill bundle for settings F15.
- **Optional live credentials for mode-B rows** — a real IMAP/SMTP mailbox
  (integrations F9), a Slack app (integrations F11), a moderation-provider key
  (governance F17), and a TTS-capable
  provider (chat F31). Skipping any of these means marking the dependent cases
  **ENVIRONMENT**, per the guides' convention.

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
[`lib/mocks/overrides/canned.ts`](../../lib/mocks/overrides/canned.ts)
for the exact chat payloads, [`lib/mocks/README.md`](../../lib/mocks/README.md)
for the gateway architecture, and
[`tests/e2e/README.md`](../e2e/README.md) for the full determinism
contract.

## 4. Conventions

- **Screenshots**: `services/platform/tests/screenshots/<YYYY-MM-DD_HH_MM>/<area>/` — create the
  folder before a run: `mkdir -p services/platform/tests/screenshots/$(date +%Y-%m-%d_%H_%M)/<area>`.
- **File uploads (AI runs)**: the Playwright MCP's `browser_file_upload` only
  accepts paths inside the repo / `.playwright-mcp/` roots — copy upload
  artifacts into `<repo>/.playwright-mcp/` (gitignored) before attaching them.
- **Toasts are short-lived** in this build — catch them with a
  MutationObserver via `browser_evaluate`, not a multi-second text wait.
- **Browser traces/sessions** (AI runs): land in `.playwright-mcp/` (gitignored)
  when the Playwright MCP runs with `--save-session`.
- **Language**: the app renders in the browser/account locale. The Playwright MCP
  is pinned to `en-US` (`--config=playwright-mcp.config.json`), but a stored
  preference can still override it (a fresh account defaulted to **French** in
  testing). Theme and language live in the **Manage account** menu (top-right
  user icon, `auth.userButton.manageAccount`), NOT Settings → Personalization —
  System/Light/Dark tabs plus a **Language** submenu (`auth.userButton.language`)
  with EN 🇺🇸 / DE 🇩🇪 / FR 🇫🇷 radio options. If visible labels don't match
  `en.yml`, open that menu and pick **English**, or match the active-locale
  value of the cited key.
- **Labels**: every control referenced in a guide names its i18n key
  (`namespace.key`) resolvable from `services/platform/messages/en.yml`. Locate
  by role + visible name, never by CSS.
- **Persisted writes**: verify by reloading and reading the field back, not by
  the transient success toast.

## 5. Smoke — every page loads

Sign in, then visit each route and confirm it renders (content or a real empty
state), no connection error, and no critical console error. This is the run-first
quick pass; deep coverage lives in the per-area guides.

| Route                                                 | Verify                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `/log-in`                                             | login form renders                                             |
| `/dashboard/{org}`                                    | redirects into `/chat`                                         |
| `/dashboard/{org}/chat`                               | chat input + agent/model pickers + starters                    |
| `/dashboard/{org}/automations`                        | **Upload automation** button + grid, or empty state            |
| `/dashboard/{org}/projects`                           | list or empty state                                            |
| `/dashboard/{org}/agents`                             | list (seeded `E2E Assistant` in mode A)                        |
| `/dashboard/{org}/workflows/test`                     | workflow editor canvas (via seeded `test` workflow)            |
| `/dashboard/{org}/documents`                          | list or empty state                                            |
| `/dashboard/{org}/knowledge-entries`                  | list or empty state                                            |
| `/dashboard/{org}/products`                           | list or empty state                                            |
| `/dashboard/{org}/contacts`                           | list or empty state                                            |
| `/dashboard/{org}/websites`                           | list or empty state                                            |
| `/dashboard/{org}/settings/account`                   | profile + security                                             |
| `/dashboard/{org}/settings/personalization`           | user preferences (custom instructions, memories, voice output) |
| `/dashboard/{org}/settings/environment`               | env vars & secrets form                                        |
| `/dashboard/{org}/settings/organization`              | org details                                                    |
| `/dashboard/{org}/settings/teams`                     | teams list                                                     |
| `/dashboard/{org}/settings/branding`                  | branding + preview                                             |
| `/dashboard/{org}/settings/integrations`              | integration catalog                                            |
| `/dashboard/{org}/settings/sandboxes`                 | table or **No active sandboxes**                               |
| `/dashboard/{org}/settings/enterprise-sso`            | SSO config form (or access denied)                             |
| `/dashboard/{org}/settings/api/rest`                  | API keys                                                       |
| `/dashboard/{org}/settings/api/webdav`                | WebDAV connection details                                      |
| `/dashboard/{org}/settings/api/runtimes`              | connect-a-daemon instructions                                  |
| `/dashboard/{org}/settings/providers`                 | provider list                                                  |
| `/dashboard/{org}/settings/token-sources`             | list or empty state                                            |
| `/dashboard/{org}/settings/skills`                    | skills list                                                    |
| `/dashboard/{org}/settings/deployment`                | data-residency page (read-only notice for non-operators)       |
| `/dashboard/{org}/settings/governance/content-models` | governance entry (index redirects here)                        |
| `/dashboard/changelog`                                | release notes                                                  |
| `/docs`                                               | embedded Swagger API docs                                      |

```
Smoke: ___/33 routes load   Console errors: ___   Status: PASS / FAIL
```
