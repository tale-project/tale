# Platform E2E suite (Playwright)

Full-app smoke tests for the platform, driven by [`@playwright/test`](https://playwright.dev) with its own config at [`../playwright.config.ts`](../playwright.config.ts). This suite is separate from the vitest projects (`test`, `test:ui`, `test:browser`) on purpose: it boots the real stack (anonymous Convex backend + Vite via `scripts/dev.ts`) and exercises real multi-page browser flows with `storageState` auth.

## What runs

| Spec                                | Flow                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `specs/auth.spec.ts`                | Login form: wrong-password error, successful login → dashboard    |
| `specs/chat.spec.ts`                | Send a chat message, assert the streamed assistant reply          |
| `specs/governance-settings.spec.ts` | Toggle + save the voice-output policy, reload, assert persistence |
| `specs/automation.spec.ts`          | Run the seeded `test` workflow from the test panel to `completed` |

`setup/auth.setup.ts` runs first (Playwright project dependency): it creates a fresh per-run account through `POST /api/auth/sign-up/email` (the endpoint accepts new users; only the UI restricts sign-up to the first user), completes org creation, and writes `e2e/.auth/owner.json` (storageState) + `e2e/.auth/context.json` (org id).

## Determinism: the mock LLM

By default the stack boots with `TALE_CONFIG_DIR` pointed at [`fixtures/config`](fixtures/config), which seeds each org with exactly one agent and one provider whose `baseUrl` targets the mock OpenAI-compatible SSE server ([`mock-llm/server.ts`](mock-llm/server.ts), port 4141). Chat assertions check the canned reply — no live LLM, no API keys, no cost.

Two env vars make this work and are pushed into the Convex deployment by `scripts/sync-convex-env-from-dotenv.ts`'s process-env passthrough:

- `TALE_PROVIDER_KEY_E2E_MOCK` — resolved by the fixture provider's `secretsEnv` (any non-empty value; the mock ignores auth).
- `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` — the provider host policy blocks loopback `baseUrl`s by default.

## Running locally

```bash
# From the repo root (or services/platform) — boots the whole stack itself:
bun run --filter @tale/platform test:e2e

# Headed/debug mode:
bun run --filter @tale/platform test:e2e:ui

# Inspect the last failure:
bunx playwright show-report
```

First run: install the browser once with `bunx playwright install chromium`.

The webServer entries use `reuseExistingServer` outside CI. If you already have `bun run dev` running on :3000, the suite reuses it — **your stack's config dir and provider keys**, not the fixtures. In that mode run with `E2E_MOCK_LLM=0` so the chat spec asserts the round-trip instead of the canned text (a real provider key is then required for chat):

```bash
E2E_MOCK_LLM=0 bun run --filter @tale/platform test:e2e
```

State hygiene: the suite never deletes anything. Each run signs up a fresh `e2e-*@tale.test` user and (when the instance already has orgs) creates a fresh org; the org scaffold writes per-org config dirs next to `fixtures/config/default/`, which are gitignored.

## Flake policy

- `workers: 1` — the specs share one backend and one owner account.
- `retries: 2` in CI, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`. Use `bunx playwright show-trace` on the CI artifact to debug.
- Locators resolve labels from `messages/en.json` via [`helpers/i18n.ts`](helpers/i18n.ts) — never hardcode UI strings in specs.
- Negative login tests use throwaway accounts so the login lockout never poisons the shared owner.

## Adding a flow

1. Add `specs/<flow>.spec.ts`; read the org id with `readRunContext()`.
2. Resolve every visible label through `t('namespace.key')`.
3. Keep specs idempotent: unique suffixes for created entities, restore toggled settings, never wipe state.
4. If the flow needs an LLM turn, assert canned content only under `isMockLlmMode()`.

## CI

`.github/workflows/e2e.yml` runs the suite on platform PRs (advisory during burn-in — `continue-on-error` on pull_request events) and nightly (strict). The HTML report and traces are uploaded as artifacts on failure.
