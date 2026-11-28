// Analytics is opt-in by environment: a shell that exports `UMAMI_*` turns the
// script and its same-origin proxy on in every site the shared server runs. A
// service that must never send anything anywhere passes `analytics: false` and
// is left alone by whatever the environment holds.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

import { ANALYTICS_CONFIG_ID } from '../analytics/config';

const servers = bunServers();
let directory: string;
let following: string;
let ignoring: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'tale-analytics-option-'));
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><html><head><title>Test</title></head><body>shell</body></html>',
  );
  [following, ignoring] = await servers.start(`
import { startReactServer } from ${JSON.stringify(serverModule)};
process.env.UMAMI_WEBSITE_ID = '2f1c0b9e-6f0a-4c52-9b43-0e8f3f6d7a11';
process.env.UMAMI_URL = 'http://127.0.0.1:9';
process.env.UMAMI_PROXY_TOKEN = 'a-proxy-token-of-sixteen-or-more';
const options = { port: 0, hostname: '127.0.0.1', distDir: ${JSON.stringify(directory)}, logPrefix: 'analytics-test', localeRouting: 'none' };
const following = startReactServer(options);
const ignoring = startReactServer({ ...options, analytics: false });
console.log('READY ' + following.port + ' ' + ignoring.port);
`);
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

describe('the analytics option of startReactServer', () => {
  it('follows UMAMI_* by default: the page names its proxy', async () => {
    const page = await (await fetch(`${following}/`)).text();
    expect(page).toContain(`id="${ANALYTICS_CONFIG_ID}"`);
  });

  it('serves the analytics script through the proxy by default', async () => {
    const script = await fetch(`${following}/_a/script.js`);
    // The collector behind it is not there, which is the proxy's own answer:
    // anything but the 404 of a server that has no analytics.
    expect(script.status).not.toBe(404);
  });

  it('ignores UMAMI_* when it is off: no script in the page', async () => {
    const page = await (await fetch(`${ignoring}/`)).text();
    expect(page).not.toContain(ANALYTICS_CONFIG_ID);
  });

  it('answers the proxy path with a 404 when it is off', async () => {
    const script = await fetch(`${ignoring}/_a/script.js`);
    expect(script.status).toBe(404);
    const event = await fetch(`${ignoring}/_a/api/send`, {
      method: 'POST',
      body: '{}',
    });
    expect(event.status).toBe(404);
  });
});
