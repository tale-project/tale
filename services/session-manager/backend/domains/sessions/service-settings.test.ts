// Settings: the start page and AI access, kept in the database.

import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestManager, refusalOf } from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: Parameters<typeof createTestManager>[0]): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

describe('settings', () => {
  it('have defaults', () => {
    const { manager } = setup();
    expect(manager.settings()).toEqual({
      startPage: 'https://www.google.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: false,
    });
  });

  it('check and complete the start page', async () => {
    const { manager } = setup();
    expect(
      manager.updateSettings({ startPage: '  duckduckgo.com ' }).startPage,
    ).toBe('https://duckduckgo.com');
    for (const bad of [
      'javascript:alert(1)',
      'hello world',
      'file:///etc/passwd',
    ]) {
      const refused = await refusalOf(() =>
        manager.updateSettings({ startPage: bad }),
      );
      expect([refused.status, refused.code]).toEqual([
        422,
        'invalid_start_page',
      ]);
      expect(refused.message).toBe(
        'The start page must be a web address, for example https://www.google.com.',
      );
    }
    expect(manager.settings().startPage).toBe('https://duckduckgo.com'); // unchanged
    expect(manager.updateSettings({ startPage: '  ' }).startPage).toBe(
      'https://www.google.com',
    );
    expect(manager.updateSettings({ startPage: '' }).startPage).toBe(
      'https://www.google.com',
    );
  });

  it('change one at a time, and leave the others alone', () => {
    const { manager } = setup();
    manager.updateSettings({ startPage: 'https://example.com' });
    expect(manager.updateSettings({ mcpEnabled: true })).toEqual({
      startPage: 'https://example.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: true,
    });
    expect(manager.updateSettings({}).mcpEnabled).toBe(true);
    expect(
      manager.updateSettings({ startPage: null, mcpEnabled: null }),
    ).toEqual({
      startPage: 'https://example.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: true,
    });
    expect(manager.updateSettings({ mcpEnabled: false }).mcpEnabled).toBe(
      false,
    );
    expect(manager.settings().startPage).toBe('https://example.com');
  });

  it('change nothing when one of them is refused', async () => {
    const { manager } = setup();
    await refusalOf(() =>
      manager.updateSettings({ startPage: 'not an address', mcpEnabled: true }),
    );
    expect(manager.settings().mcpEnabled).toBe(false);
  });

  it('survive a restart', async () => {
    const first = setup({ store: 'file' });
    first.manager.updateSettings({
      startPage: 'https://example.org',
      mcpEnabled: true,
    });
    await first.close({ keepData: true });

    const second = setup({ store: 'file', dataDir: first.dataDir });
    expect(second.manager.settings()).toEqual({
      startPage: 'https://example.org',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: true,
    });
    await second.close();
    rmSync(first.dataDir, { recursive: true, force: true });
  });

  it('fall back to the default for a stored start page that is no good', () => {
    const { manager, store } = setup();
    store.setPreferences({
      start_page: 'javascript:alert(1)',
      mcp_enabled: 'yes',
    });
    expect(manager.settings()).toEqual({
      startPage: 'https://www.google.com',
      defaultStartPage: 'https://www.google.com',
      mcpEnabled: false,
    });
  });
});
