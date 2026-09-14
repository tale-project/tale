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

test('the service port supplies the default target', () => {
  delete process.env.E2E_BASE_URL;
  const config = createPlaywrightConfig({
    testDir: '/tmp/tale-config-test',
    port: 3002,
  });
  expect(config.use?.baseURL).toBe('http://localhost:3002');
});
