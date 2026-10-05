import { isCookieLocale, type SupportedLocale } from './locales';

/** The single locale-cookie name shared by `services/web` and `services/docs`.
 *  Picking a `tale_` prefix avoids collisions with third-party scripts and
 *  makes the cookie's origin obvious in browser dev tools. */
export const LOCALE_COOKIE_NAME = 'tale_locale';

/** One year, refreshed on every visit. */
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface SerializeLocaleCookieOptions {
  value: SupportedLocale;
  /** Set to share across subdomains (e.g. `.tale.dev`); leave undefined in dev. */
  domain?: string;
  /** Send only over HTTPS. Pass `true` in production, `false` in local dev. */
  secure: boolean;
  /** Defaults to one year. */
  maxAgeSeconds?: number;
}

/**
 * Serializes the locale cookie into a `Set-Cookie` header value. Throws on
 * locale values that aren't part of the cookie set — this is a programming
 * error, not bad user input, so it should never reach a request handler.
 */
export function serializeLocaleCookie({
  value,
  domain,
  secure,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
}: SerializeLocaleCookieOptions): string {
  if (!isCookieLocale(value)) {
    throw new Error(
      `Refusing to serialize locale cookie with unsupported value: ${String(value)}`,
    );
  }
  const parts = [
    `${LOCALE_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Parses the `Cookie` request header and returns the value of `tale_locale`
 * if it's a recognized cookie locale (`'en' | 'de' | 'fr'`); otherwise null.
 * Unknown or malformed values are treated as missing so the negotiator
 * re-derives a fresh value.
 */
export function readLocaleCookie(
  cookieHeader: string | null | undefined,
): SupportedLocale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== LOCALE_COOKIE_NAME) continue;
    const raw = trimmed.slice(eq + 1).trim();
    const value = decodeCookieValue(raw);
    return isCookieLocale(value) ? value : null;
  }
  return null;
}

function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
