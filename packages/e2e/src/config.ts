import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';

/**
 * House defaults for every Tale frontend service's Playwright suite, so each
 * service's `playwright.config.ts` stays a thin, declarative call. Encodes the
 * settings the platform suite established (issue #179): `en-US`/UTC pinned so
 * i18n-derived locators resolve against `messages/en.yml`, budgets generous
 * enough for cold Vite first-navigation compiles, `list` + non-opening `html`
 * reporters, and CI-aware `retries`/`forbidOnly`.
 */
export interface CreatePlaywrightConfigOptions {
  /** Absolute suite root, e.g. `fileURLToPath(new URL('./e2e', import.meta.url))`. */
  testDir: string;
  /** Dev/preview port; the default base URL is `http://localhost:<port>`. */
  port: number;
  /** Overrides the port-derived base URL; `E2E_BASE_URL` wins over both. */
  baseURL?: string;
  webServer?: PlaywrightTestConfig['webServer'];
  /** Defaults to a single `chromium` (Desktop Chrome) project. */
  projects?: PlaywrightTestConfig['projects'];
  testMatch?: PlaywrightTestConfig['testMatch'];
  /** Per-test budget; defaults to 180s for cold first-navigation compiles. */
  timeout?: number;
  /** Defaults to 1 — suites share one backend/account and mutate state. */
  workers?: number;
  outputDir?: string;
  fullyParallel?: boolean;
}

const DEFAULT_PROJECTS: PlaywrightTestConfig['projects'] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
];

/**
 * Exempt loopback from any ambient HTTP(S) proxy for this runner and every
 * child it spawns (webServers, browsers). Playwright's webServer availability
 * probe follows the proxy env vars, and a local proxy that answers an HTTP
 * error for unreachable loopback ports makes the probe read a dead port as
 * "already available" — the runner then skips booting the stack and every
 * test dies on ECONNREFUSED. Appends rather than overwrites, and leaves the
 * proxy itself intact for genuine egress (package/binary downloads).
 */
function exemptLoopbackFromProxy(env: NodeJS.ProcessEnv): void {
  for (const key of ['NO_PROXY', 'no_proxy'] as const) {
    const entries = new Set(
      (env[key] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    entries.add('localhost');
    entries.add('127.0.0.1');
    entries.add('::1');
    env[key] = [...entries].join(',');
  }
}

export function createPlaywrightConfig(
  options: CreatePlaywrightConfigOptions,
): PlaywrightTestConfig {
  exemptLoopbackFromProxy(process.env);
  const {
    testDir,
    port,
    baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    webServer,
    projects = DEFAULT_PROJECTS,
    testMatch,
    timeout = 180_000,
    workers = 1,
    outputDir = './test-results',
    fullyParallel = false,
  } = options;

  return defineConfig({
    testDir,
    testMatch,
    outputDir,
    fullyParallel,
    workers,
    retries: process.env.CI ? 2 : 0,
    forbidOnly: Boolean(process.env.CI),
    timeout,
    expect: { timeout: 20_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
      baseURL,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      locale: 'en-US',
      timezoneId: 'UTC',
    },
    projects,
    webServer,
  });
}

export { devices };
