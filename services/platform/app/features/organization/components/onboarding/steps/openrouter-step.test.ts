import { describe, expect, it } from 'vitest';

import { classifyConnectError } from './openrouter-step';

describe('classifyConnectError', () => {
  it('classifies auth failures (rejected/invalid key)', () => {
    expect(
      classifyConnectError(new Error('Request failed: 401 Unauthorized')),
    ).toBe('auth');
    expect(classifyConnectError(new Error('403 Forbidden'))).toBe('auth');
    expect(classifyConnectError(new Error('Invalid API key provided'))).toBe(
      'auth',
    );
    expect(classifyConnectError('unauthorized')).toBe('auth');
  });

  it('classifies network/transport failures', () => {
    expect(classifyConnectError(new Error('fetch failed'))).toBe('network');
    expect(classifyConnectError(new Error('Failed to fetch'))).toBe('network');
    expect(classifyConnectError(new Error('request timed out'))).toBe(
      'network',
    );
    expect(classifyConnectError(new Error('connect ECONNREFUSED'))).toBe(
      'network',
    );
    expect(classifyConnectError(new Error('getaddrinfo ENOTFOUND'))).toBe(
      'network',
    );
  });

  it('falls back to generic for anything else', () => {
    expect(classifyConnectError(new Error('upstream exploded'))).toBe(
      'generic',
    );
    expect(classifyConnectError(undefined)).toBe('generic');
  });
});
