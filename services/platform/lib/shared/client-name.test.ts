import { describe, expect, it } from 'vitest';

import { CLIENT_NAME_MAX, displayClientName } from './client-name';

describe('displayClientName', () => {
  it('keeps an ordinary client name as it is', () => {
    expect(displayClientName('Claude Code')).toBe('Claude Code');
    expect(displayClientName('codex-mcp-client')).toBe('codex-mcp-client');
  });

  it('names nothing for a value that is not a string or holds no text', () => {
    expect(displayClientName(undefined)).toBeNull();
    expect(displayClientName(42)).toBeNull();
    expect(displayClientName({ name: 'x' })).toBeNull();
    expect(displayClientName('   \n\t ')).toBeNull();
  });

  it('turns control characters into spaces and collapses whitespace', () => {
    expect(displayClientName('Claude\nCode\u0000\u0085 2')).toBe(
      'Claude Code 2',
    );
  });

  it('removes bidi overrides and isolates so a name cannot reorder its line', () => {
    const name = displayClientName('Safe‮edoc‬⁦Agent⁩‪‫‭⁧⁨');
    expect(name).toBe('SafeedocAgent');
    expect(name).not.toMatch(/[‪-‮⁦-⁩]/);
  });

  it('cuts a long name at the limit with an ellipsis', () => {
    const name = displayClientName('a'.repeat(500));
    expect(name).toHaveLength(CLIENT_NAME_MAX);
    expect(name?.endsWith('…')).toBe(true);
  });

  it('never stores more code points than the limit, even when characters are made of several', () => {
    // A flag is one user-perceived character of two code points.
    const flag = '🇨🇭';
    const name = displayClientName(flag.repeat(60)) ?? '';
    expect(Array.from(name).length).toBeLessThanOrEqual(CLIENT_NAME_MAX);
    expect(name.endsWith('…')).toBe(true);
    // Whole characters only: no flag is cut in half.
    expect(name.replace(/…$/, '').split(flag).join('')).toBe('');
  });
});
