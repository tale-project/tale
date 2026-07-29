# Platform E2E — authoring contract

Rules for writing and extending the Playwright specs in this directory. Read
[`README.md`](README.md) first for the architecture (per-worker isolated orgs,
the mock LLM, CI sharding). This file is the contract for adding a flow without
reintroducing the flakiness the suite was rebuilt to remove.

This is the **automated** suite. The human/AI-driven manual playbooks live in
[`services/platform/tests/manual/`](../manual/README.md) and are executed in a real
browser per the [`browse-web`](../../../../.agents/skills/browse-web/SKILL.md) skill.
When a manual case earns automation, bring it here under these rules.

## Non-negotiables

- **Auth import decides the fixture.** A spec that needs a signed-in, seeded org
  imports `{ test, expect }` from [`./helpers/fixtures`](helpers/fixtures.ts) and
  takes the `org` fixture (`async ({ page, org }) => …`) — `storageState` is
  supplied, so the page is already authenticated against this worker's private
  org. A spec that tests sign-up/in, the login form, the create-org wizard, or a
  second user imports `{ test, expect }` from `@playwright/test` and sets
  `test.use({ storageState: { cookies: [], origins: [] } })` so it never triggers
  the worker bootstrap.
- **Never hardcode UI strings.** Resolve every visible label through
  `t('namespace.key')` ([`helpers/i18n.ts`](helpers/i18n.ts)) and locate by role
  - name. The context pins `en-US`. A literal like `'Save'` is a bug.
- **No raw millisecond literals.** Use the named `TIMEOUT.*` budget from
  [`helpers/env.ts`](helpers/env.ts) (`FIRST_PAINT`, `NAV`, `VISIBLE`, `REPLY`,
  `PERSIST`, `EXECUTION`). The old suite's 329 hand-coded `120_000`s waited on
  the wrong signal.
- **Wait on authoritative state, not races.** A chat turn is done when the
  Send⇄Stop toggle flips (`waitForReplyComplete`), not when text appears. A saved
  value is confirmed by reload-then-read (`reloadAndSettle` from
  [`helpers/forms.ts`](helpers/forms.ts)), never the transient toast.
- **Deterministic cleanup.** Delete created threads by id (`deleteThreadById`),
  never `.first()`. Restore any toggled setting/governance flag unconditionally.
- **LLM assertions are mode-gated.** Assert canned content only under
  `isMockLlmMode()`; `test.skip` scenario specs outside mock mode.

## Reuse the helpers

| Helper                                       | Use for                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`helpers/fixtures.ts`](helpers/fixtures.ts) | the `org` fixture + extended `test`/`expect`                                                            |
| [`helpers/auth.ts`](helpers/auth.ts)         | `signUpViaApi`, `signInViaApi`, `uniqueCredentials`, `createOrgViaWizard`, `waitForSeededOrg`           |
| [`helpers/chat.ts`](helpers/chat.ts)         | `sendNewThreadMessage`, `waitForReplyComplete`, `expectCannedReply`, `deleteThreadById`, `fillComposer` |
| [`helpers/forms.ts`](helpers/forms.ts)       | `reloadAndSettle`                                                                                       |
| [`helpers/totp.ts`](helpers/totp.ts)         | RFC-6238 codes for the 2FA flow                                                                         |
| [`helpers/seed.ts`](helpers/seed.ts)         | backend-seeded starter-content names (the "Getting started" project)                                    |
| [`helpers/env.ts`](helpers/env.ts)           | `BASE_URL`, `isMockLlmMode()`, `TIMEOUT`                                                                |

The `lib/mocks` gateway (booted by `playwright.config.ts`, port 4141) stands in
for every third-party API offline: a canned chat reply plus Prism-mocked AI
endpoints and integration APIs. Keyword triggers in a message exercise specific
chat paths — see [`lib/mocks` canned content](../../../packages/mocks/src/overrides/canned.ts):
`e2e:reasoning`, `e2e:nextsteps`, `e2e:humaninput`, `e2e:error`. Integration
specs (`specs/integrations.spec.ts`) drive the real connector → gateway path via
`TALE_MOCK_INTEGRATIONS_BASE`.

## Adding a flow

1. Add `specs/<flow>.spec.ts`. Pick the fixture by the auth rule above.
2. Resolve every label via `t(...)`; use `TIMEOUT.*`; locate by role + name.
3. Reuse the chat/forms/auth helpers; clean up by id; restore toggles.
4. Gate any LLM-content assertion behind `isMockLlmMode()`.
5. Keep specs independent — no spec may depend on another's state.

## Run locally

```bash
bun run --filter @tale/platform test:e2e                 # boots its own stack
cd services/platform && E2E_WORKERS=2 bunx playwright test specs/<flow>.spec.ts
bun run --filter @tale/platform test:e2e:ui              # headed / debug
bunx playwright show-report services/platform/playwright-report
```

First run: `bunx playwright install chromium`. Against an already-running
`bun run dev`, set `E2E_MOCK_LLM=0` (canned-content + scenario specs skip) and
supply a real provider key.
