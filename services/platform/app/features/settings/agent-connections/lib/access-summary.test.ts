import { describe, expect, it } from 'vitest';

import { summarizeAccess } from './access-summary';

describe('summarizeAccess', () => {
  it('names the highest level the scopes hold whole', () => {
    expect(summarizeAccess(['tale:mcp']).level).toBe('read');
    expect(summarizeAccess(['tale:mcp', 'tale:automations.write']).level).toBe(
      'edit',
    );
    expect(
      summarizeAccess([
        'tale:mcp',
        'tale:automations.write',
        'tale:automations.deploy',
      ]).level,
    ).toBe('deploy');
  });

  it('names no level for scopes that leave out reading and testing', () => {
    expect(summarizeAccess(['tale:automations.write']).level).toBeNull();
    expect(summarizeAccess([]).level).toBeNull();
  });

  it('does not take deploying for a level without editing under it', () => {
    expect(summarizeAccess(['tale:mcp', 'tale:automations.deploy']).level).toBe(
      'read',
    );
  });

  it('lists the extras beside the level, in the order they are taught', () => {
    expect(
      summarizeAccess([
        'tale:subscriptions.connect',
        'tale:mcp',
        'tale:settings.read',
      ]),
    ).toEqual({
      level: 'read',
      extras: ['tale:settings.read', 'tale:subscriptions.connect'],
    });
  });

  it('lets changing settings say that it reads them too', () => {
    expect(
      summarizeAccess(['tale:mcp', 'tale:settings.read', 'tale:settings.write'])
        .extras,
    ).toEqual(['tale:settings.write']);
  });

  it('ignores a scope it does not know, such as staying signed in', () => {
    expect(summarizeAccess(['tale:mcp', 'offline_access', 'openid'])).toEqual({
      level: 'read',
      extras: [],
    });
  });
});
