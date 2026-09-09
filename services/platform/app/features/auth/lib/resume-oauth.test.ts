import { afterEach, describe, expect, it, vi } from 'vitest';

import { resumeOAuthSignIn } from './resume-oauth';

afterEach(() => vi.unstubAllGlobals());

describe('native OAuth continuation after login or MFA', () => {
  it('preserves repeated signed query values byte for byte', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', {
      __ENV__: { BASE_PATH: '/desk' },
      location: { origin: 'https://tale.example.test', assign },
    });
    const path =
      '/desk/oauth/continue?ba_param=state&ba_param=nonce&sig=bytes%2B%2F%3D';
    expect(resumeOAuthSignIn(path)).toBe(true);
    expect(assign).toHaveBeenCalledWith(`https://tale.example.test${path}`);
  });
  it.each([
    undefined,
    '',
    'https://evil.example.test/oauth/continue',
    '//evil.example.test',
    '/dashboard',
    '/oauth/continue/foreign',
    '/oauth/continue%2f..%2fdashboard',
  ])(
    'leaves an unrelated or unsafe return path to normal routing (%s)',
    (path) => {
      const assign = vi.fn();
      vi.stubGlobal('window', {
        location: { origin: 'https://tale.example.test', assign },
      });
      expect(resumeOAuthSignIn(path)).toBe(false);
      expect(assign).not.toHaveBeenCalled();
    },
  );
  it('does not navigate on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(resumeOAuthSignIn('/oauth/continue')).toBe(false);
  });
});
