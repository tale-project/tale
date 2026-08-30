import { describe, expect, it } from 'vitest';

import { isTruthy, shouldOpenBrowser } from './dev-modes';

const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o;

describe('isTruthy', () => {
  it('accepts 1/true/yes/on in any case', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'ON']) {
      expect(isTruthy(v)).toBe(true);
    }
  });
  it('rejects everything else (incl. undefined/empty)', () => {
    for (const v of ['0', 'false', 'no', 'off', '', undefined]) {
      expect(isTruthy(v)).toBe(false);
    }
  });
});

describe('shouldOpenBrowser', () => {
  it('opens by default when nothing is set', () => {
    expect(shouldOpenBrowser(env({}))).toBe(true);
  });

  it('never opens under CI', () => {
    expect(shouldOpenBrowser(env({ CI: 'true' }))).toBe(false);
    // CI wins even if the explicit opt-in is also set.
    expect(shouldOpenBrowser(env({ CI: '1', TALE_DEV_OPEN: '1' }))).toBe(false);
  });

  it('honors the TALE_DEV_OPEN opt-out', () => {
    for (const v of ['0', 'false', 'no', 'off']) {
      expect(shouldOpenBrowser(env({ TALE_DEV_OPEN: v }))).toBe(false);
    }
  });

  it('treats an empty/whitespace TALE_DEV_OPEN as default-open', () => {
    expect(shouldOpenBrowser(env({ TALE_DEV_OPEN: '' }))).toBe(true);
    expect(shouldOpenBrowser(env({ TALE_DEV_OPEN: '  ' }))).toBe(true);
  });

  it('opens when explicitly enabled', () => {
    expect(shouldOpenBrowser(env({ TALE_DEV_OPEN: '1' }))).toBe(true);
  });
});
