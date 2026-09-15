# @tale/e2e

Use this package to configure Playwright tests for Tale’s frontend services and
resolve test locators from the same message catalogs as the application. It is a
source package; consumers import its explicit subpaths without a build step.

## Configure a service

Start with the service generator’s existing `playwright.config.ts`. The shared
factory supplies Chromium, English/UTC defaults, one worker, failure screenshots,
retry traces, and CI retry/`forbidOnly` settings. Keep authentication, fixtures,
server startup, and additional browser projects in the consuming service.

```ts
// services/<name>/playwright.config.ts
import { fileURLToPath } from 'node:url';
import { createPlaywrightConfig } from '@tale/e2e/config';

export default createPlaywrightConfig({
  testDir: fileURLToPath(new URL('./tests/e2e', import.meta.url)),
  port: 3001,
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

The request target is chosen in this order: `E2E_BASE_URL`, the factory’s
`baseURL` option, then `http://localhost:<port>`. Setting a remote request target
does not remove the configured `webServer`; make that startup conditional in the
service config when testing a deployment that needs no local server.

## Use application labels in locators

`createI18n` reads YAML and resolves a dotted key to a string. Pass the package catalogs the
service uses in `packages`; they merge in order beneath the service’s own keys. The merge is
deep, so a service override replaces one key without removing its siblings. The resolver throws
for a missing key or a group. It does not interpolate ICU arguments or apply locale fallback,
so provide the catalogs for the language the test actually renders.

```ts
// services/<name>/tests/e2e/specs/example.spec.ts
import { createI18n } from '@tale/e2e/i18n';

const uiCatalogs = new URL(
  '../../../../../packages/ui/src/i18n/messages/', import.meta.url,
);
const { t } = createI18n(
  new URL('../../../messages/en.yml', import.meta.url),
  { packages: [new URL('global.yml', uiCatalogs), new URL('en.yml', uiCatalogs)] },
);
// t('common.actions.delete') resolves the shared label, unless the service overrides it.
```

For a marketing service, add its `@tale/marketing-ui` catalogs after the UI catalogs, matching
the package order in `initServiceI18n`. The [platform helper](../../services/platform/tests/e2e/helpers/i18n.ts)
shows this setup for an app service.

`@tale/e2e/smoke` provides `collectConsoleErrors(page)` and
`expectPageRenders(page)` for basic page checks. They complement assertions about
the actual task; a visible body alone does not establish a working workflow.

## Run and maintain tests

From the repository root:

```bash
bun run --filter @tale/<name> test:e2e
bun run --filter @tale/e2e test
bun run --filter @tale/e2e typecheck
bun run --filter @tale/e2e lint
```

See the [platform suite](../../services/platform/tests/e2e/README.md) for its
isolated database, accounts and model fixtures. Shared UI browser/component tests
live in `packages/ui`; they do not use this service config factory.
