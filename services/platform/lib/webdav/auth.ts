import { anyApi } from 'convex/server';

import type { AuthContext, WebDAVCtx, WebDAVRequest } from './types';

// Outcome of Basic-auth verification + org-slug resolution.
export type AuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; status: 401 | 403; reason: string };

interface ParseBasicResult {
  username: string;
  password: string;
}

function parseBasicHeader(header: string | null): ParseBasicResult | null {
  if (!header) return null;
  if (!header.toLowerCase().startsWith('basic ')) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return null;
  }
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

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
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

async function hmacHash(plaintext: string, secretHex: string): Promise<string> {
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

function timingSafeEqual(a: string, b: string): boolean {
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
// minute. Caches the timestamp of the last successful auth per id.
const lastUseTouchAt = new Map<string, number>();
const LAST_USE_TOUCH_INTERVAL_MS = 60_000;

export async function verifyBasicAuthForDav(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  orgSlug: string,
  deps: AuthDeps,
): Promise<AuthResult> {
  const parsed = parseBasicHeader(req.headers.get('authorization'));
  if (!parsed) {
    return { ok: false, status: 401, reason: 'Missing Basic auth' };
  }

  // First resolve orgSlug → organizationId. Without an org we can't
  // even look up the candidate rows by prefix.
  const orgRow = await deps.resolveOrgAndMembership(orgSlug, '');
  if (!orgRow) {
    // 401 (not 404) — never confirm or deny org existence to anon callers.
    return { ok: false, status: 401, reason: 'Invalid org' };
  }

  const prefix = parsed.password.slice(0, 4);
  const rawCandidates: unknown = await ctx.convex.query(
    anyApi.webdav.app_password_queries.findCandidatesByPrefix,
    {
      organizationId: orgRow.organizationId,
      prefix,
    },
  );
  const candidates = parseCandidates(rawCandidates);

  if (candidates.length === 0) {
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
    return { ok: false, status: 401, reason: 'Invalid credentials' };
  }

  // Confirm the resolved user is actually a member of the org — guards
  // against a stale row (membership removed after app-password issue).
  const membership = await deps.resolveOrgAndMembership(
    orgSlug,
    matched.userId,
  );
  if (!membership) {
    return { ok: false, status: 403, reason: 'Not a member of org' };
  }

  // Debounced lastUsedAt — fire-and-forget.
  const now = Date.now();
  const lastTouch = lastUseTouchAt.get(matched._id) ?? 0;
  if (now - lastTouch > LAST_USE_TOUCH_INTERVAL_MS) {
    lastUseTouchAt.set(matched._id, now);
    void ctx.convex
      .mutation(anyApi.webdav.app_password_mutations.recordAppPasswordUse, {
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
