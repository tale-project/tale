# Platform E2E suite (Playwright)

Full-app tests for the platform, driven by [`@playwright/test`](https://playwright.dev) with its own config at [`../playwright.config.ts`](../playwright.config.ts). This suite is separate from the vitest projects (`test`, `test:ui`, `test:browser`) on purpose: it boots the real stack (anonymous Convex backend + Vite via `scripts/dev.ts`) and exercises real multi-page browser flows.

## Parallel by construction: per-worker isolated orgs

The suite runs `fullyParallel` with multiple workers. The enabler is a **worker-scoped isolated-org fixture** ([`helpers/fixtures.ts`](helpers/fixtures.ts)): each Playwright worker signs up its own throwaway owner account and creates its own organization once, then every test in that worker runs authenticated against that worker's private, fully-seeded org. Because the hermetic stack seeds every new org from `TALE_CONFIG_DIR` (agent + mock provider + prompt + workflow), N workers get N identical, isolated orgs with zero per-test setup — so concurrent specs can never corrupt each other's state.

- **Authenticated specs** `import { test, expect } from '../helpers/fixtures'` and read the org from the `org` fixture: `test('…', async ({ page, org }) => { const { organizationId } = org; … })`. The fixture also supplies `storageState`, so the page is already signed in.
- **Unauthenticated specs** (anything testing sign-up/in, the login form, the create-org wizard, or a second user — `auth`, `auth-account`, `onboarding`, the member side of `rbac`) `import { test, expect } from '@playwright/test'` with an empty `storageState`, so they never trigger the worker bootstrap.

CI shards the suite across four runners (`--shard=i/4`); each shard boots its own stack (isolated backend = full per-shard throughput) and runs `E2E_WORKERS` specs concurrently. Tune local parallelism with `E2E_WORKERS`.

## Shared helpers

| Helper                                       | Purpose                                                                                                                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`helpers/fixtures.ts`](helpers/fixtures.ts) | The worker-scoped `org` fixture + the extended `test`/`expect`.                                                                                                                                                         |
| [`helpers/env.ts`](helpers/env.ts)           | `BASE_URL`, `isMockLlmMode()`, and the named `TIMEOUT` budget — no spec hardcodes a raw millisecond literal.                                                                                                            |
| [`helpers/chat.ts`](helpers/chat.ts)         | `fillComposer`, `sendNewThreadMessage` (returns the thread id), `waitForReplyComplete` (polls the Send⇄Stop toggle, not a text race), `deleteThreadById` (deterministic by id — never `.first()`), `expectCannedReply`. |
| [`helpers/auth.ts`](helpers/auth.ts)         | `signUpViaApi` / `signInViaApi`, `uniqueCredentials`, `createOrgViaWizard`, `waitForSeededOrg`.                                                                                                                         |
| [`helpers/forms.ts`](helpers/forms.ts)       | `reloadAndSettle` — reload then wait for a stable anchor before asserting the persisted field (never the transient toast).                                                                                              |
| [`helpers/totp.ts`](helpers/totp.ts)         | Dependency-free RFC-6238 TOTP for the full 2FA flow.                                                                                                                                                                    |
| [`helpers/seed.ts`](helpers/seed.ts)         | Seeded fixture names (agent / prompt / workflow).                                                                                                                                                                       |
| [`helpers/i18n.ts`](helpers/i18n.ts)         | `t('namespace.key')` — every visible label resolves from `messages/en.yml`; specs never hardcode UI strings.                                                                                                            |

## What runs

| Spec                      | Flow                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`            | Login: wrong-password error; valid login → dashboard                                                                                      |
| `auth-account.spec.ts`    | Logout, change password, **full 2FA enroll→verify→login**, org switching + cross-org data isolation (throwaway accounts)                  |
| `onboarding.spec.ts`      | Create-organization wizard → dashboard                                                                                                    |
| `rbac.spec.ts`            | Owner adds a `member`; the member cannot see the admin-gated "Add member" control                                                         |
| `chat-threads.spec.ts`    | Thread lifecycle (send → history → reopen → delete); prompt library lists the seeded prompt                                               |
| `chat-advanced.spec.ts`   | Stop, regenerate branch, edit-message branch, copy-to-clipboard, multi-turn                                                               |
| `chat-features.spec.ts`   | Feedback, export dialog, save-prompt-from-composer, selection → Quote                                                                     |
| `chat-depth.spec.ts`      | Text attachment; create + open + revoke a share link                                                                                      |
| `chat-scenarios.spec.ts`  | **Mock-only**: reasoning disclosure, `[[NEXT_STEPS]]` buttons, `request_human_input` card, arena two-model verdict, **provider-error UI** |
| `search.spec.ts`          | Chat command palette finds a thread by message content                                                                                    |
| `agents.spec.ts`          | List + open the seeded agent editor; create + delete a custom agent                                                                       |
| `agent-editor.spec.ts`    | One throwaway agent (serial): instructions / tuning / starters / knowledge / tools save + reload                                          |
| `projects.spec.ts`        | Create a project + task (board & list views), then delete                                                                                 |
| `projects-depth.spec.ts`  | Project settings (rename + instructions); secrets CRUD; task live-edit across board ↔ list                                                |
| `knowledge.spec.ts`       | CRUD for customer / product / vendor / knowledge-entry; **document upload → "Queued" for indexing**                                       |
| `settings.spec.ts`        | Account name save/restore, org read-only anchor, providers list + drawer, provider display-name write/restore                             |
| `settings-depth.spec.ts`  | Org rename, API key create/revoke, branding, personalization toggle, team CRUD                                                            |
| `governance.spec.ts`      | Voice-output / system-prompt / run-code / content-safety toggles (save + restore); DSAR + legal-hold dialogs; logs tabs                   |
| `workflow-editor.spec.ts` | Configure + save the seeded `test` workflow; run via the tester; **webhook-trigger fire → execution appears**                             |
| `navigation.spec.ts`      | Side-nav between sections, settings → governance, breadcrumbs, browser back/forward                                                       |
| `page-loads.spec.ts`      | Render-only routes (changelog, embedded `/docs` Swagger, metrics pages, redirects) in one sequential pass                                 |
| `validation.spec.ts`      | Negative paths: invalid agent slug, empty project/team names, project cascade-delete typed-phrase gating                                  |
| `preferences.spec.ts`     | Theme + locale switch (persist + restore), user-menu items                                                                                |
| `list-behaviors.spec.ts`  | DataTable search-filter, pagination across pages                                                                                          |
| `responsive.spec.ts`      | Mobile viewport: bottom tab bar + More sheet; mobile Save bar                                                                             |
| `keyboard.spec.ts`        | Cmd/Ctrl+K command palette                                                                                                                |

## Determinism: the mock gateway

By default the stack boots with `TALE_CONFIG_DIR` pointed at [`fixtures/config`](fixtures/config), which seeds each org with one agent ("E2E Assistant", carrying the `request_human_input` tool) and one provider whose `baseUrl` targets the [`lib/mocks`](../../../packages/mocks/README.md) gateway (port 4141). That one gateway mocks every third-party API offline — the canned chat SSE override plus Prism-mocked AI endpoints (embeddings / image / transcription / TTS) and the integration connector APIs. Chat assertions check the canned reply — no live LLM, no API keys, no cost. Integration connectors are redirected to the gateway via `TALE_MOCK_INTEGRATIONS_BASE`, so [`specs/integrations.spec.ts`](specs/integrations.spec.ts) connects real connectors offline; the fixtures' `default/integrations` is a symlink to the real `builtin-configs/integrations` catalog (no duplication).

**Scenario triggers** (keyword-gated, additive — a message with no trigger gets the plain canned reply byte-for-byte, so default-path specs are unaffected): `e2e:reasoning` → `reasoning_content` deltas (thinking timeline); `e2e:nextsteps` → a `[[NEXT_STEPS]]` block; `e2e:humaninput` → a `request_human_input` tool call; `e2e:error` → an HTTP 500 on the generation call only (router/title still succeed), so the chat surfaces its provider-failure UI. `chat-scenarios.spec.ts` depends on these and `test.skip`s itself outside mock mode.

Two env vars (pushed into the Convex deployment by `scripts/sync-convex-env-from-dotenv.ts`): `TALE_PROVIDER_KEY_E2E_MOCK` (any non-empty value) and `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` (the host policy blocks loopback `baseUrl`s by default).

## Running locally

```bash
# From the repo root (or services/platform) — boots the whole stack itself:
bun run --filter @tale/platform test:e2e

# A subset, with a chosen worker count:
cd services/platform && E2E_WORKERS=2 bunx playwright test specs/chat-threads.spec.ts specs/settings.spec.ts

# Headed/debug mode:
bun run --filter @tale/platform test:e2e:ui

# Inspect the last failure:
bunx playwright show-report services/platform/playwright-report
```

First run: install the browser once with `bunx playwright install chromium`.

`reuseExistingServer` applies outside CI: if you already have `bun run dev` on :3000, the suite reuses it — **your stack's config dir and provider keys**, not the fixtures. In that mode run with `E2E_MOCK_LLM=0` so the chat specs assert the round-trip instead of the canned text (canned-content and `chat-scenarios` assertions are skipped), and a real provider key is required. The default (mock) mode cannot pass against a reused dev stack — the worker bootstrap fails fast with a diagnosis instead of a wall of bare locator timeouts.

### Isolated stack next to a running dev stack

To run the hermetic suite while your dev stack keeps :3000/:3210, use a worktree on another port — a separate checkout gets its **own anonymous Convex deployment** with its own state (the Convex CLI auto-picks free ports and `scripts/dev.ts` adopts them for the probes and the Vite proxy), so nothing touches your dev database:

```bash
git worktree add ../tale-e2e HEAD && cd ../tale-e2e && bun install
cd services/platform
PORT=3100 E2E_BASE_URL=http://localhost:3100 bunx playwright test
```

Do **not** point a hermetic run at the dev deployment instead: the env sync overwrites deployment vars (`ENCRYPTION_SECRET_HEX`, `SITE_URL`, the mock bases) and every E2E write would land in your dev data.

Ambient HTTP(S) proxies (`HTTP_PROXY`/`HTTPS_PROXY`) are exempted for loopback automatically by `@tale/e2e/config` — a local proxy that answers errors for dead ports otherwise convinces Playwright's availability probe that the stack is "already up", it skips booting it, and every test dies on `ECONNREFUSED`.

State hygiene: each worker signs up a fresh `e2e-*@tale.test` user and creates a fresh org; per-worker `owner-w<n>.json` storageState and per-org config dirs are gitignored. The suite never deletes shared state.

## Flake policy

- **Per-worker isolated orgs** remove the cross-spec shared-state races that the old single-org suite papered over with `workers: 1`.
- Chat turns wait on the authoritative Send⇄Stop toggle (`waitForReplyComplete`), not a 120s text-visibility race; thread cleanup is by id (`deleteThreadById`), never positional.
- Save → reload → assert keys off the persisted **field value** (`reloadAndSettle`), never the transient success toast; settings/governance toggles restore unconditionally.
- `retries: 2` in CI, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`. Debug a CI failure with `bunx playwright show-trace` on the per-shard artifact.
- Labels resolve from `messages/en.yml` via [`helpers/i18n.ts`](helpers/i18n.ts) — never hardcode UI strings.

## Adding a flow

1. Add `specs/<flow>.spec.ts`. Authenticated? `import { test, expect } from '../helpers/fixtures'` and take `org`. No auth? `import { test, expect } from '@playwright/test'` + `test.use({ storageState: { cookies: [], origins: [] } })`.
2. Resolve every visible label through `t('namespace.key')`; use the `TIMEOUT.*` constants, never raw millisecond literals.
3. Reuse the helpers (chat / forms); clean up created threads via `deleteThreadById` and restore toggled settings unconditionally.
4. If the flow needs an LLM turn, assert canned content only under `isMockLlmMode()`.

## CI

[`.github/workflows/e2e.yml`](../../../.github/workflows/e2e.yml) runs the platform suite strictly on PRs and nightly: a single `build` job produces the prod bundle once (or restores it from cache) and uploads it as a run artifact, then 16 shard jobs download it, boot their own hermetic stack, and run their test slice — no shard ever runs `bun run build`. The HTML report and traces upload as per-shard artifacts on failure.
