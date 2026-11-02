import { describe, expect, it } from 'vitest';

import { MAX_PROXY_IMPORT, MAX_PROXY_LINE } from '../../../lib/proxy-limits.ts';
import {
  PROXY_PARSE_CODES,
  ProxyParseError,
  maskCredentials,
  parseProxy,
  parseProxyList,
} from './parsing.ts';
import type {
  ParseOptions,
  ProxyParseCode,
  ProxyParseParams,
} from './parsing.ts';
import { displayOf, identityKeyOf, toPlaywrightProxy } from './types.ts';
import type { ProxyConfig, ProxyScheme } from './types.ts';

function P(
  scheme: ProxyScheme,
  host: string,
  port: number,
  username: string | null = null,
  password: string | null = null,
): ProxyConfig {
  return { scheme, host, port, username, password };
}

/** The error `parseProxy` throws for `text`. */
function refusal(text: string, options?: ParseOptions): ProxyParseError {
  try {
    parseProxy(text, options);
  } catch (error) {
    if (error instanceof ProxyParseError) return error;
    throw error;
  }
  throw new Error('the input was accepted');
}

describe('parseProxy', () => {
  it.each<[string, ProxyConfig]>([
    // URL forms
    [
      'http://user:pass@1.2.3.4:8080',
      P('http', '1.2.3.4', 8080, 'user', 'pass'),
    ],
    [
      'HTTP://User:Pass@Proxy.Example.COM:3128/',
      P('http', 'proxy.example.com', 3128, 'User', 'Pass'),
    ],
    [
      'https://u:p@secure.example.com:443',
      P('https', 'secure.example.com', 443, 'u', 'p'),
    ],
    ['socks5://u:p@10.0.0.1:1080', P('socks5', '10.0.0.1', 1080, 'u', 'p')],
    ['socks5h://10.0.0.1:1080', P('socks5', '10.0.0.1', 1080)],
    ['socks://10.0.0.1:1080', P('socks5', '10.0.0.1', 1080)],
    ['  http://1.2.3.4:8080\n', P('http', '1.2.3.4', 8080)],
    [
      '\ufeff1.2.3.4:8080:user:pass\r\n',
      P('http', '1.2.3.4', 8080, 'user', 'pass'),
    ],
    ['http://user@1.2.3.4:8080', P('http', '1.2.3.4', 8080, 'user', null)],
    ['http://@1.2.3.4:8080', P('http', '1.2.3.4', 8080)],
    // percent-encoded and raw special characters
    [
      'http://user:p%40ss%3Aw%2Frd%25@host.com:80',
      P('http', 'host.com', 80, 'user', 'p@ss:w/rd%'),
    ],
    [
      'http://user:p@ss:w/rd#?@host.com:80',
      P('http', 'host.com', 80, 'user', 'p@ss:w/rd#?'),
    ],
    [
      'http://user:p%C3%A4ss@host.com:80',
      P('http', 'host.com', 80, 'user', 'päss'),
    ],
    // no scheme
    ['1.2.3.4:8080', P('http', '1.2.3.4', 8080)],
    ['localhost:3128', P('http', 'localhost', 3128)],
    ['user:pass@1.2.3.4:8080', P('http', '1.2.3.4', 8080, 'user', 'pass')],
    ['1.2.3.4:8080@user:pass', P('http', '1.2.3.4', 8080, 'user', 'pass')],
    ['1.2.3.4:8080:user:pass', P('http', '1.2.3.4', 8080, 'user', 'pass')],
    [
      'gate.provider.io:7000:customer-abc-sessid-123:pw',
      P('http', 'gate.provider.io', 7000, 'customer-abc-sessid-123', 'pw'),
    ],
    ['user:pass:1.2.3.4:8080', P('http', '1.2.3.4', 8080, 'user', 'pass')],
    [
      'user:12345:proxy.example.com:8080',
      P('http', 'proxy.example.com', 8080, 'user', '12345'),
    ],
    ['1.2.3.4:8080:user:pa:ss', P('http', '1.2.3.4', 8080, 'user', 'pa:ss')],
    // colon forms are literal
    ['1.2.3.4:8080:user:p%41ss', P('http', '1.2.3.4', 8080, 'user', 'p%41ss')],
    [
      '1.2.3.4:8080:user:p@ss:w/rd',
      P('http', '1.2.3.4', 8080, 'user', 'p@ss:w/rd'),
    ],
    [
      '63.246.153.230:5899:user:12345',
      P('http', '63.246.153.230', 5899, 'user', '12345'),
    ],
    // scheme + colon form
    [
      'socks5://1.2.3.4:1080:user:pass',
      P('socks5', '1.2.3.4', 1080, 'user', 'pass'),
    ],
    ['https://[::1]:8443:user:pass', P('https', '::1', 8443, 'user', 'pass')],
    // IPv6
    ['[::1]:8080', P('http', '::1', 8080)],
    ['[2001:DB8:0:0::1]:3128', P('http', '2001:db8::1', 3128)],
    ['http://u:p@[2001:db8::1]:8080', P('http', '2001:db8::1', 8080, 'u', 'p')],
    ['user:pass:[::1]:8080', P('http', '::1', 8080, 'user', 'pass')],
    // host normalization
    ['Proxy.Example.com.:8080', P('http', 'proxy.example.com', 8080)],
    ['bücher.example:8080', P('http', 'xn--bcher-kva.example', 8080)],
  ])('parses %j', (text, expected) => {
    expect(parseProxy(text)).toEqual(expected);
  });

  it('gives inputs without a scheme the default scheme', () => {
    expect(parseProxy('1.2.3.4:1080', { defaultScheme: 'socks5' }).scheme).toBe(
      'socks5',
    );
    expect(
      parseProxy('http://1.2.3.4:1080', { defaultScheme: 'socks5' }).scheme,
    ).toBe('http');
  });

  // [input, English message, code, params].
  const REFUSED: Array<[string, string, ProxyParseCode, ProxyParseParams?]> = [
    ['', 'proxy is empty', 'empty'],
    ['1.2.3.4', 'missing port (expected host:port)', 'missing_port'],
    [
      '1.2.3.4:0',
      'invalid port 0 (must be 1-65535)',
      'invalid_port_value',
      { port: '0' },
    ],
    [
      '1.2.3.4:65536',
      'invalid port 65536 (must be 1-65535)',
      'invalid_port_value',
      { port: '65536' },
    ],
    [
      '1.2.3.4:99999:user:pass',
      'invalid port 99999 (must be 1-65535)',
      'invalid_port_value',
      { port: '99999' },
    ],
    [
      'user:pass:1.2.3.4:0',
      'invalid port 0 (must be 1-65535)',
      'invalid_port_value',
      { port: '0' },
    ],
    // The address of this form is in front of the "@", where credentials are
    // too: the port is not worded, as it could be the password's.
    [
      '1.2.3.4:99999@user:pass',
      'invalid port (must be 1-65535)',
      'invalid_port',
    ],
    [
      'http://user:pass@1.2.3.4:99999',
      'invalid port 99999 (must be 1-65535)',
      'invalid_port_value',
      { port: '99999' },
    ],
    [
      'socks5://1.2.3.4:99999:user:pass',
      'invalid port 99999 (must be 1-65535)',
      'invalid_port_value',
      { port: '99999' },
    ],
    [
      '[::1]:99999:user:pass',
      'invalid port 99999 (must be 1-65535)',
      'invalid_port_value',
      { port: '99999' },
    ],
    [
      '1.2.3.4:123456:user:pass',
      'invalid port (must be 1-65535)',
      'invalid_port',
    ],
    [
      'user:pass:proxy.example.com:http',
      'invalid port (must be 1-65535)',
      'invalid_port',
    ],
    [
      'ftp://1.2.3.4:99999',
      'unsupported proxy scheme (use http, https or socks5)',
      'unsupported_scheme',
    ],
    [
      'ftp://1.2.3.4:21',
      'unsupported proxy scheme (use http, https or socks5)',
      'unsupported_scheme',
    ],
    [
      'socks4://1.2.3.4:1080',
      'SOCKS4 proxies are not supported (no authentication, IPv4 only); use socks5 or http',
      'unsupported_socks4',
    ],
    [
      'socks4a://1.2.3.4:1080',
      'SOCKS4a proxies are not supported; use socks5 or http',
      'unsupported_socks4a',
    ],
    [
      'http://1.2.3.4:8080/path',
      'proxy URL must not contain a path, query or fragment',
      'url_has_path',
    ],
    [
      '1.2.3.4:8080:user',
      'could not parse proxy: expected host:port, host:port:user:pass or user:pass:host:port',
      'unparsed_form',
    ],
    [
      'proxy.example.com:8080:user.name:3128',
      'ambiguous proxy: could be host:port:user:pass or user:pass:host:port; please use the form scheme://user:pass@host:port',
      'ambiguous',
    ],
    [
      '2001:db8::1:8080',
      'IPv6 proxy addresses must be written in brackets, e.g. [2001:db8::1]:8080',
      'ipv6_needs_brackets',
    ],
    ['[zzz::1]:80', 'invalid IPv6 address', 'invalid_ipv6'],
    ['999.1.1.1:80', 'invalid IPv4 address', 'invalid_ipv4'],
    ['bad_host!:80', 'invalid host name', 'invalid_hostname'],
    [
      'http://:pass@1.2.3.4:8080',
      'password given without username',
      'password_without_username',
    ],
    [
      'http://user:pa%0D%0Ass@1.2.3.4:8080',
      'credentials must not contain control characters',
      'credentials_control_chars',
    ],
    [
      'http://1.2.3.4:8080 extra',
      'proxy must not contain spaces or control characters',
      'whitespace',
    ],
    [
      `socks5://${'u'.repeat(256)}:p@1.2.3.4:1080`,
      'SOCKS5 username/password are limited to 255 bytes',
      'socks_credentials_too_long',
    ],
    // The corners of the bracket and colon forms.
    ['[::1', 'unterminated IPv6 bracket', 'unterminated_bracket'],
    ['[::1]', 'missing port (expected [ipv6]:port)', 'missing_port_ipv6'],
    [
      'http://u:p@[::1]',
      'missing port (expected [ipv6]:port)',
      'missing_port_ipv6',
    ],
    ['[::1]x', 'invalid characters after IPv6 address', 'invalid_after_ipv6'],
    ['[::1]:', 'invalid port (must be 1-65535)', 'invalid_port'],
    ['[::1]:80:u', 'invalid port (must be 1-65535)', 'invalid_port'],
    ['http://[1:2:3]:80', 'invalid IPv6 address', 'invalid_ipv6'],
    [':80', 'missing host', 'missing_host'],
    [
      'a:b:c',
      'could not parse proxy: expected host:port, host:port:user:pass or user:pass:host:port',
      'unparsed_form',
    ],
    [
      'a:b:c:d',
      'could not find host:port in proxy string',
      'host_port_not_found',
    ],
    ['u:p:h:80:x:y@z', 'missing port (expected host:port)', 'missing_port'],
    [
      'http://u:a:b@h:80:extra',
      'could not parse proxy: expected host:port, host:port:user:pass or scheme://user:pass@host:port',
      'unparsed_url_form',
    ],
    [
      'http://us%3Aer:pw@1.2.3.4:80',
      "username must not contain ':' (HTTP Basic auth cannot carry it)",
      'username_has_colon',
    ],
    [
      'http://u:p@host:80/x:y',
      'proxy URL must not contain a path, query or fragment',
      'url_has_path',
    ],
    ['http://u:a:b@c:d', 'invalid port (must be 1-65535)', 'invalid_port'],
  ];

  it.each(REFUSED)('refuses %j with %j', (text, message, code, params = {}) => {
    const error = refusal(text);
    expect(error.message).toBe(message);
    expect(error.code).toBe(code);
    expect(error.params).toEqual(params);
  });

  it('has a case for every error code', () => {
    const covered = new Set<string>(REFUSED.map(([, , code]) => code));
    // The overlong line is the list's: see "reports overlong lines" below.
    covered.add('line_too_long');
    // A defence for a bracketed address the two patterns miss; no input gets there.
    covered.add('bracketed_ipv6_unparsed');
    expect([...covered].sort()).toEqual([...PROXY_PARSE_CODES].sort());
  });

  it.each([
    '1.2.3.4:99999@alice:s3cret',
    'alice:s3cret@1.2.3.4:99999',
    '1.2.3.4:99999:alice:s3cret',
    'alice:s3cret:1.2.3.4:0',
    '1.2.3.4:123456:alice:s3cret',
    'proxyhost:99999:alice:s3cret',
    'bad_host!:80:alice:s3cret',
    '1.2.3.4:8080:alice',
    'alice:s3cret',
    's3cret',
    'http://alice:s3cret@[zzz::1]:80',
    'http://alice:s3cret@1.2.3.4:8080/path',
    'socks5://1.2.3.4:99999:alice:s3cret',
    'socks4://alice:s3cret@1.2.3.4:1080',
    'alice:s3cret@bad host:80',
    'http://alice:s3cret@1.2.3.4',
    'http://alice:s3cret@host:80:more',
  ])('never echoes the username or password of %j', (text) => {
    const error = refusal(text);
    const { errors } = parseProxyList(text);
    expect(errors).toHaveLength(1);
    const [listed] = errors;
    for (const shown of [
      error.message,
      JSON.stringify(error.params),
      listed?.message ?? '',
      listed?.maskedInput ?? '',
      JSON.stringify(listed?.params),
    ]) {
      expect(shown).not.toContain('alice');
      expect(shown).not.toContain('s3cret');
    }
    expect(listed?.code).toBe(error.code);
    expect(listed?.params).toEqual(error.params);
  });
});

describe('the proxy a text means', () => {
  it('only goes to the browser directly without credentials', () => {
    expect(toPlaywrightProxy(parseProxy('socks5://1.2.3.4:1080'))).toEqual({
      server: 'socks5://1.2.3.4:1080',
    });
    expect(toPlaywrightProxy(parseProxy('https://1.2.3.4:443'))).toEqual({
      server: 'https://1.2.3.4:443',
    });
    for (const text of [
      'http://user:p%40ss@1.2.3.4:8080',
      'socks5://u:p@1.2.3.4:1080',
    ]) {
      expect(() => toPlaywrightProxy(parseProxy(text))).toThrow(/ProxyBridge/);
    }
  });

  it('shows no password in its display form or identity key', () => {
    const proxy = parseProxy('http://user:supersecret@1.2.3.4:8080');
    expect(displayOf(proxy)).toBe('http://user@1.2.3.4:8080');
    expect(displayOf(parseProxy('[::1]:8080'))).toBe('http://[::1]:8080');
    expect(identityKeyOf(proxy)).not.toContain('supersecret');
  });

  it('has the same identity key whatever the scheme and spelling', () => {
    const forms = [
      'http://user:pass@Proxy.Example.com:8080',
      'proxy.example.com:8080:user:pass',
      'user:pass@proxy.example.com.:8080',
      'socks5://user:pass@proxy.example.com:8080',
    ];
    expect(
      new Set(forms.map((form) => identityKeyOf(parseProxy(form)))).size,
    ).toBe(1);
    expect(identityKeyOf(parseProxy('[2001:0db8::0001]:80'))).toBe(
      identityKeyOf(parseProxy('[2001:db8::1]:80')),
    );
  });

  it('has another identity key for other credentials', () => {
    const a = parseProxy('gate.example.com:7000:customer-x-session-aaa:pw');
    const b = parseProxy('gate.example.com:7000:customer-x-session-bbb:pw');
    const c = parseProxy('gate.example.com:7000:customer-x-session-aaa:other');
    expect(new Set([a, b, c].map(identityKeyOf)).size).toBe(3);
  });
});

describe('percent escapes in credentials', () => {
  it.each([
    ['http://u:p%zz@h.com:80', 'p%zz'],
    ['http://u:p%4@h.com:80', 'p%4'],
    ['http://u:p%C3@h.com:80', 'p\ufffd'],
    ['http://u:%E4%B8%AD%E6%96%87@h.com:80', '中文'],
    ['http://u:a%C3x%A4@h.com:80', 'a\ufffdx\ufffd'],
    ['http://u:%41%42%43@h.com:80', 'ABC'],
  ])('decodes the percent escapes of %j', (text, password) => {
    expect(parseProxy(text).password).toBe(password);
  });

  it.each([
    ['\u00a01.2.3.4:80\u00a0', 'no-break spaces'],
    ['\u30001.2.3.4:80\u3000', 'ideographic spaces'],
    ['\u200b1.2.3.4:80\u200b', 'zero-width spaces'],
    ['\u20601.2.3.4:80\u2060', 'word joiners'],
    [
      '\ufeff \ufeff1.2.3.4:80 \u200b ',
      'a mix of spaces and invisible characters',
    ],
    ['\u00851.2.3.4:80\u0085', 'next-line characters'],
    ['\u001c1.2.3.4:80\u001f', 'separator control characters'],
  ])('trims %j (%s)', (text) => {
    expect(parseProxy(text)).toEqual(P('http', '1.2.3.4', 80));
  });

  it.each([
    ['1.2.3.4:80\u00a0:u:p', 'a no-break space inside'],
    ['1.2.3.4:80\u3000:u:p', 'an ideographic space inside'],
    ['1.2.3.4:80\u0085:u:p', 'a next-line character inside'],
    ['1.2.3.4:80\u2028:u:p', 'a line separator inside'],
    ['1.2.3.4:80\u0000:u:p', 'a NUL inside'],
    ['1.2.3.4:80\u007f:u:p', 'a DEL inside'],
  ])('refuses %j (%s)', (text) => {
    expect(refusal(text).code).toBe('whitespace');
  });

  it('keeps a zero-width character inside a password', () => {
    expect(parseProxy('1.2.3.4:80:u:pa\u200bss').password).toBe('pa\u200bss');
  });

  it('takes linear time on long runs of spaces, dots and slashes', () => {
    // A regular expression like `[ ]+$` would take quadratic time here.
    const started = performance.now();
    const run = 1_000_000;
    // The blanks around a line are trimmed first, in one pass.
    expect(refusal(`${' '.repeat(run)}x${' '.repeat(run)}`).code).toBe(
      'missing_port',
    );
    // A line longer than a proxy can be is refused without being read.
    expect(refusal(`a${' '.repeat(run)}b`).code).toBe('line_too_long');
    expect(refusal(`x${'.'.repeat(run)}:80`).code).toBe('line_too_long');
    expect(refusal(`http://x:80${'/'.repeat(run)}`).code).toBe('line_too_long');
    expect(performance.now() - started).toBeLessThan(2000);

    // The runs that fit are read as before.
    const fits = MAX_PROXY_LINE - 20;
    expect(refusal(`a${' '.repeat(fits)}b`).code).toBe('whitespace');
    expect(parseProxy(`x${'.'.repeat(fits)}:80`).host).toBe('x');
    expect(refusal(`${'.'.repeat(fits)}x:80`).code).toBe('invalid_hostname');
    expect(parseProxy(`http://x:80${'/'.repeat(fits)}`).host).toBe('x');
  });

  it('is not fooled by a scheme named like an object property', () => {
    for (const scheme of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ]) {
      expect(refusal(`${scheme}://1.2.3.4:80`).code).toBe('unsupported_scheme');
    }
  });

  it('normalizes IPv6 hosts', () => {
    expect(parseProxy('[2001:DB8:0:0:0:0:0:1]:80').host).toBe('2001:db8::1');
    expect(parseProxy('[1:0:0:2:0:0:0:3]:80').host).toBe('1:0:0:2::3');
    expect(parseProxy('[0:0:0:0:0:0:0:0]:80').host).toBe('::');
    expect(parseProxy('[1:2:3:4:5:6:7::]:80').host).toBe('1:2:3:4:5:6:7:0');
    expect(parseProxy('[::ffff:1.2.3.4]:80').host).toBe('::ffff:102:304');
    // A zone name is dropped, whatever it says.
    expect(parseProxy('[fe80::1%eth0]:80').host).toBe('fe80::1');
    expect(parseProxy('[fe80::1%x/y%z]:80').host).toBe('fe80::1');
  });

  it.each([
    '[1:2:3:4:5:6:7:8::]:80',
    '[1::2::3]:80',
    '[:::]:80',
    '[1:2:3]:80',
    '[g::1]:80',
  ])('refuses the IPv6 address in %j', (text) => {
    expect(refusal(text).code).toBe('invalid_ipv6');
  });

  it.each([
    ['1.2.3.4:00080', 80],
    ['1.2.3.4:1', 1],
    ['1.2.3.4:65535', 65535],
  ])('reads the port of %j', (text, port) => {
    expect(parseProxy(text).port).toBe(port);
  });

  it('keeps host names within the DNS limits', () => {
    const label = 'a'.repeat(63);
    expect(parseProxy(`${label}.example.com:80`).host).toBe(
      `${label}.example.com`,
    );
    expect(refusal(`${label}a.example.com:80`).code).toBe('invalid_hostname');
    expect(refusal(`-bad.example.com:80`).code).toBe('invalid_hostname');
    expect(refusal(`bad-.example.com:80`).code).toBe('invalid_hostname');
    expect(refusal(`a..b:80`).code).toBe('invalid_hostname');
    const long = [
      'a'.repeat(63),
      'b'.repeat(63),
      'c'.repeat(63),
      'd'.repeat(61),
    ].join('.');
    expect(long).toHaveLength(253);
    expect(parseProxy(`${long}:80`).host).toBe(long);
    expect(refusal(`${long}d:80`).code).toBe('invalid_hostname');
  });

  it('does not let the runtime read a host as an address', () => {
    // "127.1" and "0x7f.1" are IPv4 addresses to a URL parser.
    expect(refusal('127.1:80').code).toBe('invalid_ipv4');
    expect(parseProxy('0x7f.1:80').host).toBe('0x7f.1');
    expect(refusal('01.2.3.4:80').code).toBe('invalid_ipv4');
  });

  it('turns internationalized names into punycode, label by label', () => {
    expect(parseProxy('münchen.de:80').host).toBe('xn--mnchen-3ya.de');
    expect(parseProxy('пример.рф:80').host).toBe('xn--e1afmkfd.xn--p1ai');
    // Fullwidth characters and the ideographic full stop are compatibility forms.
    expect(parseProxy('ｐｒｏｘｙ。example:80').host).toBe('proxy.example');
    expect(parseProxy('１２７.０.０.１:80').host).toBe('127.0.0.1');
    // Characters that nameprep drops.
    expect(parseProxy('exa\u00admple.com:80').host).toBe('example.com');
    // A name ending in a number is fine as a proxy host (a URL parser refuses it).
    expect(parseProxy('ü1.2.3.4.5:80').host).toBe('xn--1-dha.2.3.4.5');
  });

  it.each([
    'bü/cher.example:80',
    'bü#cher.example:80',
    'bü%41cher.example:80',
    'bü cher.example:80',
  ])('does not let a delimiter hide in the name %j', (text) => {
    expect(refusal(text).code).toMatch(/^(invalid_hostname|whitespace)$/);
  });

  it('is refused by a text with a slash after a fullwidth one', () => {
    expect(refusal('a／b.example:80').code).toBe('invalid_hostname');
  });
});

describe('the longest proxy line', () => {
  it('is 2048 characters', () => {
    expect(MAX_PROXY_LINE).toBe(2048);
  });

  it('may have all of them, and is refused with the limit with one more', () => {
    const prefix = '1.2.3.4:80:user:';
    const atTheLimit = prefix + 'p'.repeat(MAX_PROXY_LINE - prefix.length);
    expect(parseProxy(atTheLimit).host).toBe('1.2.3.4');
    const error = refusal(`${atTheLimit}p`);
    expect(error.code).toBe('line_too_long');
    expect(error.params).toEqual({ max: MAX_PROXY_LINE });
  });

  it('does not count the blanks around the line', () => {
    expect(
      parseProxy(`${' '.repeat(5000)}1.2.3.4:80${'\t'.repeat(5000)}`).port,
    ).toBe(80);
  });

  it('is refused before the line is looked at, whatever it is', () => {
    for (const filler of ['[', ':[', 'a:', '@', '%41', '😀']) {
      const error = refusal(filler.repeat(MAX_PROXY_LINE + 1));
      expect(error.code, filler).toBe('line_too_long');
    }
  });
});

describe('a list of lines made to keep the parser busy', () => {
  // Lines of nearly the longest length, from the shapes a parser can be slow
  // on: a long run of brackets, colons, "@" and half-finished IPv6 addresses.
  // An import of this size took the whole server for most of a second. The
  // budget is several times what a linear parser needs, and the fastest of a
  // few runs counts, so a loaded machine does not fail it (one slow turn of
  // the machine is no run of the parser), and a quadratic parser does.
  const BUDGET_MS = 300;
  const RUNS = 3;
  const SHAPES: Array<[string, string]> = [
    ['colons and brackets', `a:${':['.repeat(1000)}`],
    ['colons, brackets and letters', ':[a'.repeat(660)],
    ['an IPv6 address and brackets', `[x]:1:${'['.repeat(2000)}`],
    ['a user and brackets', `u:p@${'[a'.repeat(1000)}`],
    ['closing brackets and colons', ']:['.repeat(680)],
    ['colons', ':'.repeat(2000)],
    ['hosts and ports', 'a.b:1:'.repeat(330)],
  ];

  it.each(SHAPES)('is read in a moment: %s', (_name, line) => {
    const text = Array.from(
      { length: Math.floor(MAX_PROXY_IMPORT / (line.length + 1)) },
      () => line,
    ).join('\n');
    let fastest = Infinity;
    let lines = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now();
      const result = parseProxyList(text);
      fastest = Math.min(fastest, performance.now() - started);
      lines =
        result.proxies.length + result.duplicates.length + result.errors.length;
    }
    expect(fastest).toBeLessThan(BUDGET_MS);
    expect(lines).toBeGreaterThan(400);
  });
});

describe('parseProxyList', () => {
  it('reads a Webshare export with a BOM and CRLF', () => {
    const text =
      '\ufeff63.246.153.230:5899:someuser:somepass\r\n10.20.30.40:6000:someuser:somepass\r\n\r\n';
    const result = parseProxyList(text);
    expect(result.errors).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.proxies.map((line) => [line.lineno, line.proxy])).toEqual([
      [1, P('http', '63.246.153.230', 5899, 'someuser', 'somepass')],
      [2, P('http', '10.20.30.40', 6000, 'someuser', 'somepass')],
    ]);
  });

  it('skips comments, blank lines and surrounding whitespace', () => {
    const text =
      '# exported\r\n\r\n   \t\r\n  http://u:p@1.2.3.4:8080  \r\n\t# indented comment\r\n\tsocks5://5.6.7.8:1080\t\r\n';
    const result = parseProxyList(text);
    expect(result.errors).toEqual([]);
    expect(
      result.proxies.map((line) => [
        line.lineno,
        `${line.proxy.scheme}://${line.proxy.host}:${line.proxy.port}`,
      ]),
    ).toEqual([
      [4, 'http://1.2.3.4:8080'],
      [6, 'socks5://5.6.7.8:1080'],
    ]);
  });

  it('reports errors per line with the input masked', () => {
    const result = parseProxyList(
      '1.2.3.4:80\r\nnope\r\n1.2.3.4:99999:u:hunter2\r\n5.6.7.8:80:u:p\r\nftp://1.2.3.4:21\r\n',
    );
    expect(
      result.proxies.map((line) => `${line.proxy.host}:${line.proxy.port}`),
    ).toEqual(['1.2.3.4:80', '5.6.7.8:80']);
    expect(result.errors).toEqual([
      {
        lineno: 2,
        maskedInput: '***',
        message: 'missing port (expected host:port)',
        code: 'missing_port',
        params: {},
      },
      {
        lineno: 3,
        maskedInput: '1.2.3.4:99999:***:***',
        message: 'invalid port 99999 (must be 1-65535)',
        code: 'invalid_port_value',
        params: { port: '99999' },
      },
      {
        lineno: 5,
        maskedInput: 'ftp://1.2.3.4:21',
        message: 'unsupported proxy scheme (use http, https or socks5)',
        code: 'unsupported_scheme',
        params: {},
      },
    ]);
  });

  it('reports duplicates of earlier lines of the same text', () => {
    const result = parseProxyList(
      '1.2.3.4:80:u:p\nhttp://u:p@1.2.3.4:80\n1.2.3.4:80:u:other\nsocks5://u:p@1.2.3.4:80\n',
    );
    expect(result.proxies.map((line) => line.lineno)).toEqual([1, 3]);
    expect(
      result.duplicates.map((dup) => [dup.lineno, dup.firstLineno]),
    ).toEqual([
      [2, 1],
      [4, 1],
    ]);
    expect(result.duplicates[0]?.proxy.password).toBe('p');
  });

  it('handles lone CRs and every other kind of line break', () => {
    expect(
      parseProxyList('1.2.3.4:80\r5.6.7.8:81\n9.9.9.9:82\r\n').proxies,
    ).toHaveLength(3);
    const breaks = [
      '\u000b',
      '\u000c',
      '\u001c',
      '\u001d',
      '\u001e',
      '\u0085',
      '\u2028',
      '\u2029',
    ];
    const text = breaks.map((br, i) => `1.2.3.${i + 1}:80${br}`).join('');
    const result = parseProxyList(text);
    expect(result.errors).toEqual([]);
    expect(result.proxies.map((line) => line.lineno)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('applies the default scheme to every line', () => {
    const result = parseProxyList('1.2.3.4:80\nhttp://5.6.7.8:80\n', {
      defaultScheme: 'socks5',
    });
    expect(result.proxies.map((line) => line.proxy.scheme)).toEqual([
      'socks5',
      'http',
    ]);
  });

  it('reports overlong lines without showing the password', () => {
    const result = parseProxyList(`1.2.3.4:80:u:${'p'.repeat(5000)}`);
    expect(result.errors).toEqual([
      {
        lineno: 1,
        maskedInput: '1.2.3.4:80:***:***...',
        message: 'line too long',
        code: 'line_too_long',
        params: { max: 2048 },
      },
    ]);
    expect(result.errors[0]?.maskedInput).not.toContain('ppp');
  });

  it('counts an overlong line in characters, not UTF-16 units', () => {
    // 1500 astral characters are 3000 UTF-16 units but 1500 characters: not too long.
    const password = '😀'.repeat(1500);
    expect(parseProxyList(`1.2.3.4:80:u:${password}`).errors).toEqual([]);
    expect(
      parseProxyList(`1.2.3.4:80:u:${'😀'.repeat(2100)}`).errors[0]?.code,
    ).toBe('line_too_long');
  });

  it('keeps the first characters of an overlong line whole', () => {
    const result = parseProxyList(`${'😀'.repeat(79)}:${'x'.repeat(5000)}`);
    expect(result.errors[0]?.maskedInput.endsWith('...')).toBe(true);
    expect(result.errors[0]?.maskedInput).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])/,
    );
  });

  it('copes with an empty text and one that is only blanks', () => {
    for (const text of ['', '\n', '  \r\n\t\n', '# only a comment']) {
      expect(parseProxyList(text)).toEqual({
        proxies: [],
        duplicates: [],
        errors: [],
      });
    }
  });
});

describe('maskCredentials', () => {
  it.each([
    ['user:s3cret@1.2.3.4:99999', '***:***@1.2.3.4:99999'],
    // The address of this form is in front of the "@", where credentials sit
    // too: nothing is kept.
    ['1.2.3.4:99999@user:s3cret', '***:***@***:***'],
    ['user:my.secret:1.2.3.4:0', '***:***:1.2.3.4:0'],
    ['socks4://u:s3cret@[::1]:1080', 'socks4://***:***@[::1]:1080'],
    ['s3cret', '***'],
    ['', ''],
    ['HTTP://a:b@c.example:80:x', 'HTTP://***:***@c.example:80:***'],
    ['[::1]:80:user:pass', '[::1]:80:***:***'],
    ['\ufeff1.2.3.4:8080:user:pass', '\ufeff1.2.3.4:8080:***:***'],
  ])(
    'masks %j as %j, keeping only the scheme and the host:port',
    (text, masked) => {
      expect(maskCredentials(text)).toBe(masked);
    },
  );
});

describe('maskCredentials, when the credentials look like an address', () => {
  // A user name with a dot and a password of digits is shaped like host:port.
  it.each([
    // The line of the report: the user name and the password were shown as the address.
    ['http://john.doe:1234@1.2.3.4:99999', 'http://***:***@***:***'],
    ['john.doe:12345@1.2.3.4:99999', '***:***@***:***'],
    ['socks4://john.doe:4821@10.0.0.1:1080', 'socks4://***:***@***:***'],
    ['1.2.3.4:99999@john.doe:4821', '***:***@***:***'],
    ['a.b:c.d:80@host.example.com:0', '***:***:***@***:***'],
    ['john.doe:4821:1.2.3.4:99999', '***:***:***:***'],
    ['1.2.3.4:99999:john.doe:4821', '***:***:***:***'],
    // The host is no host, so the credentials are the only address in sight.
    ['john.doe:4821:ba d:99999', '***:***:***:***'],
    ['ba d:99999:john.doe:4821', '***:***:***:***'],
    ['acme.corp:2024@proxy.example.com:abc', '***:***@***:***'],
    // An IPv6 address with something stuck to it is an address with a fault,
    // and what follows may be the credentials.
    ['[2001:db8::1]secret.com:80', '******:***'],
    ['http://[2001:db8::1]:x:secret.com:80', 'http://***:***:***:***'],
  ])('masks %j as %j', (text, masked) => {
    expect(maskCredentials(text)).toBe(masked);
  });

  it.each([
    ['john.doe:s3cret@1.2.3.4:99999', '***:***@1.2.3.4:99999'],
    [
      'http://jane.q:Zq7xK@[2001:db8::1]:70000',
      'http://***:***@[2001:db8::1]:70000',
    ],
    ['1.2.3.4:99999:john.doe:s3cret', '1.2.3.4:99999:***:***'],
    ['john.doe:s3cret:1.2.3.4:99999', '***:***:1.2.3.4:99999'],
  ])(
    'still shows the address when it can be told from the credentials: %j',
    (text, masked) => {
      expect(maskCredentials(text)).toBe(masked);
    },
  );

  it('does not word an error with the password it took for a port', () => {
    // The user name and the password of this line read as host and port; the
    // address behind the "@" has a port that is no number.
    const error = refusal('john.doe:99999@1.2.3.4:abc');
    expect(error.code).toBe('invalid_port');
    expect(error.message).not.toContain('99999');
    expect(error.params).toEqual({});
  });
});

/** mulberry32: a small seeded generator, so that a failure can be replayed. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('what the proxy report shows of a line that cannot be read', () => {
  const SCHEMES = [
    '',
    'http://',
    'https://',
    'socks5://',
    'socks4://',
    'HTTP://',
    'ftp://',
  ];
  const USERS = [
    'bob',
    'u_7',
    'Zq7xK',
    'x1y2',
    'john.doe',
    'a.b',
    'jane.q.public',
  ];
  const PASSWORDS = [
    's3cret',
    'a1b2c3',
    'Tr0ub4dor',
    'p.w',
    'x.y.z',
    '12.5',
    '4821',
    '31337',
    '00007',
  ];
  const FORMS: Array<(u: string, p: string, h: string, o: string) => string> = [
    (u, p, h, o) => `${u}:${p}@${h}:${o}`,
    (u, p, h, o) => `${h}:${o}@${u}:${p}`,
    (u, p, h, o) => `${h}:${o}:${u}:${p}`,
    (u, p, h, o) => `${u}:${p}:${h}:${o}`,
  ];

  /** Everything the page, the API or an assistant is told about a refused line. */
  function toldAbout(line: string): string {
    const told: unknown[] = parseProxyList(line).errors.map((error) => [
      error.maskedInput,
      error.message,
      error.params,
    ]);
    try {
      parseProxy(line);
    } catch (error) {
      if (!(error instanceof ProxyParseError)) throw error;
      told.push([error.message, error.params, maskCredentials(line)]);
    }
    return JSON.stringify(told);
  }

  /**
   * Whether the line is a proxy with other credentials than the ones it was
   * made from: "host:port:user:pass" and "user:pass:host:port" can both be read
   * from some lines, and the parser takes the one that fits.
   */
  function readsAsAnother(
    line: string,
    user: string,
    password: string,
  ): boolean {
    try {
      const read = parseProxy(line.replace(/^[a-z0-9]+:\/\//i, ''));
      return read.username !== user || read.password !== password;
    } catch (error) {
      if (!(error instanceof ProxyParseError)) throw error;
      return false;
    }
  }

  /** The lines that leak a credential, and how many lines were refused. */
  function lookForLeaks(options: {
    seed: number;
    hosts: readonly string[];
    ports: readonly string[];
    allowed?: (user: string, password: string) => boolean;
  }) {
    const random = seeded(options.seed);
    const pick = <T>(pool: readonly T[]): T =>
      pool[Math.floor(random() * pool.length)];
    const leaks: string[] = [];
    let refused = 0;
    for (let n = 0; n < 5000; n += 1) {
      const user = pick(USERS);
      const password = pick(PASSWORDS);
      if (options.allowed?.(user, password) === false) continue;
      const line =
        pick(SCHEMES) +
        pick(FORMS)(user, password, pick(options.hosts), pick(options.ports));
      if (readsAsAnother(line, user, password)) continue;
      const told = toldAbout(line);
      if (told !== '[]') refused += 1;
      if (told.includes(user) || told.includes(password)) {
        leaks.push(`${line} -> ${told}`);
      }
    }
    return { leaks, refused };
  }

  it('is never a user name or a password, even when they look like host:port', () => {
    // A user name with a dot and a password of digits, next to an address that
    // is a host and a number (a port that is out of range, say).
    const { leaks, refused } = lookForLeaks({
      seed: 20_261_102,
      hosts: ['1.2.3.4', 'proxy.example.com', '[2001:db8::1]', 'localhost'],
      ports: ['8080', '99999', '65536', '0', '80', '123456'],
    });
    expect(refused).toBeGreaterThan(1000);
    expect(leaks).toEqual([]);
  });

  it('is never a user name or a password, whatever is wrong with the address', () => {
    // The one pair that nothing tells from an address that is no host:port is
    // a user name with a dot and a password of up to five digits.
    const { leaks, refused } = lookForLeaks({
      seed: 20_261_103,
      hosts: [
        '1.2.3.4',
        'ba d',
        '999.1.1.1',
        'a..b',
        'host',
        '[2001:db8::1]',
        '',
      ],
      ports: ['8080', '99999', '0', 'x', 'http', '', '123456'],
      allowed: (user, password) =>
        !(user.includes('.') && /^[0-9]{1,5}$/.test(password)),
    });
    expect(refused).toBeGreaterThan(1000);
    expect(leaks).toEqual([]);
  });

  it('shows the address of the lines whose credentials do not look like one', () => {
    expect(toldAbout('1.2.3.4:99999:bob:s3cret')).toContain(
      '1.2.3.4:99999:***:***',
    );
    expect(toldAbout('http://bob:s3cret@1.2.3.4:99999')).toContain(
      'http://***:***@1.2.3.4:99999',
    );
  });
});
