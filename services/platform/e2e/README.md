# Platform E2E suite (Playwright)

Full-app smoke tests for the platform, driven by [`@playwright/test`](https://playwright.dev) with its own config at [`../playwright.config.ts`](../playwright.config.ts). This suite is separate from the vitest projects (`test`, `test:ui`, `test:browser`) on purpose: it boots the real stack (anonymous Convex backend + Vite via `scripts/dev.ts`) and exercises real multi-page browser flows with `storageState` auth.

## What runs

| Spec                                | Flow                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `specs/auth.spec.ts`                | Login form: wrong-password error, successful login → dashboard                                             |
| `specs/auth-account.spec.ts`        | Logout, change password, 2FA-enroll render, org switching (all throwaway accounts)                         |
| `specs/onboarding.spec.ts`          | Setup/create-org route gating + workspace validation + create org → dashboard                              |
| `specs/chat.spec.ts`                | Send a chat message, assert the streamed assistant reply                                                   |
| `specs/chat-threads.spec.ts`        | New thread → history → reopen → delete; prompt library lists the seeded prompt                             |
| `specs/conversations.spec.ts`       | Conversations list loads and routes between status tabs                                                    |
| `specs/search.spec.ts`              | Chat command palette finds the just-created thread by message content                                      |
| `specs/agents.spec.ts`              | List seeded agent, open editor tabs, create + delete a custom agent, organigram                            |
| `specs/projects.spec.ts`            | Create a project + task (shown in board & list views), then delete the project                             |
| `specs/knowledge.spec.ts`           | Each knowledge list renders; full customer create → edit → delete                                          |
| `specs/settings.spec.ts`            | Account-name save/restore, org name, providers list + drawer, page-loads matrix                            |
| `specs/governance-settings.spec.ts` | Toggle + save the voice-output policy, reload, assert persistence                                          |
| `specs/governance-pages.spec.ts`    | Every governance page renders; guardrails content-safety toggle + restore                                  |
| `specs/automation.spec.ts`          | Run the seeded `test` workflow from the test panel to `completed`                                          |
| `specs/agent-editor.spec.ts`        | Throwaway agent: edit+save instructions/tuning/starters/knowledge/tools; webhook/delegation/metrics render |
| `specs/automation-editor.spec.ts`   | Create a blank automation, edit+save config, run it, render triggers/executions/metrics, then delete       |
| `specs/projects-depth.spec.ts`      | One project: instructions/secrets/rename save, task status/priority/label edit across views, then delete   |
| `specs/knowledge-crud.spec.ts`      | Full CRUD for products, vendors, knowledge-entries; website add-dialog renders (crawler not in stack)      |
| `specs/settings-depth.spec.ts`      | Org rename, API key create/revoke, branding, personalization, team create/delete (capture+restore)         |
| `specs/governance-depth.spec.ts`    | System-prompt + run-code-policy save/restore; DSAR/legal-hold dialogs; logs/usage/trash/feedback render    |
| `specs/chat-depth.spec.ts`          | Text attachment, agent/model picker, create + open + revoke a share link                                   |
| `specs/misc-pages.spec.ts`          | Dashboard/custom-agents redirects, changelog, agents/automations metrics, embedded `/docs` Swagger         |
| `specs/navigation.spec.ts`          | Side-nav between sections, settings→governance, breadcrumbs, 404 (not-found UI), browser back/forward      |
| `specs/validation.spec.ts`          | Negative paths: invalid agent slug, empty project/team names, project cascade-delete typed-phrase gating   |
| `specs/preferences.spec.ts`         | Theme switch (dark, persist, restore), locale switch (German, persist, restore), user-menu items           |
| `specs/chat-advanced.spec.ts`       | Stop generation, regenerate branch, edit-message branch, copy-to-clipboard, multi-turn                     |
| `specs/list-behaviors.spec.ts`      | DataTable search-filter, no-results empty state, pagination across pages (customers)                       |
| `specs/responsive.spec.ts`          | Mobile viewport: bottom tab bar + More sheet, mobile save bar, chat composer, list page                    |
| `specs/keyboard.spec.ts`            | Cmd/Ctrl+K palette, Escape closes a dialog, dialog focus trap, wizard step auto-focus                      |
| `specs/chat-features.spec.ts`       | Message feedback, export dialog, message-info, save-prompt-from-composer, selection-quote, composer menu   |
| `specs/chat-structured.spec.ts`     | Mock-only: `[[NEXT_STEPS]]` structured output renders follow-up buttons; clicking one sends it             |
| `specs/chat-reasoning.spec.ts`      | Mock-only: `reasoning_content` stream renders a collapsed "Thinking" disclosure that expands on click      |
| `specs/chat-tools.spec.ts`          | Mock-only: a `request_human_input` tool call renders the approval card; fill + submit records the response |
| `specs/chat-arena.spec.ts`          | Mock-only: arena two-model compare — enable, stream both columns, record a verdict, exit                   |

`setup/auth.setup.ts` runs first (Playwright project dependency): it creates a fresh per-run account through `POST /api/auth/sign-up/email` (the endpoint accepts new users; only the UI restricts sign-up to the first user), completes org creation, and writes `e2e/.auth/owner.json` (storageState) + `e2e/.auth/context.json` (org id).

## Determinism: the mock LLM

By default the stack boots with `TALE_CONFIG_DIR` pointed at [`fixtures/config`](fixtures/config), which seeds each org with one agent ("E2E Assistant", carrying the `request_human_input` tool) and one provider exposing two chat models, whose `baseUrl` targets the mock OpenAI-compatible SSE server ([`mock-llm/server.ts`](mock-llm/server.ts), port 4141). Chat assertions check the canned reply — no live LLM, no API keys, no cost.

**Scenario triggers.** The mock normally streams the plain `CANNED_REPLY`. When a user message contains a `MOCK_TRIGGERS` substring (see [`mock-llm/canned.ts`](mock-llm/canned.ts)) it emits a richer, still-deterministic stream so the suite can cover advanced chat features: `e2e:reasoning` → `reasoning_content` deltas (thinking timeline), `e2e:nextsteps` → a `[[NEXT_STEPS]]` structured block, `e2e:humaninput` → a `request_human_input` tool call (approval card). Messages with no trigger are unchanged, so every default-path spec is unaffected. The `chat-structured` / `chat-reasoning` / `chat-tools` / `chat-arena` specs depend on this and `test.skip` themselves outside mock mode.

Two env vars make this work and are pushed into the Convex deployment by `scripts/sync-convex-env-from-dotenv.ts`'s process-env passthrough:

- `TALE_PROVIDER_KEY_E2E_MOCK` — resolved by the fixture provider's `secretsEnv` (any non-empty value; the mock ignores auth).
- `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` — the provider host policy blocks loopback `baseUrl`s by default.

## Running locally

```bash
# From the repo root (or services/platform) — boots the whole stack itself:
bun run --filter @tale/platform test:e2e

# Headed/debug mode:
bun run --filter @tale/platform test:e2e:ui

# Inspect the last failure (report lives under services/platform):
bunx playwright show-report services/platform/playwright-report
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
