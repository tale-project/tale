// The meta route over the real manager: the port of the meta parts of the old
// app's `test_api.py`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { metaSchema } from '../../../lib/api/schemas.ts';
import { expectError, expectJson } from '../../testing/api-client.ts';
import { addProxy, createFlow, waitForChecks } from '../../testing/api-flow.ts';
import type { Flow } from '../../testing/api-flow.ts';

let flow: Flow;
beforeEach(() => {
  flow = createFlow({ version: '1.2.3' });
});
afterEach(() => flow.close());

async function meta() {
  return expectJson(await flow.client.get('/api/meta'), 200, metaSchema);
}

describe('the meta', () => {
  it('tells the app, the browser and the counts', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    flow.checker.setError('192.0.2.2:8080', 'boom');
    await addProxy(flow.client, '192.0.2.2:8080');
    await waitForChecks(flow);

    const overview = await meta();

    expect(overview.version).toBe('1.2.3');
    expect(overview.browserVersion).toBe(flow.backend.browserVersion);
    expect(overview.browserInstalled).toBe(true);
    expect([overview.browserInstalling, overview.browserInstallError]).toEqual([
      false,
      null,
    ]);
    expect(overview.osOptions).toEqual(['random', 'windows', 'macos', 'linux']);
    expect(overview.nextSessionName).toBe('0001');
    expect(overview.counts).toEqual({
      proxies: 2,
      freeProxies: 1,
      failedProxies: 1,
      checkingProxies: 0,
      sessions: 0,
      running: 0,
      secrets: 0,
    });
  });

  it('reports the install of the browser, and refuses sessions meanwhile', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    flow.backend.installed = false;
    flow.backend.install = { installing: true, error: null, progress: null };
    const installing = await meta();
    expect([
      installing.browserInstalled,
      installing.browserInstalling,
      installing.browserInstallError,
    ]).toEqual([false, true, null]);
    await expectError(
      await flow.client.post('/api/sessions', {}),
      503,
      'browser_installing',
    );

    flow.backend.install = {
      installing: false,
      error: 'no space left on device',
      progress: null,
    };
    const failed = await meta();
    expect(failed.browserInstalling).toBe(false);
    expect(failed.browserInstallError).toBe('no space left on device');
    await expectError(
      await flow.client.post('/api/sessions', {}),
      503,
      'browser_not_installed',
    );

    flow.backend.installed = true; // installed by hand since: the old issue is moot
    expect((await meta()).browserInstallError).toBeNull();
  });
});
