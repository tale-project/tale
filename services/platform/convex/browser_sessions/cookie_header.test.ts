import { describe, expect, it } from 'vitest';

import {
  netscapeJarToCookieHeader,
  parseNetscapeJar,
  registrableDomain,
} from './cookie_header';

/** Build a Netscape jar line from its 7 tab-separated fields. */
function line(
  domain: string,
  includeSub: boolean,
  path: string,
  secure: boolean,
  expiry: number,
  name: string,
  value: string,
): string {
  return [
    domain,
    includeSub ? 'TRUE' : 'FALSE',
    path,
    secure ? 'TRUE' : 'FALSE',
    String(expiry),
    name,
    value,
  ].join('\t');
}

const FAR_FUTURE = 9_999_999_999; // year 2286, safely unexpired

describe('registrableDomain', () => {
  it('collapses subdomains to the last two labels', () => {
    expect(registrableDomain('www.youtube.com')).toBe('youtube.com');
    expect(registrableDomain('m.youtube.com')).toBe('youtube.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('passes through a bare eTLD+1', () => {
    expect(registrableDomain('youtube.com')).toBe('youtube.com');
    expect(registrableDomain('localhost')).toBe('localhost');
  });

  it('normalises case and a trailing dot', () => {
    expect(registrableDomain('WWW.YouTube.COM.')).toBe('youtube.com');
  });
});

describe('parseNetscapeJar', () => {
  it('parses all 7 fields and strips a leading domain dot', () => {
    const jar = line('.youtube.com', true, '/', true, FAR_FUTURE, 'SID', 'abc');
    const [c] = parseNetscapeJar(jar);
    expect(c).toEqual({
      domain: 'youtube.com',
      includeSubdomains: true,
      path: '/',
      secure: true,
      expiry: FAR_FUTURE,
      name: 'SID',
      value: 'abc',
      httpOnly: false,
    });
  });

  it('recognises the #HttpOnly_ prefix as an HttpOnly cookie', () => {
    const jar = `#HttpOnly_${line('.youtube.com', true, '/', true, FAR_FUTURE, 'HSID', 'sec')}`;
    const [c] = parseNetscapeJar(jar);
    expect(c.httpOnly).toBe(true);
    expect(c.name).toBe('HSID');
  });

  it('skips comments, blank lines, and malformed rows', () => {
    const jar = [
      '# Netscape HTTP Cookie File',
      '',
      'not\ttab\tseparated',
      line('youtube.com', false, '/', false, FAR_FUTURE, 'ok', 'v'),
    ].join('\n');
    const parsed = parseNetscapeJar(jar);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('ok');
  });
});

describe('netscapeJarToCookieHeader', () => {
  const jar = [
    line('.youtube.com', true, '/', true, FAR_FUTURE, 'SID', 'abc'),
    line('youtube.com', false, '/', false, FAR_FUTURE, 'PREF', 'xyz'),
    line('.youtube.com', true, '/', true, 1, 'STALE', 'old'), // expired
  ].join('\n');

  it('joins matching, unexpired cookies as name=value pairs', () => {
    const header = netscapeJarToCookieHeader(
      jar,
      'https://www.youtube.com/watch?v=1',
    );
    expect(header).toContain('SID=abc');
    expect(header).toContain('PREF=xyz');
    expect(header).not.toContain('STALE');
  });

  it('drops expired cookies using the injected clock', () => {
    // At epoch 0 nothing is expired; at FAR_FUTURE+1 everything is.
    expect(netscapeJarToCookieHeader(jar, 'https://youtube.com/', 0)).toContain(
      'STALE=old',
    );
    expect(
      netscapeJarToCookieHeader(
        jar,
        'https://youtube.com/',
        FAR_FUTURE * 1000 + 1,
      ),
    ).toBe('');
  });

  it('excludes cookies whose domain does not match the host', () => {
    const other = line('example.com', false, '/', false, FAR_FUTURE, 'X', 'y');
    expect(netscapeJarToCookieHeader(other, 'https://youtube.com/')).toBe('');
  });

  it('respects the cookie path', () => {
    const scoped = line(
      'youtube.com',
      false,
      '/account',
      false,
      FAR_FUTURE,
      'ACC',
      '1',
    );
    expect(netscapeJarToCookieHeader(scoped, 'https://youtube.com/')).toBe('');
    expect(
      netscapeJarToCookieHeader(scoped, 'https://youtube.com/account/settings'),
    ).toBe('ACC=1');
  });

  it('returns empty string for an unparseable URL', () => {
    expect(netscapeJarToCookieHeader(jar, 'not a url')).toBe('');
  });
});
