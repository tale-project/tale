import { describe, expect, it } from 'vitest';

import { TOOL_GROUPS } from './tools';

describe('TOOL_GROUPS', () => {
  it('groups the tools as the README does', () => {
    expect(TOOL_GROUPS.map((group) => group.key)).toEqual([
      'overview',
      'sessions',
      'proxies',
      'browser',
      'secrets',
    ]);
    expect(TOOL_GROUPS.map((group) => group.tools.length)).toEqual([
      3, 11, 5, 18, 6,
    ]);
  });

  it('names a tool once', () => {
    const names = TOOL_GROUPS.flatMap((group) => group.tools);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names tools the way an assistant calls them', () => {
    for (const name of TOOL_GROUPS.flatMap((group) => group.tools)) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it('keeps the secret tools together, the one that types a secret among them', () => {
    const secrets = TOOL_GROUPS.find((group) => group.key === 'secrets');
    expect(secrets?.tools).toContain('type_secret');
    expect(secrets?.tools).toContain('get_secret');
  });
});
