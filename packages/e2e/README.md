# @tale/e2e

Shared Playwright building blocks for Tale's frontend **services** (`platform`,
`web`, `docs`, and any service scaffolded from the plop `react-service`
template). The goal is that every service's `playwright.config.ts` is a thin,
declarative call instead of a copy of the same boilerplate.

> Scope: this package is for the frontend _services_. `packages/ui` keeps its
> Storybook interaction tests (`@storybook/addon-vitest`) and does not use this.

## What it provides

- **`@tale/e2e/config`** — `createPlaywrightConfig(opts)`. House defaults:
  `en-US`/UTC locale, `list` + non-opening `html` reporters, `on-first-retry`
  traces, failure-only screenshots, CI-aware `retries`/`forbidOnly`, a 180s
  per-test budget (cold Vite compiles), and a single `chromium` project unless
  you pass your own `projects`. Override `baseURL`/`port`/`webServer`/`projects`
  per service; `E2E_BASE_URL` always wins over the port-derived URL.
- **`@tale/e2e/i18n`** — `createI18n(messagesUrl)` returns `{ t }`, a dot-path
  resolver over a service's `messages/en.json`, so locators never hardcode
  English literals (AGENTS.md i18n rule).
- **`@tale/e2e/smoke`** — `collectConsoleErrors(page)` and
  `expectPageRenders(page)`: dependency-free assertions for the mostly-static
  marketing/docs sites.

## Minimal service config

```ts
// services/<name>/playwright.config.ts
import { fileURLToPath } from 'node:url';
import { createPlaywrightConfig } from '@tale/e2e/config';

const port = 3001;
export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),
  port,
  webServer: {
    command: 'bun run dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

```ts
// services/<name>/e2e/specs/smoke.spec.ts
import { test, expect } from '@playwright/test';
import { collectConsoleErrors, expectPageRenders } from '@tale/e2e/smoke';
import { createI18n } from '@tale/e2e/i18n';

const { t } = createI18n(new URL('../../messages/en.json', import.meta.url));

test('home renders without console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expectPageRenders(page);
  expect(errors).toEqual([]);
});
```

Run with `bun run --filter @tale/<name> test:e2e`.

The platform suite keeps its app-specific helpers (auth setup, mock-LLM,
hermetic fixtures) under `services/platform/e2e/`; it consumes this package only
for the config factory and shared defaults.
