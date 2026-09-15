# Platform browser tests

Playwright drives the running application through real browser flows. These tests complement the
Vitest server and component suites; they do not replace a manual review of layout, focus, or clarity.
The runnable setup is [`playwright.config.ts`](../../playwright.config.ts).

## Start with an isolated test environment

Install dependencies from the repository root, then install Chromium:

```bash
bun install --frozen-lockfile
bunx playwright install chromium
```

Provide a disposable Postgres database through `DATABASE_URL`. The Playwright configuration starts
the Hono backend and Vite through `scripts/dev.ts`, with Docker startup skipped. It does not create
an isolated database merely because you use a new worktree. Read the
[platform README](../../README.md) for runtime prerequisites.

The default test configuration uses the app database URL for the knowledge bootstrap. That is enough
for tests that do not exercise the corpus; it is not a complete knowledge-indexing installation.
Tests involving actual uploads, indexing, or agent execution need the corresponding object store,
knowledge database, and sandbox services. The [screenshot runbook](../docs-screenshots/README.md)
shows a local stack with those database and storage prerequisites made explicit.

Outside CI, Playwright reuses a server already listening at `E2E_BASE_URL` (default
`http://localhost:3000`). That server keeps its own database, configuration, and provider settings.
Confirm that it is your test stack before running a write test. A worktree isolates files; use separate
service ports, databases, config directories, and storage namespaces to isolate state too.

## Run a focused test

From the repository root:

```bash
bun run --filter @tale/platform test:e2e -- --list
bun run --filter @tale/platform test:e2e -- specs/onboarding.spec.ts
bun run --filter @tale/platform test:e2e:ui
```

Or from `services/platform`:

```bash
bunx playwright test specs/projects.spec.ts --workers=1
bunx playwright show-report playwright-report
```

Start with a focused spec, then broaden to the affected journeys. `E2E_WORKERS` controls normal
worker count. CI sharding and artifacts are defined in the
[E2E workflow](../../../../.github/workflows/e2e.yml), rather than duplicated here.

## Accounts and fixtures

Authenticated specs import `test` and `expect` from [`helpers/fixtures.ts`](helpers/fixtures.ts).
Each worker creates its own owner account and organization, waits for the starter project to exist,
and persists its local session under `.auth/` (gitignored). The `org` fixture supplies that worker's
organization ID and owner email.

Auth and onboarding specs that need an anonymous browser import the base Playwright `test` and use
empty storage state. Do not inherit the worker's signed-in state for a login test.

Worker isolation prevents organizations from being shared across workers. Tests in the same worker
still share its organization: create uniquely named data, restore changed settings, and delete only
fixtures the test created. Never remove another developer's database or configuration to reset a test.

## Model and connector fixtures

In the default mock mode, the configuration starts [`lib/mocks`](../../lib/mocks/README.md) on port
4141. An AI flow also needs a provider credential and model configured in its organization. The
presence of the gateway alone does not make a newly created organization ready for chat. Check the
selected spec's setup and `test.fixme` markers before interpreting skipped coverage.

The docs seeder demonstrates real provider and embedding setup against the mock gateway. Private
provider URLs require `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in the test backend; its fixture key is
`TALE_PROVIDER_KEY_E2E_MOCK`. Use synthetic credentials. `E2E_MOCK_LLM=0` selects the live-provider
mode and skips canned-answer assertions; it does not configure a provider for you.

Connector mock endpoints exist in the gateway, but this does not redirect every runtime connector
call automatically. Verify the actual destination before exercising an external action. Read the
mock README for the boundary between fixture responses and real integration coverage.

## Reuse helpers and assert the result

| Helper | Purpose |
| --- | --- |
| [`helpers/auth.ts`](helpers/auth.ts) | Sign up, sign in, drive the organization wizard, and wait for seeded state |
| [`helpers/env.ts`](helpers/env.ts) | Base URL, mock-mode detection, and named timeout budgets |
| [`helpers/chat.ts`](helpers/chat.ts) | Fill the composer, create a thread, wait for reply completion, and clean up by ID |
| [`helpers/forms.ts`](helpers/forms.ts) | Reload and wait for a stable form before checking persisted values |
| [`helpers/i18n.ts`](helpers/i18n.ts) | Resolve visible labels from the English message catalog |
| [`helpers/totp.ts`](helpers/totp.ts) | Generate test codes for two-factor authentication |

A toast proves feedback appeared; reload and check the saved field to prove persistence. Wait on the
state you need, such as a completed reply or enabled control, rather than adding a fixed delay.
Use stable entity IDs for cleanup and the translated label helper for UI locators.

For a failure, inspect the Playwright report and trace before increasing timeouts or retries. Record
which prerequisites were present, the starting role, the action, and the observed result in the
[manual round process](../manual/readme.md) when a human judgment or product finding is involved.
