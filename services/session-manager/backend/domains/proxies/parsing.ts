// Parse and normalize user-supplied proxy strings.
//
// Accepted inputs (the scheme defaults to `defaultScheme`, normally http):
//
//   http://user:pass@host:port      https://...      socks5://[user:pass@]host:port
//   socks5h://... / socks://...     (normalized to socks5; the browser always resolves DNS remotely)
//   host:port                       user:pass@host:port          host:port@user:pass
//   host:port:user:pass             user:pass:host:port          scheme://host:port:user:pass
//   [2001:db8::1]:8080              [::1]:8080:user:pass         user:pass:[::1]:8080
//
// URL forms (anything with `://` or `@`) percent-decode their credentials; colon
// forms are taken literally. `host:port:user:pass` vs `user:pass:host:port` is
// decided by which side holds a valid host and port, preferring the side that
// unmistakably looks like a host (IP or dotted name).
//
// Error messages never contain parts of the input (a fragment could be a
// password), except the port of a plainly visible `host:port`, which the masked
// input shows too (see `maskCredentials`).

import { Buffer } from 'node:buffer';
import { domainToASCII } from 'node:url';

import { MAX_PROXY_LINE } from '../../../lib/proxy-limits.ts';
import { isIPv4, parseIPv6 } from './ip.ts';
import { identityKeyOf } from './types.ts';
import type { ProxyConfig, ProxyScheme } from './types.ts';

const SCHEMES: ReadonlyMap<string, ProxyScheme> = new Map<string, ProxyScheme>([
  ['http', 'http'],
  ['https', 'https'], // TLS to the proxy itself
  ['socks5', 'socks5'],
  // Playwright treats "socks5h" as an *HTTP* proxy, so it must be normalized.
  ['socks5h', 'socks5'],
  ['socks', 'socks5'],
]);
const UNSUPPORTED_SCHEMES: ReadonlyMap<string, ProxyParseCode> = new Map([
  ['socks4', 'unsupported_socks4'],
  ['socks4a', 'unsupported_socks4a'],
]);

// Whitespace as a person sees it: ASCII whitespace, the separators
// U+001C-U+001F, U+0085 and the Unicode space characters. JavaScript's `\s` differs (it counts
// the BOM and misses these separators), and the input comes from copy-paste.
const SPACE =
  '\\t-\\r\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
// BOM and zero-width characters that survive copy-paste.
const INVISIBLE = '\\ufeff\\u200b\\u200c\\u200d\\u2060';
const TRIMMABLE = new RegExp(`^[${SPACE}${INVISIBLE}]$`);
const SPACE_OR_CONTROL =
  /[\u0000-\u0020\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
// What ends a line: the usual breaks plus U+001C-U+001E, U+0085, U+2028 and
// U+2029. A lone CR (old Mac exports) counts.
const LINE_BREAK = /\r\n|[\n\r\u000b\u000c\u001c-\u001e\u0085\u2028\u2029]/u;

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/s;
const LABEL_RE = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;
const PORT_RE = /^[0-9]{1,5}$/;
const DIGITS_RE = /^[0-9]+$/;
const NON_ASCII = /[^\u0000-\u007f]/u;
// Characters that nameprep (RFC 3454 B.1) drops from a host name: soft hyphen,
// zero-width characters, variation selectors, the BOM. The combining ones sit
// outside the character class, where the linter wants them.
const MAPPED_TO_NOTHING =
  /[\u00ad\u1806\u200b-\u200d\u2060\ufeff]|\u034f|\p{Variation_Selector}/gu;
// ASCII other than letters, digits, '-', '_' and '.'.
const HOST_DELIMITER =
  /[\u0000-\u002c\u002f\u003a-\u0040\u005b-\u005e\u0060\u007b-\u007f]/;

export const PROXY_PARSE_CODES = [
  'empty',
  'whitespace',
  'unsupported_socks4',
  'unsupported_socks4a',
  'unsupported_scheme',
  'invalid_port_value',
  'url_has_path',
  'bracketed_ipv6_unparsed',
  'missing_port',
  'missing_port_ipv6',
  'ipv6_needs_brackets',
  'unparsed_form',
  'unparsed_url_form',
  'ambiguous',
  'invalid_port',
  'host_port_not_found',
  'unterminated_bracket',
  'invalid_after_ipv6',
  'invalid_ipv6',
  'missing_host',
  'invalid_ipv4',
  'invalid_hostname',
  'password_without_username',
  'username_has_colon',
  'credentials_control_chars',
  'socks_credentials_too_long',
  'line_too_long',
] as const;
export type ProxyParseCode = (typeof PROXY_PARSE_CODES)[number];

/**
 * Every way a proxy line can be refused, with the English sentence for API and
 * MCP clients. A `{name}` in a sentence is filled from the
 * error's `params`; the UI translates by `code` and the same parameters.
 * Neither a message nor a parameter ever contains a part of the input, except
 * the port of a visible `host:port`.
 */
const MESSAGES: Readonly<Record<ProxyParseCode, string>> = {
  empty: 'proxy is empty',
  whitespace: 'proxy must not contain spaces or control characters',
  unsupported_socks4:
    'SOCKS4 proxies are not supported (no authentication, IPv4 only); use socks5 or http',
  unsupported_socks4a: 'SOCKS4a proxies are not supported; use socks5 or http',
  unsupported_scheme: 'unsupported proxy scheme (use http, https or socks5)',
  /** params: `port`, the digits as written. */
  invalid_port_value: 'invalid port {port} (must be 1-65535)',
  url_has_path: 'proxy URL must not contain a path, query or fragment',
  bracketed_ipv6_unparsed:
    'could not parse bracketed IPv6 proxy (expected [ipv6]:port[:user:pass])',
  missing_port: 'missing port (expected host:port)',
  missing_port_ipv6: 'missing port (expected [ipv6]:port)',
  ipv6_needs_brackets:
    'IPv6 proxy addresses must be written in brackets, e.g. [2001:db8::1]:8080',
  unparsed_form:
    'could not parse proxy: expected host:port, host:port:user:pass or user:pass:host:port',
  unparsed_url_form:
    'could not parse proxy: expected host:port, host:port:user:pass or scheme://user:pass@host:port',
  ambiguous:
    'ambiguous proxy: could be host:port:user:pass or user:pass:host:port; ' +
    'please use the form scheme://user:pass@host:port',
  invalid_port: 'invalid port (must be 1-65535)',
  host_port_not_found: 'could not find host:port in proxy string',
  unterminated_bracket: 'unterminated IPv6 bracket',
  invalid_after_ipv6: 'invalid characters after IPv6 address',
  invalid_ipv6: 'invalid IPv6 address',
  missing_host: 'missing host',
  invalid_ipv4: 'invalid IPv4 address',
  invalid_hostname: 'invalid host name',
  password_without_username: 'password given without username',
  username_has_colon:
    "username must not contain ':' (HTTP Basic auth cannot carry it)",
  credentials_control_chars: 'credentials must not contain control characters',
  socks_credentials_too_long:
    'SOCKS5 username/password are limited to 255 bytes',
  /** params: `max`, the limit in characters (`MAX_PROXY_LINE`). */
  line_too_long: 'line too long',
};
export type ProxyParseParams = Readonly<Record<string, string | number>>;

/** The input is not a usable proxy specification (the message is user-facing). */
export class ProxyParseError extends Error {
  readonly code: ProxyParseCode;
  readonly params: ProxyParseParams;

  constructor(
    code: ProxyParseCode,
    message: string,
    params: ProxyParseParams = {},
  ) {
    super(message);
    this.name = 'ProxyParseError';
    this.code = code;
    this.params = params;
  }
}

function parseError(
  code: ProxyParseCode,
  params: ProxyParseParams = {},
): ProxyParseError {
  const message = MESSAGES[code].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name]),
  );
  return new ProxyParseError(code, message, params);
}

export interface ParseOptions {
  /** The scheme for inputs without one. Default `http`. */
  defaultScheme?: ProxyScheme;
}

export interface ParsedLine {
  /** 1-based line number in the input. */
  lineno: number;
  proxy: ProxyConfig;
}

/** A line repeating an earlier line of the same input (same `identityKeyOf`). */
export interface DuplicateLine extends ParsedLine {
  firstLineno: number;
}

export interface ParseLineError {
  lineno: number;
  /** The offending line with anything that may be a password replaced by `***`. */
  maskedInput: string;
  /** English sentence; `code` and `params` identify it for translation. */
  message: string;
  code: ProxyParseCode;
  params: ProxyParseParams;
}

export interface ParsedList {
  /** Parsed, de-duplicated, in input order. */
  proxies: ParsedLine[];
  duplicates: DuplicateLine[];
  errors: ParseLineError[];
}

/**
 * `text` without the spaces and invisible characters at its ends. A loop and not a
 * regular expression: `[...]+$` takes quadratic time on a long run in the middle.
 */
function trimInput(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && TRIMMABLE.test(text.charAt(start))) start += 1;
  while (end > start && TRIMMABLE.test(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

/** `text` without the `character`s at its end (same reason as `trimInput`). */
function stripTrailing(text: string, character: string): string {
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === character) end -= 1;
  return text.slice(0, end);
}

/** Parse one proxy string into a normalized `ProxyConfig`. Throws `ProxyParseError`. */
export function parseProxy(
  text: string,
  options: ParseOptions = {},
): ProxyConfig {
  const s = trimInput(text);
  if (s === '') throw parseError('empty');
  if (tooLong(s)) throw parseError('line_too_long', { max: MAX_PROXY_LINE });
  if (SPACE_OR_CONTROL.test(s)) {
    throw parseError('whitespace');
  }
  const match = SCHEME_RE.exec(s);
  const scheme = normalizeScheme(match?.[1] ?? options.defaultScheme ?? 'http');
  const rest = match?.[2] ?? s;
  try {
    return parseRest(scheme, rest, match !== null);
  } catch (error) {
    if (!(error instanceof ProxyParseError)) throw error;
    const { tokens, index } = splitForMasking(rest);
    const port = index === null ? undefined : tokens[index + 2];
    // The clearest message for e.g. "1.2.3.4:99999:u:p".
    if (port !== undefined && !isPort(port)) {
      throw parseError('invalid_port_value', { port });
    }
    throw error;
  }
}

function parseRest(
  scheme: ProxyScheme,
  rest: string,
  schemeGiven: boolean,
): ProxyConfig {
  if (schemeGiven) {
    try {
      return parseUrlForm(scheme, rest, false);
    } catch (urlError) {
      if (!(urlError instanceof ProxyParseError)) throw urlError;
      // "socks5://host:port:user:pass" exports.
      if (!rest.includes('@') && rest.split(':').length - 1 >= 3) {
        try {
          return parseColonForm(scheme, stripTrailing(rest, '/'));
        } catch (colonError) {
          if (!(colonError instanceof ProxyParseError)) throw colonError;
        }
      }
      throw urlError;
    }
  }
  if (rest.includes('@')) {
    try {
      return parseUrlForm(scheme, rest, true);
    } catch (urlError) {
      if (!(urlError instanceof ProxyParseError)) throw urlError;
      try {
        // "host:port:user:p@ss": an '@' inside a colon-form password.
        return parseColonForm(scheme, rest);
      } catch (colonError) {
        if (!(colonError instanceof ProxyParseError)) throw colonError;
        throw urlError;
      }
    }
  }
  return parseColonForm(scheme, rest);
}

function normalizeScheme(raw: string): ProxyScheme {
  const name = raw.toLowerCase();
  const scheme = SCHEMES.get(name);
  if (scheme !== undefined) return scheme;
  throw parseError(UNSUPPORTED_SCHEMES.get(name) ?? 'unsupported_scheme');
}

function parseUrlForm(
  scheme: ProxyScheme,
  input: string,
  allowSwapped: boolean,
): ProxyConfig {
  const rest = stripTrailing(input, '/');
  const at = rest.lastIndexOf('@');
  const userinfo = at >= 0 ? rest.slice(0, at) : '';
  const hostPort = rest.slice(at + 1);
  let parsed: HostPort;
  try {
    parsed = parseHostPort(hostPort);
  } catch (error) {
    if (!(error instanceof ProxyParseError)) throw error;
    // "host:port@user:pass" (some providers print it this way)
    if (allowSwapped && at >= 0) {
      let swapped: HostPort | null = null;
      try {
        swapped = parseHostPort(userinfo);
      } catch (swappedError) {
        if (!(swappedError instanceof ProxyParseError)) throw swappedError;
      }
      if (swapped !== null) {
        const [user, password] = splitUserinfo(hostPort);
        return build(scheme, swapped.host, swapped.port, user, password);
      }
    }
    if (/[/?#]/.test(hostPort)) {
      throw parseError('url_has_path');
    }
    throw error;
  }
  const [user, password] = at >= 0 ? splitUserinfo(userinfo) : [null, null];
  return build(scheme, parsed.host, parsed.port, user, password);
}

function splitUserinfo(userinfo: string): [string, string | null] {
  const colon = userinfo.indexOf(':');
  if (colon < 0) return [unquote(userinfo), null];
  return [
    unquote(userinfo.slice(0, colon)),
    unquote(userinfo.slice(colon + 1)),
  ];
}

/**
 * Percent-decoding that never throws: a malformed escape stays as it is and
 * bytes that are not UTF-8 become U+FFFD (`decodeURIComponent` throws on both).
 */
function unquote(text: string): string {
  if (!text.includes('%')) return text;
  // A run of escapes is decoded together, so a multi-byte character spans them.
  return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) =>
    Buffer.from(run.replaceAll('%', ''), 'hex').toString('utf8'),
  );
}

function parseColonForm(scheme: ProxyScheme, s: string): ProxyConfig {
  // Bracketed IPv6 first: "[v6]:port[:user:pass]" or "user:pass:[v6]:port"
  const hostFirst = /^\[([^\]]+)\]:(\d+)(?::([^:]*):(.*))?$/.exec(s);
  if (hostFirst) {
    const { host, port } = parseHostPort(`[${hostFirst[1]}]:${hostFirst[2]}`);
    return build(
      scheme,
      host,
      port,
      hostFirst[3] ?? null,
      hostFirst[4] ?? null,
    );
  }
  const hostLast = splitHostLast(s);
  if (hostLast !== null) {
    const { host, port } = parseHostPort(
      `[${hostLast.address}]:${hostLast.port}`,
    );
    return build(scheme, host, port, hostLast.user, hostLast.password);
  }
  if (s.startsWith('[')) {
    parseHostPort(s); // raises the specific error (missing/invalid port, invalid address)
    throw parseError('bracketed_ipv6_unparsed');
  }

  const parts = s.split(':');
  if (parts.length === 1) throw parseError('missing_port');
  if (parts.length === 2) {
    const { host, port } = parseHostPort(s);
    return build(scheme, host, port, null, null);
  }
  if (looksLikeBareIPv6(s)) throw parseError('ipv6_needs_brackets');
  if (parts.length === 3) throw parseError('unparsed_form');

  const first = parts[0] ?? '';
  const second = parts[1] ?? '';
  const secondLast = parts[parts.length - 2] ?? '';
  const last = parts[parts.length - 1] ?? '';
  let hostIsFirst = looksLikeHost(first) && isPort(second); // host:port:user:pass
  let hostIsLast = looksLikeHost(secondLast) && isPort(last); // user:pass:host:port
  if (hostIsFirst && hostIsLast) {
    // Tie-break: prefer the side that is unmistakably a host.
    hostIsFirst = strongHost(first);
    hostIsLast = strongHost(secondLast);
    if (hostIsFirst === hostIsLast) {
      throw parseError('ambiguous');
    }
  }
  if (hostIsFirst) {
    const { host, port } = parseHostPort(`${first}:${second}`);
    return build(scheme, host, port, parts[2] ?? '', parts.slice(3).join(':'));
  }
  if (hostIsLast) {
    const { host, port } = parseHostPort(`${secondLast}:${last}`);
    return build(scheme, host, port, first, parts.slice(1, -2).join(':'));
  }
  if (strongHost(first) || strongHost(secondLast)) {
    // A host, but no valid port next to it.
    throw parseError('invalid_port');
  }
  throw parseError('host_port_not_found');
}

/**
 * `user:pass:[ipv6]:port` taken apart, else `null`. By hand: the regular
 * expression for it, `^([^:]*):(.*):\[([^\]]+)\]:(\d+)$`, takes quadratic time on a
 * long run of `:[`.
 */
function splitHostLast(s: string): {
  user: string;
  password: string;
  address: string;
  port: string;
} | null {
  const close = s.lastIndexOf(']');
  if (close < 0 || s.charAt(close + 1) !== ':') return null;
  const port = s.slice(close + 2);
  if (!DIGITS_RE.test(port)) return null;
  // The last ":[" that has something before the "]" (not the empty "[]").
  let open = s.lastIndexOf(':[', close - 1);
  if (open + 2 >= close) open = s.lastIndexOf(':[', open - 1);
  if (open < 0) return null;
  const address = s.slice(open + 2, close);
  // A "]" inside would have made an earlier "[" no better.
  if (address.includes(']')) return null;
  const colon = s.indexOf(':');
  if (colon >= open) return null;
  return {
    user: s.slice(0, colon),
    password: s.slice(colon + 1, open),
    address,
    port,
  };
}

function looksLikeBareIPv6(s: string): boolean {
  const colon = s.lastIndexOf(':');
  return (
    parseIPv6(s) !== null ||
    (colon >= 0 && parseIPv6(s.slice(0, colon)) !== null)
  );
}

interface HostPort {
  host: string;
  port: number;
}

function parseHostPort(hostPort: string): HostPort {
  let host: string;
  let portText: string;
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    if (end < 0) throw parseError('unterminated_bracket');
    const rawHost = hostPort.slice(1, end);
    const rest = hostPort.slice(end + 1);
    if (rest === '') throw parseError('missing_port_ipv6');
    if (!rest.startsWith(':')) throw parseError('invalid_after_ipv6');
    portText = rest.slice(1);
    // Whatever follows a '%' is a zone name (fe80::1%eth0) and is dropped unchecked.
    const address = parseIPv6(rawHost.split('%')[0] ?? '');
    if (address === null) throw parseError('invalid_ipv6');
    host = address;
  } else {
    if (hostPort.split(':').length > 2) {
      if (looksLikeBareIPv6(hostPort)) throw parseError('ipv6_needs_brackets');
      throw parseError('unparsed_url_form');
    }
    const colon = hostPort.indexOf(':');
    portText = colon < 0 ? '' : hostPort.slice(colon + 1);
    if (colon < 0 || portText === '') throw parseError('missing_port');
    host = normalizeHost(hostPort.slice(0, colon));
  }
  if (!isPort(portText)) throw parseError('invalid_port');
  return { host, port: Number.parseInt(portText, 10) };
}

function normalizeHost(raw: string): string {
  if (raw === '') throw parseError('missing_host');
  let host = stripTrailing(raw, '.').toLowerCase();
  if (NON_ASCII.test(host)) host = toAscii(host);
  if (/^[0-9.]+$/.test(host)) {
    if (isIPv4(host)) return host;
    throw parseError('invalid_ipv4');
  }
  if (
    host.length > 253 ||
    !host.split('.').every((label) => LABEL_RE.test(label))
  ) {
    throw parseError('invalid_hostname');
  }
  return host;
}

/**
 * An internationalized name as punycode (`xn--...`), label by label. The runtime
 * converter reads its input as a URL host, where "a/b" or "a#b" are cut short,
 * "127.1" or "0x7f.1" become an IPv4 address and a name ending in a number is
 * refused. So the compatibility mapping of nameprep (fullwidth letters, digits
 * and dots become ASCII) runs first, and only labels with a non-ASCII letter
 * are handed over, free of URL delimiters.
 */
function toAscii(host: string): string {
  // U+3002 and U+FF61 are label separators too (U+FF0E is mapped by NFKC).
  const mapped = host
    .replace(MAPPED_TO_NOTHING, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3002\uff61]/g, '.');
  if (HOST_DELIMITER.test(mapped)) throw parseError('invalid_hostname');
  return mapped
    .split('.')
    .map((label) => {
      if (!NON_ASCII.test(label)) return label;
      const ascii = domainToASCII(label);
      if (ascii === '') throw parseError('invalid_hostname');
      return ascii;
    })
    .join('.');
}

function isPort(value: string): boolean {
  if (!PORT_RE.test(value)) return false;
  const port = Number.parseInt(value, 10);
  return port > 0 && port < 65536;
}

function looksLikeHost(value: string): boolean {
  try {
    normalizeHost(value);
  } catch (error) {
    if (error instanceof ProxyParseError) return false;
    throw error;
  }
  return true;
}

/** An IP literal, `localhost` or a dotted name: not something that is usually a username. */
function strongHost(value: string): boolean {
  const v = stripTrailing(value.toLowerCase(), '.');
  return v === 'localhost' || (v.includes('.') && looksLikeHost(v));
}

function build(
  scheme: ProxyScheme,
  host: string,
  port: number,
  user: string | null,
  password: string | null,
): ProxyConfig {
  if (user === '' && (password === null || password === '')) {
    // "@host:port" or ":@host:port": no credentials.
    user = null;
    password = null;
  }
  if (user !== null) {
    if (user === '') throw parseError('password_without_username');
    if (user.includes(':')) {
      throw parseError('username_has_colon');
    }
    if (CONTROL.test(user + (password ?? ''))) {
      throw parseError('credentials_control_chars');
    }
    if (
      scheme === 'socks5' &&
      (Buffer.byteLength(user) > 255 || Buffer.byteLength(password ?? '') > 255)
    ) {
      throw parseError('socks_credentials_too_long');
    }
  }
  return { scheme, host, port, username: user, password };
}

/**
 * Whether the line has more characters than a proxy can (counted as a person
 * counts them, an emoji is one). A line of at most that many UTF-16 units has at
 * most that many characters, so the cheap test answers first.
 */
function tooLong(line: string): boolean {
  return (
    line.length > MAX_PROXY_LINE && Array.from(line).length > MAX_PROXY_LINE
  );
}

/** The first `max` characters (code points, so no surrogate pair is cut in half). */
function firstChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/**
 * Parse one proxy per line. Never throws for bad lines: they are returned in
 * `errors`.
 *
 * Accepts CRLF/LF/CR line endings, a UTF-8 BOM, blank lines, full-line `#`
 * comments and surrounding whitespace. Lines repeating an earlier line's
 * identity key go to `duplicates`.
 */
export function parseProxyList(
  text: string,
  options: ParseOptions = {},
): ParsedList {
  const result: ParsedList = { proxies: [], duplicates: [], errors: [] };
  const firstSeen = new Map<string, number>();
  text.split(LINE_BREAK).forEach((raw, index) => {
    const lineno = index + 1;
    const line = trimInput(raw);
    if (line === '' || line.startsWith('#')) return;
    if (tooLong(line)) {
      const params = { max: MAX_PROXY_LINE };
      result.errors.push({
        lineno,
        maskedInput: `${maskCredentials(firstChars(line, 80))}...`,
        message: MESSAGES.line_too_long,
        code: 'line_too_long',
        params,
      });
      return;
    }
    let proxy: ProxyConfig;
    try {
      proxy = parseProxy(line, options);
    } catch (error) {
      if (!(error instanceof ProxyParseError)) throw error;
      result.errors.push({
        lineno,
        maskedInput: maskCredentials(line),
        message: error.message,
        code: error.code,
        params: error.params,
      });
      return;
    }
    const key = identityKeyOf(proxy);
    const first = firstSeen.get(key);
    if (first !== undefined) {
      result.duplicates.push({ lineno, proxy, firstLineno: first });
      return;
    }
    firstSeen.set(key, lineno);
    result.proxies.push({ lineno, proxy });
  });
  return result;
}

/**
 * Mask an input that could NOT be parsed, so which part is the password is
 * unknown. Keeps the scheme and the `host:port` of the line when that can be
 * told from the credentials (see `addressOf`); every other token becomes `***`.
 */
export function maskCredentials(text: string): string {
  const { prefix, tokens, index } = splitForMasking(text);
  const keep = index === null ? new Set<number>() : new Set([index, index + 2]);
  return (
    prefix +
    tokens
      .map((token, n) =>
        token === ':' || token === '@' || keep.has(n) ? token : '***',
      )
      .join('')
  );
}

/**
 * The tokens of a line: the text between the `:` and `@` that separate it, those
 * separators, and a bracketed IPv6 address `[...]` as one token (colons and
 * all). One pass: a regular expression for the brackets takes quadratic time on
 * a long run of `[`, which a pasted line may be.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let closing = text.indexOf(']');
  for (let i = 0; i < text.length; i += 1) {
    const character = text.charAt(i);
    if (character === ':' || character === '@') {
      if (i > start) tokens.push(text.slice(start, i));
      tokens.push(character);
      start = i + 1;
    } else if (character === '[') {
      if (closing !== -1 && closing < i) closing = text.indexOf(']', i);
      // No "]" left: every "[" after this one is just a character.
      if (closing === -1) continue;
      if (i > start) tokens.push(text.slice(start, i));
      tokens.push(text.slice(i, closing + 1));
      i = closing;
      start = closing + 1;
    }
  }
  if (start < text.length) tokens.push(text.slice(start));
  return tokens;
}

/** Whether `tokens[i..i + 2]` is a text, `:` and digits: the shape of host:port, whatever the host and the port are. */
function shapedAsAddress(tokens: readonly string[], i: number): boolean {
  const host = tokens[i];
  return (
    host !== undefined &&
    host !== ':' &&
    host !== '@' &&
    tokens[i + 1] === ':' &&
    DIGITS_RE.test(tokens[i + 2] ?? '')
  );
}

/**
 * Where in `tokens` the host of the line is (`tokens[index..index + 2]` is host,
 * `:`, port), or `null` when that cannot be told. Credentials can be shaped like
 * an address, a user name with a dot and a password of digits (`john.doe:1234`),
 * and a line may be refused for the host or the port it has. So the address is
 * only shown when
 *
 * - it is behind the last `@` (the form `user:pass@host:port`; in
 *   `host:port@user:pass` it is in front of it, where the credentials of the
 *   first form are, so nothing is kept for either),
 * - its host plainly looks like one and its port is up to 5 digits, and
 * - nothing else in the line is shaped like host:port, or is an IPv6 address:
 *   that could be the address, and this one the credentials.
 */
function addressOf(tokens: readonly string[]): number | null {
  const start = tokens.lastIndexOf('@') + 1;
  let index: number | null = null;
  for (let i = start; i + 2 < tokens.length; i += 1) {
    const host = tokens[i] ?? '';
    if (
      shapedAsAddress(tokens, i) &&
      PORT_RE.test(tokens[i + 2] ?? '') &&
      (host.startsWith('[') || strongHost(host))
    ) {
      index = i;
      break;
    }
  }
  if (index === null) return null;
  for (let other = 0; other < tokens.length; other += 1) {
    // Another IPv6 address is an address whatever follows it.
    if (other !== index && (tokens[other] ?? '').startsWith('[')) return null;
    const overlaps = other <= index + 2 && other + 2 >= index;
    if (!overlaps && shapedAsAddress(tokens, other)) return null;
  }
  return index;
}

/** The scheme prefix, the tokens, and `index`: where the host is (see `addressOf`), else `null`. */
function splitForMasking(text: string): {
  prefix: string;
  tokens: string[];
  index: number | null;
} {
  const match = SCHEME_RE.exec(text);
  const prefix = match ? `${match[1]}://` : '';
  const rest = match?.[2] ?? text;
  const tokens = tokenize(rest);
  return { prefix, tokens, index: addressOf(tokens) };
}
