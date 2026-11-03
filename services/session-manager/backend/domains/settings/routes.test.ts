import { describe, expect, it, vi } from 'vitest';

import { settingsSchema } from '../../../lib/api/schemas.ts';
import { settings } from '../../../tests/utils/fixtures.ts';
import { AppError } from '../../errors.ts';
import {
  expectError,
  expectJson,
  stubbedApi,
} from '../../testing/api-client.ts';
import type { Manager } from '../sessions/manager.ts';

describe('GET /api/settings', () => {
  it('answers the start page, its default and AI access', async () => {
    const current = settings({ startPage: 'https://duckduckgo.com' });
    const { client } = stubbedApi({ settings: () => current });
    const response = await client.get('/api/settings');
    expect(await expectJson(response, 200, settingsSchema)).toEqual(current);
  });
});

describe('PATCH /api/settings', () => {
  function patching(result = settings()) {
    const updateSettings = vi.fn<Manager['updateSettings']>(() => result);
    return { updateSettings, ...stubbedApi({ updateSettings }) };
  }

  it('hands over what was sent and answers the settings as they are then', async () => {
    const changed = settings({
      startPage: 'https://example.org',
      mcpEnabled: true,
    });
    const { client, updateSettings } = patching(changed);

    const response = await client.patch('/api/settings', {
      startPage: '  example.org ',
      mcpEnabled: true,
    });

    expect(await expectJson(response, 200, settingsSchema)).toEqual(changed);
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      startPage: '  example.org ',
      mcpEnabled: true,
    });
  });

  it('hands over only what was sent, so the other setting is left alone', async () => {
    const { client, updateSettings } = patching();
    await client.patch('/api/settings', { mcpEnabled: true });
    await client.patch('/api/settings', {});
    expect(updateSettings.mock.calls).toEqual([[{ mcpEnabled: true }], [{}]]);
    expect(Object.keys(updateSettings.mock.calls[1]?.[0] ?? {})).toEqual([]);
  });

  it('hands over a blank start page and null, which the manager reads', async () => {
    const { client, updateSettings } = patching();
    await client.patch('/api/settings', { startPage: '  ' });
    await client.patch('/api/settings', { startPage: null, mcpEnabled: null });
    expect(updateSettings.mock.calls).toEqual([
      [{ startPage: '  ' }],
      [{ startPage: null, mcpEnabled: null }],
    ]);
  });

  it('ignores what it does not know', async () => {
    const { client, updateSettings } = patching();
    await client.patch('/api/settings', { mcpEnabled: false, theme: 'dark' });
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      mcpEnabled: false,
    });
  });

  it('answers a start page the manager refuses with its 422 invalid_start_page', async () => {
    const { client } = stubbedApi({
      updateSettings: () => {
        throw new AppError(
          422,
          'invalid_start_page',
          'The start page must be a web address, for example https://www.google.com.',
        );
      },
    });
    const response = await client.patch('/api/settings', {
      startPage: 'javascript:alert(1)',
    });
    await expectError(response, 422, 'invalid_start_page');
  });

  it.each([
    ['a start page that is not text', { startPage: 5 }, 'startPage'],
    ['AI access that is not a flag', { mcpEnabled: 'yes' }, 'mcpEnabled'],
  ])(
    'refuses %s with a 422 before the manager is asked',
    async (_name, body, field) => {
      const { client, updateSettings } = patching();
      const response = await client.patch('/api/settings', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message).toMatch(new RegExp(`^${field}: `));
      expect(updateSettings).not.toHaveBeenCalled();
    },
  );

  it('refuses a start page of more than 2048 characters with a 422, before the manager is asked', async () => {
    const { client, updateSettings } = patching();
    const response = await client.patch('/api/settings', {
      startPage: `https://example.com/${'a'.repeat(2048)}`,
    });
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toBe(
      'startPage: Too big: expected at most 2048 characters',
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('refuses a request without a body, and a body that is no object', async () => {
    const { client, updateSettings } = patching();
    await expectError(
      await client.patch('/api/settings'),
      422,
      'validation_error',
    );
    await expectError(
      await client.patch('/api/settings', ['x']),
      422,
      'validation_error',
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
