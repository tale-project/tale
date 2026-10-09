/**
 * A per-user cookie jar and Better Auth's session-cookie signing.
 *
 * A virtual user talks to one deployment, so the jar keys cookies by name
 * alone: Domain and Path are ignored (Better Auth sets every cookie on `/`).
 * What it does honour is expiry — Max-Age, Expires, and the empty-value
 * deletions sign-out sends — because a stale session cookie would turn every
 * later request into a 401 that looks like a server fault.
 *
 * The jar caches its `Cookie` header and rebuilds it only when a cookie
 * changes or expires, since every request of every user reads it.
 */

import { createHmac } from 'node:crypto';

/** Better Auth's cookie prefix, as the platform configures it. */
const COOKIE_PREFIX = 'better-auth';

interface StoredCookie {
  value: string;
  /** Epoch milliseconds, or `null` for a session cookie. */
  expiresAt: number | null;
}

export class CookieJar {
  readonly #cookies = new Map<string, StoredCookie>();
  #header: string | null = '';
  #earliestExpiry = Number.POSITIVE_INFINITY;

  /**
   * Absorb `Set-Cookie` response header values (one string, or the array
   * undici yields when the response sets several).
   */
  setFromHeaders(
    values: string | readonly string[] | undefined,
    now: number = Date.now(),
  ): void {
    if (values === undefined) {
      return;
    }
    if (typeof values === 'string') {
      this.#absorb(values, now);
      return;
    }
    for (const value of values) {
      this.#absorb(value, now);
    }
  }

  /** Store a cookie directly; `expiresAt` is epoch milliseconds. */
  set(name: string, value: string, expiresAt: number | null = null): void {
    this.#cookies.set(name, { value, expiresAt });
    if (expiresAt !== null && expiresAt < this.#earliestExpiry) {
      this.#earliestExpiry = expiresAt;
    }
    this.#header = null;
  }

  /** The current value of `name`, or `undefined` when absent or expired. */
  get(name: string, now: number = Date.now()): string | undefined {
    this.#expire(now);
    return this.#cookies.get(name)?.value;
  }

  delete(name: string): void {
    if (this.#cookies.delete(name)) {
      this.#header = null;
    }
  }

  clear(): void {
    this.#cookies.clear();
    this.#header = '';
    this.#earliestExpiry = Number.POSITIVE_INFINITY;
  }

  get size(): number {
    return this.#cookies.size;
  }

  /** The `Cookie` request header value; empty when the jar is empty. */
  header(now: number = Date.now()): string {
    this.#expire(now);
    if (this.#header === null) {
      let header = '';
      for (const [name, cookie] of this.#cookies) {
        header += header === '' ? '' : '; ';
        header += `${name}=${cookie.value}`;
      }
      this.#header = header;
    }
    return this.#header;
  }

  #absorb(setCookie: string, now: number): void {
    const semicolon = setCookie.indexOf(';');
    const pair = semicolon === -1 ? setCookie : setCookie.slice(0, semicolon);
    const equals = pair.indexOf('=');
    if (equals <= 0) {
      return;
    }
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    let maxAge: number | null = null;
    let expires: number | null = null;
    if (semicolon !== -1) {
      for (const attribute of setCookie.slice(semicolon + 1).split(';')) {
        const eq = attribute.indexOf('=');
        const key = (eq === -1 ? attribute : attribute.slice(0, eq))
          .trim()
          .toLowerCase();
        const raw = eq === -1 ? '' : attribute.slice(eq + 1).trim();
        if (key === 'max-age') {
          const seconds = Number.parseInt(raw, 10);
          if (Number.isFinite(seconds)) {
            maxAge = seconds;
          }
        } else if (key === 'expires') {
          const at = Date.parse(raw);
          if (Number.isFinite(at)) {
            expires = at;
          }
        }
      }
    }
    // Max-Age wins over Expires (RFC 6265 §5.3 step 3).
    const expiresAt = maxAge !== null ? now + maxAge * 1000 : expires;
    if (value === '' || (expiresAt !== null && expiresAt <= now)) {
      this.delete(name);
      return;
    }
    this.set(name, value, expiresAt);
  }

  #expire(now: number): void {
    if (now < this.#earliestExpiry) {
      return;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const [name, cookie] of this.#cookies) {
      if (cookie.expiresAt === null) {
        continue;
      }
      if (cookie.expiresAt <= now) {
        this.#cookies.delete(name);
        this.#header = null;
      } else if (cookie.expiresAt < earliest) {
        earliest = cookie.expiresAt;
      }
    }
    this.#earliestExpiry = earliest;
  }
}

/**
 * Name of Better Auth's session cookie for a deployment: browsers only keep
 * `__Secure-` cookies over https, so the platform adds the prefix there.
 */
export function sessionCookieName(baseUrl: string): string {
  const secure = new URL(baseUrl).protocol === 'https:';
  return `${secure ? '__Secure-' : ''}${COOKIE_PREFIX}.session_token`;
}

/**
 * The cookie value Better Auth expects for a session token: exactly what
 * better-call's `signCookieValue` produces — `token.signature`, where the
 * signature is the standard-base64 HMAC-SHA256 of the token under the auth
 * secret, the whole URI-encoded. Synchronous through node:crypto so minting
 * a hundred thousand cookies does not queue a hundred thousand promises.
 */
export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}
