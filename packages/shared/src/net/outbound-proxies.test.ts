import { describe, expect, it } from 'vitest';

import {
  OutboundProxyConfigError,
  parseOutboundProxyUrl,
  parseOutboundProxyUrls,
  splitOutboundProxyList,
} from './outbound-proxies';

describe('splitOutboundProxyList', () => {
  it('splits on commas and whitespace, dropping empties', () => {
    expect(
      splitOutboundProxyList(
        ' http://a.example:8080, http://b.example\nhttp://c.example ,, ',
      ),
    ).toEqual([
      'http://a.example:8080',
      'http://b.example',
      'http://c.example',
    ]);
  });

  it('returns [] for an unset or blank value', () => {
    expect(splitOutboundProxyList(undefined)).toEqual([]);
    expect(splitOutboundProxyList(null)).toEqual([]);
    expect(splitOutboundProxyList(' \n ')).toEqual([]);
  });
});

describe('parseOutboundProxyUrl', () => {
  it('reads host, port and credentials, and states the port', () => {
    expect(
      parseOutboundProxyUrl('http://alice:s3cret@203.0.113.7:8080', 1),
    ).toEqual({
      url: 'http://alice:s3cret@203.0.113.7:8080',
      label: 'http://203.0.113.7:8080',
      host: '203.0.113.7',
      port: 8080,
      credentials: 'alice:s3cret',
    });
  });

  it('defaults to port 80 and takes no credentials', () => {
    expect(parseOutboundProxyUrl('http://proxy.example/', 1)).toEqual({
      url: 'http://proxy.example:80',
      label: 'http://proxy.example:80',
      host: 'proxy.example',
      port: 80,
      credentials: null,
    });
  });

  it('lower-cases the scheme and the host, never the credentials', () => {
    const proxy = parseOutboundProxyUrl('HTTP://Al:Pw@P.Webshare.IO:80', 1);
    expect(proxy.url).toBe('http://Al:Pw@p.webshare.io:80');
    expect(proxy.label).toBe('http://p.webshare.io:80');
  });

  it('keeps percent-encoded credentials as written, which every client decodes alike', () => {
    const proxy = parseOutboundProxyUrl(
      "http://us-1.user_~:a!b$c&d'e(f)g*h+i;j=k:l%2Cm%40n%25o@p.example:3128",
      1,
    );
    expect(proxy.credentials).toBe(
      "us-1.user_~:a!b$c&d'e(f)g*h+i;j=k:l%2Cm%40n%25o",
    );
    // What undici and yt-dlp send: the decoded user name and password.
    const url = new URL(proxy.url);
    expect(decodeURIComponent(url.username)).toBe('us-1.user_~');
    expect(decodeURIComponent(url.password)).toBe(
      "a!b$c&d'e(f)g*h+i;j=k:l,m@n%o",
    );
  });

  it.each([
    ['https://p.example:443', 'is not an http:// proxy URL'],
    ['socks5h://p.example:1080', 'is not an http:// proxy URL'],
    ['p.example:8080', 'is not an http:// proxy URL'],
    ['http://p.example:8080/path', 'has a path, query or fragment'],
    ['http://p.example?x=1', 'has a path, query or fragment'],
    ['http://p.example#x', 'has a path, query or fragment'],
    ['http://p.example//', 'has a path, query or fragment'],
    [
      'http://al@ice:pw@p.example',
      'has a character in its user name or password that must be percent-encoded',
    ],
    [
      'http://alice:p w@p.example',
      'has a character in its user name or password that must be percent-encoded',
    ],
    [
      'http://alice:pw%2@p.example',
      'has a character in its user name or password that must be percent-encoded',
    ],
    [
      'http://alice:pw%zz@p.example',
      'has a character in its user name or password that must be percent-encoded',
    ],
    [
      'http://alice:"pw"@p.example',
      'has a character in its user name or password that must be percent-encoded',
    ],
    [
      'http://alice@p.example',
      'has credentials without both a user name and a password',
    ],
    [
      'http://alice:@p.example',
      'has credentials without both a user name and a password',
    ],
    [
      'http://:pw@p.example',
      'has credentials without both a user name and a password',
    ],
    [
      'http://@p.example',
      'has credentials without both a user name and a password',
    ],
    [
      'http://alice:pw%00x@p.example',
      'encodes a character other than printable ASCII in its user name or password',
    ],
    [
      'http://alice:pw%7F@p.example',
      'encodes a character other than printable ASCII in its user name or password',
    ],
    [
      'http://alice:pw%C3%A9@p.example',
      'encodes a character other than printable ASCII in its user name or password',
    ],
    [
      `http://a:${'p'.repeat(127)}@p.example`,
      'has a user name and password longer than 128 bytes together',
    ],
    [
      `http://a:${'%41'.repeat(127)}@p.example`,
      'has a user name and password longer than 128 bytes together',
    ],
    [
      'http://*:pw@p.example',
      'has a user name squid reads as an instruction (it begins with * or NEGOTIATE)',
    ],
    [
      'http://%2Auser:pw@p.example',
      'has a user name squid reads as an instruction (it begins with * or NEGOTIATE)',
    ],
    [
      'http://%4EEGOTIATE:pw@p.example',
      'has a user name squid reads as an instruction (it begins with * or NEGOTIATE)',
    ],
    ['http://xn--a.example', 'names no valid host'],
    ['http://p.xn--bcher-kva', 'names no valid host'],
    ['http://[2001:db8::1]:8080', 'names an IPv6 address'],
    ['http://', 'names no valid host'],
    ['http://:8080', 'names no valid host'],
    ['http://p_x.example', 'names no valid host'],
    ['http://-p.example', 'names no valid host'],
    ['http://p.example.', 'names no valid host'],
    ['http://p..example', 'names no valid host'],
    ['http://prøxy.example', 'names no valid host'],
    ['http://256.1.1.1', 'names no valid host'],
    ['http://10.1', 'names no valid host'],
    ['http://0x7f.0.0.1', 'names no valid host'],
    ['http://p.0x7f', 'names no valid host'],
    ['http://010.0.0.1', 'names no valid host'],
    ['http://1.2.3.4.5', 'names no valid host'],
    ['http://p.example:0', 'has a port outside 1-65535'],
    ['http://p.example:65536', 'has a port outside 1-65535'],
    ['http://p.example:080', 'has a port outside 1-65535'],
    ['http://p.example:', 'has a port outside 1-65535'],
    ['http://p.example:8a', 'has a port outside 1-65535'],
    ['http://p.example:80:80', 'names no valid host and port'],
  ])('refuses %s', (entry, reason) => {
    expect(() => parseOutboundProxyUrl(entry, 3)).toThrow(
      OutboundProxyConfigError,
    );
    expect(() => parseOutboundProxyUrl(entry, 3)).toThrow(
      `OUTBOUND_PROXY_URLS entry 3 ${reason}`,
    );
  });

  it('accepts printable escapes and credentials of up to 128 bytes, decoded', () => {
    expect(
      parseOutboundProxyUrl('http://alice:a%20b%7E@p.example', 1).credentials,
    ).toBe('alice:a%20b%7E');
    expect(
      parseOutboundProxyUrl(`http://a:${'p'.repeat(126)}@p.example`, 1).port,
    ).toBe(80);
    expect(
      parseOutboundProxyUrl(`http://a:${'%41'.repeat(126)}@p.example`, 1).port,
    ).toBe(80);
    // squid's check for its Kerberos mode is case-sensitive.
    expect(
      parseOutboundProxyUrl('http://negotiate:pw@p.example', 1).credentials,
    ).toBe('negotiate:pw');
  });

  it('accepts what a URL parser reads as a domain, not an address', () => {
    expect(parseOutboundProxyUrl('http://0x7f.example', 1).host).toBe(
      '0x7f.example',
    );
    expect(parseOutboundProxyUrl('http://p.0xg', 1).host).toBe('p.0xg');
    expect(parseOutboundProxyUrl('http://1.2.3.4', 1).host).toBe('1.2.3.4');
  });

  it('never repeats the entry, which may hold a password, in a refusal', () => {
    expect(() =>
      parseOutboundProxyUrl('http://alice:hunter2@p.example/x', 1),
    ).toThrow(/^(?!.*hunter2)/);
  });
});

describe('parseOutboundProxyUrls', () => {
  it('reads every entry in order, a repeated one as often as written', () => {
    expect(
      parseOutboundProxyUrls(
        'http://a.example:1, http://b.example:2 http://a.example:1',
      ).map((proxy) => proxy.label),
    ).toEqual([
      'http://a.example:1',
      'http://b.example:2',
      'http://a.example:1',
    ]);
  });

  it('is empty for an unset or blank value', () => {
    expect(parseOutboundProxyUrls(undefined)).toEqual([]);
    expect(parseOutboundProxyUrls(' , ')).toEqual([]);
  });

  it('names the position of the first malformed entry', () => {
    expect(() =>
      parseOutboundProxyUrls('http://a.example, https://b.example'),
    ).toThrow('OUTBOUND_PROXY_URLS entry 2 is not an http:// proxy URL');
  });
});
