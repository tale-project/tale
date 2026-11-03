import { describe, expect, it } from 'vitest';

import { hasOwnPhoneHeader } from './own-phone-header';

describe('hasOwnPhoneHeader', () => {
  it.each([
    ['a session', '/sessions/12'],
    ['a session, with the slash after it', '/sessions/12/'],
    // An address that is no id says so under the same header.
    ['an address that is no id', '/sessions/abc'],
  ])('is true for the page of %s', (_what, pathname) => {
    expect(hasOwnPhoneHeader(pathname)).toBe(true);
  });

  it.each([
    ['the sessions', '/sessions'],
    ['the sessions, with the slash after them', '/sessions/'],
    ['the proxies', '/proxies'],
    ['the secrets', '/secrets'],
    ['the settings', '/settings'],
    ['a page of the settings', '/settings/general'],
    ['the root', '/'],
    // No page: the page that says so puts its title nowhere else.
    [
      'a page that is beneath a session and does not exist',
      '/sessions/12/nowhere',
    ],
    ['an address that only starts like it', '/sessionsfoo/12'],
  ])('is false for %s', (_what, pathname) => {
    expect(hasOwnPhoneHeader(pathname)).toBe(false);
  });
});
