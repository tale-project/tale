import { afterEach, describe, expect, it, vi } from 'vitest';

import { debugEnabled, debugLog } from './debug.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('debugEnabled', () => {
  it.each(['session-manager', '*', 'other,session-manager', '*,other'])(
    'is on when DEBUG says %j',
    (value) => {
      expect(debugEnabled({ DEBUG: value })).toBe(true);
    },
  );

  it.each([
    undefined,
    '',
    'other',
    'session-manager-extra',
    'my-session-manager',
  ])('is off when DEBUG says %j', (value) => {
    expect(debugEnabled({ DEBUG: value })).toBe(false);
  });
});

describe('debugLog', () => {
  it('says nothing unless DEBUG asks for it', () => {
    const output = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('DEBUG', '');
    debugLog('mcp')('a click was ignored');
    expect(output).not.toHaveBeenCalled();
  });

  it('prints the line under the name of its area when DEBUG asks for it', () => {
    const output = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('DEBUG', 'session-manager');
    debugLog('mcp')('a click was ignored');
    expect(output).toHaveBeenCalledExactlyOnceWith('[mcp] a click was ignored');
  });

  it('looks at DEBUG when the line is written, not when the logger is made', () => {
    const output = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('DEBUG', '');
    const debug = debugLog('remote');
    debug('first');
    vi.stubEnv('DEBUG', '*');
    debug('second');
    expect(output).toHaveBeenCalledExactlyOnceWith('[remote] second');
  });
});
