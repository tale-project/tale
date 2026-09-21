/**
 * The panel's session.
 *
 * One password guards one panel, so there is no user table and nothing to
 * look up: a successful login mints a short, signed token carrying only the
 * instant it was issued. The HMAC over `AI_GATEWAY_SESSION_SECRET` is what
 * makes it unforgeable, and the issue time is what makes it expire. The
 * secret lives in the environment, so restarting with a new one invalidates
 * every outstanding session — which is the intended way to kick everyone out.
 */

import { createHmac } from 'node:crypto';

import { secretsMatch } from './crypto';

export const SESSION_COOKIE_NAME = 'ai_gateway_session';

/** How long a panel login lasts before the person signs in again. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionSigner {
  /** Mint a cookie value for a session starting now. */
  issue(now?: Date): string;
  /** True when the value is well-formed, correctly signed and unexpired. */
  verify(value: string | undefined | null, now?: Date): boolean;
}

export function createSessionSigner(
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): SessionSigner {
  function sign(issuedAt: string): string {
    return createHmac('sha256', secret).update(issuedAt).digest('base64url');
  }

  return {
    issue(now = new Date()) {
      const issuedAt = String(now.getTime());
      return `${issuedAt}.${sign(issuedAt)}`;
    },

    verify(value, now = new Date()) {
      if (!value) return false;
      const separator = value.indexOf('.');
      if (separator <= 0) return false;
      const issuedAt = value.slice(0, separator);
      const signature = value.slice(separator + 1);
      if (!secretsMatch(signature, sign(issuedAt))) return false;

      const issuedAtMs = Number(issuedAt);
      if (!Number.isFinite(issuedAtMs)) return false;
      const ageSeconds = (now.getTime() - issuedAtMs) / 1000;
      return ageSeconds >= 0 && ageSeconds < ttlSeconds;
    },
  };
}

/**
 * Read the API key off a request, accepting either spelling.
 *
 * `Authorization: Bearer <key>` is what a caller reaches for first;
 * `x-api-key` is what the simpler HTTP clients and webhook senders emit.
 */
export function readApiKey(headers: Headers): string | null {
  const authorization = headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value) return value;
  }
  const headerKey = headers.get('x-api-key')?.trim();
  return headerKey ? headerKey : null;
}
