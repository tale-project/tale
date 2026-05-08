import { parseAcceptLanguage } from './accept-language';
import { readLocaleCookie } from './cookie';
import {
  isUrlPrefixedLocale,
  type SupportedLocale,
  type UrlPrefixedLocale,
} from './locales';

/** Endpoints that must never be rewritten by locale negotiation: agent-facing
 *  files (sitemap, robots), structured Markdown exports, and `/api/*`. */
const SKIP_PREFIXES: readonly string[] = ['/api/'];
const SKIP_EXACT: ReadonlySet<string> = new Set([
  '/llms.txt',
  '/llms-full.txt',
  '/sitemap.xml',
  '/robots.txt',
]);

/** True for paths web/docs serve outside the locale-prefixed tree. */
export function isLocaleNeutralPath(pathname: string): boolean {
  if (SKIP_EXACT.has(pathname)) return true;
  if (pathname.toLowerCase().endsWith('.md')) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/** Parses the first non-empty segment of `pathname` and returns it if it's
 *  a URL-prefixed locale (`de`, `fr`); otherwise null. */
function urlPrefixLocale(pathname: string): UrlPrefixedLocale | null {
  const segments = pathname.split('/');
  for (const segment of segments) {
    if (segment.length === 0) continue;
    return isUrlPrefixedLocale(segment) ? segment : null;
  }
  return null;
}

/** Best path-locale (`'en' | 'de' | 'fr'`) implied by the user's
 *  Accept-Language header. Walks the parsed candidates in preference order
 *  and matches against the URL-prefixable set, narrowing regional tags
 *  (`de-DE` → `de`). Falls back to `'en'` when no candidate matches. */
function negotiateFromAcceptLanguage(
  acceptLanguageHeader: string | null | undefined,
): SupportedLocale {
  if (!acceptLanguageHeader) return 'en';
  for (const candidate of parseAcceptLanguage(acceptLanguageHeader)) {
    const base = candidate.split('-')[0].toLowerCase();
    if (isUrlPrefixedLocale(base)) return base;
    if (base === 'en') return 'en';
  }
  return 'en';
}

export interface NegotiatePathLocaleInput {
  pathname: string;
  cookieHeader: string | null | undefined;
  acceptLanguageHeader: string | null | undefined;
}

export interface NegotiatePathLocaleResult {
  /** Resolved active locale for this request. */
  locale: SupportedLocale;
  /** Pathname to redirect to, or null when the current path is correct. */
  redirectTo: string | null;
  /** Cookie value to set (refresh) on the response, or null when the cookie
   *  already matches and doesn't need rewriting. */
  setCookieValue: SupportedLocale | null;
  /** True when this is a locale-neutral path; the caller should skip
   *  Set-Cookie and Vary headers entirely. */
  skip: boolean;
}

/**
 * Path-based locale negotiation for `services/web` and `services/docs`. Run
 * this in the request handler **before** static asset resolution and apply
 * the result:
 *
 *   - if `skip` is true, serve the static asset unchanged.
 *   - if `redirectTo` is non-null, return `302 Location: redirectTo` and
 *     `Set-Cookie` with `setCookieValue`.
 *   - otherwise serve the static asset and append a `Set-Cookie` for
 *     `setCookieValue` when it is non-null.
 *
 * Decision tree:
 *
 *   1. Locale-neutral paths skip the negotiation entirely.
 *   2. URL has a `/de` or `/fr` prefix → that locale wins; refresh the cookie
 *      if it doesn't already match.
 *   3. URL is unprefixed:
 *      a. cookie ∈ {de, fr} → redirect to `/<cookie>` + path.
 *      b. cookie === 'en'  → stay on the unprefixed path.
 *      c. no cookie        → parse Accept-Language. Best match
 *                            ∈ {de, fr} → redirect; otherwise stay on EN.
 *                            Either way, set the cookie so subsequent
 *                            requests don't re-negotiate.
 */
export function negotiatePathLocale(
  input: NegotiatePathLocaleInput,
): NegotiatePathLocaleResult {
  const { pathname, cookieHeader, acceptLanguageHeader } = input;

  if (isLocaleNeutralPath(pathname)) {
    return { locale: 'en', redirectTo: null, setCookieValue: null, skip: true };
  }

  const cookieLocale = readLocaleCookie(cookieHeader);
  const prefix = urlPrefixLocale(pathname);

  if (prefix) {
    return {
      locale: prefix,
      redirectTo: null,
      setCookieValue: cookieLocale === prefix ? null : prefix,
      skip: false,
    };
  }

  if (cookieLocale && cookieLocale !== 'en') {
    return {
      locale: cookieLocale,
      redirectTo: prefixedPath(cookieLocale, pathname),
      setCookieValue: null,
      skip: false,
    };
  }

  if (cookieLocale === 'en') {
    return {
      locale: 'en',
      redirectTo: null,
      setCookieValue: null,
      skip: false,
    };
  }

  const detected = negotiateFromAcceptLanguage(acceptLanguageHeader);
  if (detected === 'en') {
    return {
      locale: 'en',
      redirectTo: null,
      setCookieValue: 'en',
      skip: false,
    };
  }
  return {
    locale: detected,
    redirectTo: prefixedPath(detected, pathname),
    setCookieValue: detected,
    skip: false,
  };
}

function prefixedPath(locale: UrlPrefixedLocale, pathname: string): string {
  if (pathname === '/' || pathname === '') return `/${locale}`;
  return `/${locale}${pathname}`;
}
