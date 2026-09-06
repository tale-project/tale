import { anyRefs } from '../shared/handlers/function-refs';
import {
  WEBDAV_MAX_AUTH_HEADER,
  type AuthContext,
  type WebDAVCtx,
  type WebDAVRequest,
} from './types';

// MIRROR OF backend/core/webdav/helpers.ts — keep these in sync. The
// duplication predates the Postgres port (the retired Convex isolate could
// not import from lib/); both sides are Node now, so folding them into one
// copy is possible and worth its own change. Until then: if you change one,
// change both — auth-parity.test.ts pins them to the same output bytes.

// Outcome of Basic-auth verification + org-slug resolution.
//
// `status` is restricted to 401 / 403 because the current handler.ts
// dispatch maps non-401 to a literal 403. Rate-limit exhaustion is
// surfaced as `status: 403, reason: 'rate limited'` to preserve the
// existing switch shape; widening to 429 requires a handler.ts change
// (out of scope for this commit — see plan section D.3 owner).
type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; status: 401 | 403; reason: string };

interface ParseBasicResult {
  username: string;
  password: string;
}

function parseBasicHeader(header: string | null): ParseBasicResult | null {
  if (!header) return null;
  // A correctly-formed Basic header with UTF-8 user/pass is well under 1 KB;
  // anything past WEBDAV_MAX_AUTH_HEADER is malformed or an attempt to push
  // expensive base64 decoding work into the auth fast-path. Treat as
  // "missing" (401) — don't 400, since browsers would surface that as a
  // hard failure rather than retrying with credentials.
  if (header.length > WEBDAV_MAX_AUTH_HEADER) return null;
  if (!header.toLowerCase().startsWith('basic ')) return null;
  const b64 = header.slice(6).trim();
  // atob is ASCII — we have to manually map the resulting binary string
  // to bytes and then UTF-8-decode. RFC 7617 §2.1 mandates UTF-8 for
  // user-id/password when the server advertises `charset="UTF-8"` in
  // the WWW-Authenticate challenge (we do — see buildUnauthorizedResponse).
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    // Malformed base64 — user error, not a server bug. Returning null
    // surfaces the standard 401 + WWW-Authenticate challenge so the
    // client can retry with corrected credentials. No log: this is the
    // hot path; a noisy log per probe is a DoS amplifier.
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

interface AppPasswordCandidate {
  _id: string;
  userId: string;
  passwordHashed: string;
}

function parseCandidates(payload: unknown): AppPasswordCandidate[] {
  if (!Array.isArray(payload)) return [];
  const out: AppPasswordCandidate[] = [];
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    if (!('_id' in item) || !('userId' in item) || !('passwordHashed' in item))
      continue;
    const id: unknown = item._id;
    const uid: unknown = item.userId;
    const hash: unknown = item.passwordHashed;
    if (
      typeof id !== 'string' ||
      typeof uid !== 'string' ||
      typeof hash !== 'string'
    )
      continue;
    out.push({ _id: id, userId: uid, passwordHashed: hash });
  }
  return out;
}

// Hex pattern used to validate the configured HMAC secret before we
// hand it to crypto.subtle. Anchored + case-insensitive (operators
// occasionally paste uppercase).
const HEX_RE = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  // Defense in depth — `parseInt('zz', 16) === NaN` silently coerces
  // to 0, so an unvalidated path would produce zero bytes and a key
  // an attacker can guess. Fail loudly instead. The handler's
  // getHmacSecret() should have already rejected non-hex input.
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new Error('hexToBytes: input is not valid even-length hex');
  }
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeText(s: string): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(utf8.byteLength);
  new Uint8Array(buf).set(utf8);
  return new Uint8Array(buf);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// Exported for the cross-module parity test (auth-parity.test.ts), which
// pins this against the backend/core/webdav/helpers.ts duplicate. Not part
// of the public auth surface otherwise.
export async function hmacHash(
  plaintext: string,
  secretHex: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encodeText(plaintext));
  return bytesToHex(new Uint8Array(sig));
}

// Exported for the cross-module parity test (see hmacHash above).
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface AuthDeps {
  // Map orgSlug → { organizationId, userId-allowed-list }
  resolveOrgAndMembership: (
    orgSlug: string,
    userId: string,
  ) => Promise<{ organizationId: string } | null>;
  hmacSecret: string;
}

// Track lastUsedAt write debouncing — one write per app-password per
// minute. Caches the timestamp of the last successful auth per id. Once the
// map passes the sweep size, entries older than the interval are evicted on
// the next touch, so revoked or retired credentials never pin memory for
// the life of the process: the map holds at most the credentials that
// authenticated within the last minute (plus one sweep's worth of slack).
const lastUseTouchAt = new Map<string, number>();
const LAST_USE_TOUCH_INTERVAL_MS = 60_000;
const LAST_USE_TOUCH_SWEEP_SIZE = 1_000;

function sweepStaleLastUseTouches(now: number): void {
  if (lastUseTouchAt.size < LAST_USE_TOUCH_SWEEP_SIZE) return;
  for (const [id, touchedAt] of lastUseTouchAt) {
    if (now - touchedAt > LAST_USE_TOUCH_INTERVAL_MS) {
      lastUseTouchAt.delete(id);
    }
  }
}

export async function verifyBasicAuthForDav(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  orgSlug: string,
  deps: AuthDeps,
): Promise<AuthResult> {
  const parsed = parseBasicHeader(req.headers.get('authorization'));
  if (!parsed) {
    // No credentials at all — this is the client's first probe to elicit
    // the WWW-Authenticate challenge, which every legitimate mount does.
    // Do NOT charge the throttle here, or we'd penalize every real client.
    return { ok: false, status: 401, reason: 'Missing Basic auth' };
  }

  const clientIp =
    req.clientIp && req.clientIp.length > 0 ? req.clientIp : 'unknown';
  // Charge a single failed attempt against the per-IP (+ per-org backstop)
  // throttle and report whether the caller is now rate-limited. Called
  // ONLY on a failed/absent credential match — successful auths charge
  // nothing, so legitimate clients never deplete the bucket.
  const chargeFailure = async (organizationId: string): Promise<boolean> => {
    try {
      await ctx.backend.mutation(
        anyRefs.webdav.app_password_queries.chargeWebdavAuthFailure,
        { organizationId, clientIp },
      );
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RATE_LIMITED')) {
        console.warn('[webdav] auth rate-limited', { orgSlug, clientIp });
        return true;
      }
      // Limiter infra error — fail open so a limiter outage can't lock
      // every client out, but log it for visibility.
      console.warn('[webdav] auth-failure charge errored', err);
      return false;
    }
  };

  // First resolve orgSlug → organizationId. Without an org we can't
  // even look up the candidate rows by prefix.
  const orgRow = await deps.resolveOrgAndMembership(orgSlug, '');
  if (!orgRow) {
    // Throttle org-slug enumeration by IP (no org id yet → IP bucket only).
    if (await chargeFailure('')) {
      return { ok: false, status: 403, reason: 'rate limited' };
    }
    // 401 (not 404) — never confirm or deny org existence to anon callers.
    return { ok: false, status: 401, reason: 'Invalid org' };
  }

  const prefix = parsed.password.slice(0, 4);
  // findCandidatesByPrefix is a read-only internalQuery — it consumes no
  // rate-limit token. Throttling is charged below, only on a failed
  // match, so successful auths never deplete the bucket.
  const rawCandidates = await ctx.backend.query(
    anyRefs.webdav.app_password_queries.findCandidatesByPrefix,
    {
      organizationId: orgRow.organizationId,
      prefix,
    },
  );
  const candidates = parseCandidates(rawCandidates);

  if (candidates.length === 0) {
    if (await chargeFailure(orgRow.organizationId)) {
      return { ok: false, status: 403, reason: 'rate limited' };
    }
    return { ok: false, status: 401, reason: 'Invalid credentials' };
  }

  const supplied = await hmacHash(parsed.password, deps.hmacSecret);
  let matched: { _id: string; userId: string } | null = null;
  for (const c of candidates) {
    if (timingSafeEqual(supplied, c.passwordHashed)) {
      matched = { _id: c._id, userId: c.userId };
      break;
    }
  }
  if (!matched) {
    if (await chargeFailure(orgRow.organizationId)) {
      return { ok: false, status: 403, reason: 'rate limited' };
    }
    return { ok: false, status: 401, reason: 'Invalid credentials' };
  }

  // Confirm the resolved user is actually a member of the org — guards
  // against a stale row (membership removed after app-password issue).
  const membership = await deps.resolveOrgAndMembership(
    orgSlug,
    matched.userId,
  );
  if (!membership) {
    // Log the precise reason server-side for forensics, but never let
    // the client distinguish "not a member" from other 403 causes —
    // that would let an attacker enumerate which (user, org) pairs
    // hold app-passwords. The wire body stays generic.
    console.warn('[webdav] auth forbidden:', {
      orgSlug,
      userId: matched.userId,
      reason: 'not a member of org',
    });
    return { ok: false, status: 403, reason: 'forbidden' };
  }

  // Debounced lastUsedAt — fire-and-forget.
  const now = Date.now();
  const lastTouch = lastUseTouchAt.get(matched._id) ?? 0;
  if (now - lastTouch > LAST_USE_TOUCH_INTERVAL_MS) {
    sweepStaleLastUseTouches(now);
    lastUseTouchAt.set(matched._id, now);
    void ctx.backend
      .mutation(anyRefs.webdav.app_password_mutations.recordAppPasswordUse, {
        id: matched._id,
        at: now,
      })
      .catch((err) => console.warn('[webdav] lastUsedAt patch failed', err));
  }

  return {
    ok: true,
    auth: {
      userId: matched.userId,
      organizationId: membership.organizationId,
      orgSlug,
      appPasswordId: matched._id,
    },
  };
}

export function buildUnauthorizedResponse(): {
  status: 401;
  headers: Record<string, string>;
  body: string;
} {
  return {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Tale WebDAV", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: 'Unauthorized',
  };
}
