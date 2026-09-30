import { afterEach, expect, test } from 'bun:test';

import { createPlaywrightConfig } from './config';

const originalBaseUrl = process.env.E2E_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.E2E_BASE_URL;
  else process.env.E2E_BASE_URL = originalBaseUrl;
});

test('an environment target overrides a service-specific preview URL', () => {
  process.env.E2E_BASE_URL = 'https://review.example.test';
  const config = createPlaywrightConfig({
    testDir: '/tmp/tale-config-test',
    port: 3002,
    baseURL: 'http://localhost:3202',
  });
  expect(config.use?.baseURL).toBe('https://review.example.test');
});

test('a service URL is used when no environment target is set', () => {
  delete process.env.E2E_BASE_URL;
  const config = createPlaywrightConfig({
    testDir: '/tmp/tale-config-test',
    port: 3002,
    baseURL: 'http://localhost:3202',
  });
  expect(config.use?.baseURL).toBe('http://localhost:3202');
});

test('a clean attempt leaves nothing in the test results CI uploads', () => {
  // `.github/workflows/e2e.yml` keeps the report of a green job only when
  // `test-results/` holds more than Playwright's hidden `.last-run.json`
  // (#4013). That tells a recovered flake from a clean run only while
  // artifacts are written for failed or retried attempts alone.
  const config = createPlaywrightConfig({
    testDir: '/tmp/tale-config-test',
    port: 3002,
  });
  expect(config.outputDir).toBe('./test-results');
  expect(config.use).toMatchObject({
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  });
  expect(config.use?.video).toBeUndefined();
  expect(config.reporter).toContainEqual(['html', { open: 'never' }]);
});

test('the service port supplies the default target', () => {
  delete process.env.E2E_BASE_URL;
  const config = createPlaywrightConfig({
    testDir: '/tmp/tale-config-test',
    port: 3002,
  });
  expect(config.use?.baseURL).toBe('http://localhost:3002');
});
