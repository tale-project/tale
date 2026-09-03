import { describe, expect, test } from 'bun:test';

import { checkSandboxToken } from './health-checks';

describe('checkSandboxToken', () => {
  test('an unset token FAILS — the spawner refuses to boot without it', () => {
    const check = checkSandboxToken({});
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('refuses to start');
  });

  test('a blank / whitespace token counts as unset', () => {
    expect(checkSandboxToken({ SANDBOX_TOKEN: '' }).status).toBe('fail');
    expect(checkSandboxToken({ SANDBOX_TOKEN: '   ' }).status).toBe('fail');
  });

  test('a suspiciously short token fails as likely truncated', () => {
    const check = checkSandboxToken({ SANDBOX_TOKEN: 'abc123' });
    expect(check.status).toBe('fail');
    expect(check.detail).toContain('truncated');
  });

  test('a 64-char hex token passes', () => {
    const check = checkSandboxToken({ SANDBOX_TOKEN: 'a'.repeat(64) });
    expect(check.status).toBe('ok');
  });
});
