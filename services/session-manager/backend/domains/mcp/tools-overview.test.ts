import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors.ts';
import { callTool, jsonOf, textOf } from '../../testing/mcp-client.ts';
import {
  metaFixture,
  sessionFixture,
  settingsFixture,
  stubManager,
} from '../../testing/mcp-stub-manager.ts';

describe('overview', () => {
  it('says where things stand when there is nothing yet', async () => {
    const manager = stubManager({
      meta: () => metaFixture(),
      listSessions: () => [],
    });
    expect(jsonOf(await callTool(manager, 'overview'))).toEqual({
      sessions: [],
      next_session_name: '0001',
      proxies: { total: 0, free: 0, failed: 0, being_checked: 0 },
      secrets: 0,
      start_page: 'https://www.google.com',
      browser: { installed: true, installing: false, problem: null },
      version: '0.1.0',
    });
  });

  it('counts the sessions, proxies and secrets, and names the sessions with their status', async () => {
    const manager = stubManager({
      meta: () =>
        metaFixture({
          nextSessionName: '0002',
          counts: {
            proxies: 2,
            freeProxies: 1,
            failedProxies: 1,
            checkingProxies: 3,
            sessions: 1,
            running: 1,
            secrets: 1,
          },
        }),
      listSessions: () => [sessionFixture()],
      settings: () => settingsFixture({ startPage: 'https://duckduckgo.com' }),
    });
    const status = jsonOf(await callTool(manager, 'overview'));
    expect(status).toMatchObject({
      sessions: [{ name: '0001', status: 'running' }],
      next_session_name: '0002',
      proxies: { total: 2, free: 1, failed: 1, being_checked: 3 },
      secrets: 1,
      start_page: 'https://duckduckgo.com',
    });
  });

  it('says when the browser is not installed, or is being installed, and why it cannot be', async () => {
    const manager = stubManager({
      meta: () =>
        metaFixture({
          browserInstalled: false,
          browserInstalling: true,
          browserInstallError: 'No network.',
        }),
      listSessions: () => [],
    });
    expect(jsonOf(await callTool(manager, 'overview'))).toMatchObject({
      browser: { installed: false, installing: true, problem: 'No network.' },
    });
  });

  it('takes no arguments', async () => {
    const result = await callTool(stubManager(), 'overview', { x: 1 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- x: is not an argument of this tool');
  });
});

describe('get_settings', () => {
  it('says the start page and its default', async () => {
    const manager = stubManager({
      settings: () => settingsFixture({ startPage: 'https://duckduckgo.com' }),
    });
    expect(jsonOf(await callTool(manager, 'get_settings'))).toEqual({
      start_page: 'https://duckduckgo.com',
      default_start_page: 'https://www.google.com',
    });
  });

  it('does not say whether AI access is on: the user alone decides that', async () => {
    const result = await callTool(stubManager(), 'get_settings');
    expect(textOf(result)).not.toMatch(/mcp|ai_access/i);
  });
});

describe('set_start_page', () => {
  it('changes the start page and says what it is now', async () => {
    const updateSettings = vi.fn(() =>
      settingsFixture({ startPage: 'https://duckduckgo.com' }),
    );
    const manager = stubManager({ updateSettings });
    const result = await callTool(manager, 'set_start_page', {
      url: 'duckduckgo.com',
    });
    expect(jsonOf(result)).toEqual({ start_page: 'https://duckduckgo.com' });
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      startPage: 'duckduckgo.com',
    });
  });

  it('passes an empty address on, which restores the default', async () => {
    const updateSettings = vi.fn(() => settingsFixture());
    const manager = stubManager({ updateSettings });
    await callTool(manager, 'set_start_page', { url: '' });
    expect(updateSettings).toHaveBeenCalledWith({ startPage: '' });
  });

  it('passes on the refusal of the manager', async () => {
    const manager = stubManager({
      updateSettings() {
        throw new AppError(
          422,
          'invalid_start_page',
          'The start page must be a web address.',
        );
      },
    });
    const result = await callTool(manager, 'set_start_page', {
      url: 'nonsense words',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The start page must be a web address.');
  });

  it('can only change the start page, never the switch for AI access', async () => {
    const updateSettings = vi.fn(() => settingsFixture());
    const manager = stubManager({ updateSettings });
    const result = await callTool(manager, 'set_start_page', {
      url: 'x.example',
      mcpEnabled: false,
      mcp_enabled: false,
    });
    expect(result.isError).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('needs an address', async () => {
    const result = await callTool(stubManager(), 'set_start_page', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- url: ');
  });
});
