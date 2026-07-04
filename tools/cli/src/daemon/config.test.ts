import { describe, expect, it } from 'bun:test';

import { buildDaemonConfig } from './config';

describe('buildDaemonConfig', () => {
  it('embeds the URL and key the settings command passes non-interactively', () => {
    const config = buildDaemonConfig({
      baseUrl: 'https://acme.tale.dev',
      apiKey: 'tale_secret_key',
    });
    expect(config.baseUrl).toBe('https://acme.tale.dev');
    expect(config.apiKey).toBe('tale_secret_key');
    expect(config.daemonId).toMatch(/^daemon_/);
    expect(config.permissionCeiling).toBe('safe');
    expect(config.workspaces).toEqual({});
  });

  it('trims a trailing slash and falls back to localhost for a blank URL', () => {
    expect(
      buildDaemonConfig({ baseUrl: 'https://acme.tale.dev/' }).baseUrl,
    ).toBe('https://acme.tale.dev');
    expect(buildDaemonConfig({ baseUrl: '  ' }).baseUrl).toBe(
      'http://localhost:3000',
    );
    expect(buildDaemonConfig({}).baseUrl).toBe('http://localhost:3000');
  });

  it('drops blank optional answers instead of storing empty strings', () => {
    const config = buildDaemonConfig({ apiKey: '   ', name: '' });
    expect(config.apiKey).toBeUndefined();
    expect(config.name).toBeUndefined();
    expect(config.defaultWorkspace).toBeUndefined();
  });

  it('derives the advertised workspace key from the path when none is given', () => {
    const config = buildDaemonConfig({ workspacePath: '/home/me/repos/tale' });
    expect(config.workspaces).toEqual({ tale: '/home/me/repos/tale' });
    expect(config.defaultWorkspace).toBe('tale');
  });

  it('honors an explicit workspace key over the path basename', () => {
    const config = buildDaemonConfig({
      workspacePath: '/home/me/repos/tale',
      workspaceKey: 'main',
    });
    expect(config.workspaces).toEqual({ main: '/home/me/repos/tale' });
    expect(config.defaultWorkspace).toBe('main');
  });

  it('keeps an explicitly chosen permission ceiling', () => {
    expect(
      buildDaemonConfig({ permissionCeiling: 'full_auto' }).permissionCeiling,
    ).toBe('full_auto');
  });
});
