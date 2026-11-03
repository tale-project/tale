// The settings routes over the real manager: the port of the old app's
// `test_settings.py`.

import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { settingsSchema } from '../../../lib/api/schemas.ts';
import { expectError, expectJson } from '../../testing/api-client.ts';
import { createFlow } from '../../testing/api-flow.ts';
import type { Flow } from '../../testing/api-flow.ts';

let flow: Flow;
beforeEach(() => {
  flow = createFlow();
});
afterEach(() => flow.close());

async function settings() {
  return expectJson(
    await flow.client.get('/api/settings'),
    200,
    settingsSchema,
  );
}

describe('the settings', () => {
  it('start with the default start page and AI access off', async () => {
    expect(await settings()).toEqual({
      startPage: 'https://www.google.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: false,
    });
  });

  it('check the start page and complete it', async () => {
    const response = await flow.client.patch('/api/settings', {
      startPage: '  duckduckgo.com ',
    });
    const changed = await expectJson(response, 200, settingsSchema);
    expect(changed.startPage).toBe('https://duckduckgo.com');

    for (const bad of [
      'javascript:alert(1)',
      'hello world',
      'file:///etc/passwd',
    ]) {
      const refused = await flow.client.patch('/api/settings', {
        startPage: bad,
      });
      await expectError(refused, 422, 'invalid_start_page');
    }
    // Unchanged by the refusals.
    expect((await settings()).startPage).toBe('https://duckduckgo.com');

    const reset = await flow.client.patch('/api/settings', { startPage: '  ' });
    expect((await expectJson(reset, 200, settingsSchema)).startPage).toBe(
      'https://www.google.com',
    );
  });

  it('change one setting and leave the others alone', async () => {
    await flow.client.patch('/api/settings', {
      startPage: 'https://example.com',
    });
    const toggled = await flow.client.patch('/api/settings', {
      mcpEnabled: true,
    });
    expect(await expectJson(toggled, 200, settingsSchema)).toEqual({
      startPage: 'https://example.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: true,
    });
    const untouched = await flow.client.patch('/api/settings', {});
    expect((await expectJson(untouched, 200, settingsSchema)).mcpEnabled).toBe(
      true,
    );
  });

  it('survive a restart', async () => {
    const first = createFlow({ store: 'file' });
    const dataDir = first.dataDir;
    try {
      await first.client.patch('/api/settings', {
        startPage: 'https://example.org',
        mcpEnabled: true,
      });
      await first.close({ keepData: true });

      const second = createFlow({ store: 'file', dataDir });
      try {
        const response = await second.client.get('/api/settings');
        const restored = await expectJson(response, 200, settingsSchema);
        expect([restored.startPage, restored.mcpEnabled]).toEqual([
          'https://example.org',
          true,
        ]);
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
