import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The docs specs navigate with `@tale/e2e/client-page`, which imports `jsdom`.
 * Playwright 1.62 loads specs through Node's synchronous `module.registerHooks()`,
 * and on Node 22.21.1, the version the repository pins, that path cannot load
 * jsdom's ES module dependency (`ERR_VM_MODULE_LINK_FAILURE`): no spec loads and
 * the E2E job reads "No tests found" (#4536). The scripts opt back into
 * Playwright's asynchronous loader, as `services/web`'s do. The opt-out can go
 * once no spec imports jsdom, or once the pinned Node loads it synchronously.
 */
const { scripts } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };

describe('docs E2E scripts', () => {
  it.each(['test:e2e', 'test:e2e:ui'])(
    "%s loads the specs through Playwright's asynchronous loader",
    (name) => {
      expect(scripts[name]).toMatch(
        /^PLAYWRIGHT_FORCE_ASYNC_LOADER=1 bunx playwright test\b/,
      );
    },
  );
});
