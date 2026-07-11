import { authClient } from '@/lib/auth-client';
import { isRecord } from '@/lib/utils/type-utils';

/**
 * Last-known Convex JWT, persisted so the NEXT cold load can pre-authenticate
 * the WebSocket while the Better Auth session revalidates in parallel — this
 * collapses the serial cold-load auth handshake (session HTTP → token HTTP →
 * WS authenticate) that blocks every auth-gated query (epic #2386).
 *
 * Safety model (correctness over speed):
 * - The record stores the JWT's own `exp`, `sessionId`, and `sub` claims;
 *   reads reject expired (with leeway) or malformed records — a stale cache
 *   degrades to today's serial path, never to a broken one.
 * - `sessionStorage`, not `localStorage`: the token is a bearer credential, so
 *   it stays scoped to the tab and dies with it. The epic's measured scenario
 *   (hard refresh of a dashboard tab) is exactly what survives.
 * - The Convex client treats a cached token as provisional: after the server
 *   confirms it, the auth manager immediately force-refreshes a fresh
 *   cookie-minted token (see convex's `AuthenticationManager.setConfig`), so a
 *   cached token is only ever live for ~one round trip.
 * - The cache is cleared on sign-out, whenever Better Auth resolves signed-out,
 *   and when an auth screen mounts (`/_auth` layout) — the only same-tab door
 *   to a user switch — so one user's token cannot pre-authenticate another's
 *   load (see `use-auth-from-better-auth.ts` for the session-binding check).
 */

const STORAGE_KEY = 'tale:convex-token';

/** Reject tokens that would expire before the WS handshake can use them. */
const EXPIRY_LEEWAY_MS = 30 * 1000;

const isBrowser = typeof window !== 'undefined';

export interface CachedConvexToken {
  token: string;
  /** Better Auth session id the token was minted for (`sessionId` claim). */
  sessionId: string;
  /** Better Auth user id the token authenticates (`sub` claim). */
  userId: string;
  /** JWT `exp` claim, in milliseconds since epoch. */
  expiresAt: number;
}

/**
 * Decode a JWT payload without verifying the signature — the server (and the
 * Convex backend) remain the only verifiers; this is used purely to read the
 * token's own claims for client-side cache bookkeeping.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const parsed: unknown = JSON.parse(atob(base64));
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Failed to decode cached Convex token payload:', error);
    return null;
  }
}

function toRecord(token: string): CachedConvexToken | null {
  const claims = decodeJwtPayload(token);
  if (!claims) return null;
  const { sessionId, sub, exp } = claims;
  if (
    typeof sessionId !== 'string' ||
    typeof sub !== 'string' ||
    typeof exp !== 'number'
  ) {
    return null;
  }
  return { token, sessionId, userId: sub, expiresAt: exp * 1000 };
}

export function isTokenUsable(record: CachedConvexToken): boolean {
  return record.expiresAt - EXPIRY_LEEWAY_MS > Date.now();
}

/**
 * The persisted last-known token, or `null` when absent, malformed, or expired
 * (expired/malformed records are removed so the cold path stays clean).
 */
export function readCachedConvexToken(): CachedConvexToken | null {
  if (!isBrowser) return null;
  let token: string | null = null;
  try {
    token = window.sessionStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to read cached Convex token:', error);
    return null;
  }
  if (!token) return null;
  const record = toRecord(token);
  if (!record || !isTokenUsable(record)) {
    clearConvexTokenCache();
    return null;
  }
  return record;
}

/**
 * Persist a freshly minted token (or clear with `null`). Returns the decoded
 * record, or `null` when the token was absent or malformed.
 */
export function cacheConvexToken(
  token: string | null,
): CachedConvexToken | null {
  const record = token ? toRecord(token) : null;
  if (isBrowser) {
    try {
      if (record) {
        window.sessionStorage.setItem(STORAGE_KEY, record.token);
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      // Quota / security errors — pre-auth is lost for the next reload only;
      // this load already holds the token in memory.
      console.warn('Failed to persist Convex token:', error);
    }
  }
  return record;
}

export function clearConvexTokenCache(): void {
  cacheConvexToken(null);
}

/**
 * User id of the persisted token, if a usable one exists. Used to key other
 * shell caches to the identity the WS will (pre-)authenticate as, before the
 * session query has resolved.
 */
export function getCachedConvexTokenUserId(): string | undefined {
  return readCachedConvexToken()?.userId;
}

/**
 * Mint a fresh Convex JWT from the current session cookie and persist it.
 * Resolves `null` when signed out or on transport failure (the auth client's
 * fetch layer already retries 5xx) — a `null` result clears the persisted copy
 * so a later cold load can never pre-authenticate with a token the backend
 * just refused to renew.
 */
export async function fetchFreshConvexToken(): Promise<CachedConvexToken | null> {
  const result = await authClient.convex?.token?.({
    fetchOptions: { throw: false },
  });
  return cacheConvexToken(result?.data?.token ?? null);
}

let warmToken: Promise<CachedConvexToken | null> | null = null;

/**
 * Kick the Convex token mint at module load, in PARALLEL with the session
 * fetch (`warmSession`), instead of serially after it — and keep the promise
 * so the auth provider's first `fetchAccessToken` can consume the in-flight
 * result rather than starting a third HTTP hop.
 */
export function warmConvexToken(): void {
  if (!isBrowser || warmToken) return;
  warmToken = fetchFreshConvexToken().catch((error: unknown) => {
    console.warn('Failed to warm Convex token:', error);
    return null;
  });
}

/**
 * One-shot: the module-load warm token fetch, or `null` once consumed (or when
 * never warmed). Single consumer semantics keep a long-lived page from reusing
 * a token minted for a previous sign-in.
 */
export function takeWarmConvexToken(): Promise<CachedConvexToken | null> | null {
  const taken = warmToken;
  warmToken = null;
  return taken;
}
