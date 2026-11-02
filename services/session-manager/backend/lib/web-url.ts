// Web addresses: what the start page and the address bar accept, and which
// tabs a session reopens.

import { isIPv4, isIPv6 } from 'node:net';
import { domainToASCII } from 'node:url';

import { isRecord } from '../../lib/is-record.ts';

export const DEFAULT_START_PAGE = 'https://www.google.com';
const SEARCH_URL = 'https://www.google.com/search?';
/** Sign-in and magic links run to several thousand characters. */
const MAX_URL_LENGTH = 16_384;

const SCHEME = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/i;
const HOST_AND_PORT = /^(.+?)(?::(\d{1,5}))?$/;
const UNUSABLE_CHARACTER = /[\s\u0000-\u001f]/u;

function isDomain(name: string): boolean {
  // münchen.de is xn--mnchen-3ya.de; an unusable name converts to ''.
  const ascii = domainToASCII(name);
  return ascii !== '' && DOMAIN.test(ascii);
}

/**
 * `localhost`, or an IP address (IPv6 in brackets). They are addresses like
 * any other: a session's browser sends them through the session's proxy too
 * (`network.proxy.allow_hijacking_localhost`, see `LAUNCH_PREFS`), so they
 * reach this computer's services only if the proxy does.
 */
function isLocal(name: string): boolean {
  if (name.toLowerCase() === 'localhost') return true;
  if (name.startsWith('[') && name.endsWith(']')) {
    return isIPv6(name.slice(1, -1));
  }
  return isIPv4(name);
}

/**
 * The http(s) URL the text means, or `null`. Without a scheme,
 * "example.com/page" gets https:// (http:// for localhost, IP addresses and
 * port 80).
 */
export function webUrl(raw: string): string | null {
  const text = raw.trim();
  if (
    text === '' ||
    text.length > MAX_URL_LENGTH ||
    UNUSABLE_CHARACTER.test(text)
  ) {
    return null;
  }
  if (SCHEME.test(text)) {
    try {
      // A port that is not a number, or a host that is not one, throws.
      return new URL(text).hostname === '' ? null : text;
    } catch {
      return null;
    }
  }
  const host = text.split(/[/?#]/, 1)[0] ?? '';
  const match = HOST_AND_PORT.exec(host);
  const name = match?.[1];
  const port = match?.[2];
  if (name === undefined) return null;
  if (isDomain(name)) return `${port === '80' ? 'http' : 'https'}://${text}`;
  if (isLocal(name)) return `http://${text}`;
  return null;
}

/**
 * What the address bar navigates to: the address itself, else a web search
 * for the text. `null` when there is nothing to open: the bar is empty, or
 * what is in it is an address that cannot be opened (it is not searched for: a
 * pasted link may hold a token that does not belong in a search engine).
 */
export function addressBarUrl(raw: string): string | null {
  const url = webUrl(raw);
  if (url !== null) return url;
  const text = raw.trim();
  if (text === '' || ANY_SCHEME.test(text) || text.length > MAX_URL_LENGTH) {
    return null;
  }
  return SEARCH_URL + new URLSearchParams({ q: text }).toString();
}

/**
 * The address of a tab worth reopening (a web page, or the page that failed to
 * load), else `null`.
 */
export function restorableUrl(address: string): string | null {
  let url = address;
  // Firefox's error pages keep the address in "u".
  if (url.startsWith('about:neterror') || url.startsWith('about:certerror')) {
    url = queryParam(url, 'u') ?? '';
  }
  return SCHEME.test(url) && url.length <= MAX_URL_LENGTH ? url : null;
}

/** One parameter of the query of an address, or `undefined`. */
export function queryParam(address: string, name: string): string | undefined {
  const query = address.split('?', 2)[1];
  if (query === undefined) return undefined;
  return new URLSearchParams(query.split('#', 1)[0]).get(name) ?? undefined;
}

/** The tabs a session had open when it ended; `active` indexes into `urls`. */
export interface TabLayout {
  urls: readonly string[];
  active: number;
}

export const EMPTY_LAYOUT: TabLayout = { urls: [], active: 0 };

export function layoutToJson(layout: TabLayout): string {
  return JSON.stringify({ urls: layout.urls, active: layout.active });
}

/** Bad data never breaks a start: unusable entries are dropped. */
export function layoutFromJson(text: string): TabLayout {
  const data: unknown = JSON.parse(text);
  const record = isRecord(data) ? data : {};
  const urls = Array.isArray(record.urls)
    ? record.urls.filter((url): url is string => typeof url === 'string')
    : [];
  const active = record.active;
  return {
    urls,
    active:
      typeof active === 'number' &&
      Number.isInteger(active) &&
      active >= 0 &&
      active < urls.length
        ? active
        : 0,
  };
}

export function sameLayout(a: TabLayout, b: TabLayout): boolean {
  return (
    a.active === b.active &&
    a.urls.length === b.urls.length &&
    a.urls.every((url, index) => url === b.urls[index])
  );
}
