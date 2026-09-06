/**
 * Signed capability tokens for the connectors HOST-CALL endpoint —
 * the platform end of a live yaml-js body running out of process.
 *
 * A live connector body executes inside the org's sandbox session
 * (sandbox-exec runner), but its `ctx.http` stays PLATFORM-MEDIATED: the
 * in-sandbox portable ctx round-trips every request to
 * `/api/connectors/hostcall`, where the real live host (allowlist, https,
 * response caps, Authorization injection) performs it. This token is what the
 * portable ctx presents: it grants exactly one (org, connector, action,
 * credentialRef) tuple for the length of one run — the endpoint re-resolves
 * the credential itself, so no secret ever rides in the token.
 *
 * Token: `v1.<b64url(payload)>.<b64url(hmac)>`, HMAC-SHA256 with a
 * purpose-derived subkey of the deployment HMAC root — the exact scheme of
 * `lib/storage/sandbox_stage_token.ts`, with its own derivation context so a
 * compromise of one domain's subkey never crosses into the other.
 *
 * Pure Web-Crypto — usable from the Convex isolate (the httpAction verifier)
 * and node actions (the dispatch-time signer).
 */

const TOKEN_VERSION = 'v1';
const KEY_DERIVATION_CONTEXT = 'connectors-hostcall:v1';
/** A token lives for one dispatcher run; the live-body deadline is 60s, so a
 * few minutes absorbs sandbox scheduling without leaving a long-lived bearer
 * in program text. */
export const HOSTCALL_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface HostcallTokenPayload {
  /** Better Auth organization id the credential belongs to. */
  org: string;
  /** Connector slug the run is confined to. */
  connector: string;
  /** Action name, for the audit trail — the endpoint mediates any request the
   * connector's own allowlist admits, exactly like the in-process host. */
  action: string;
  /** The credential the dispatcher resolved for this run, so the endpoint
   * re-resolves the SAME row (absent = the org default). */
  credentialRef?: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array | null {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return new Uint8Array(buf);
}

/** Constant-time comparison — a plain `===` on the signature would leak a
 * byte-position oracle to a forger timing the route. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The deployment HMAC root (see sandbox_stage_token.ts — the deployment-wide
 * HMAC secret every install carries). `null` on a minimal dev setup; the
 * signer then reports "unavailable" and live sandbox execution refuses. */
function hmacRoot(): string | null {
  const raw = process.env.WEBDAV_APP_PASSWORD_HMAC_KEY;
  if (!raw || raw.length < 64) return null;
  return raw;
}

async function deriveKey(root: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    utf8(`${root}:${KEY_DERIVATION_CONTEXT}`),
  );
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signMessage(root: string, message: string): Promise<Uint8Array> {
  const key = await deriveKey(root);
  const sig = await crypto.subtle.sign('HMAC', key, utf8(message));
  return new Uint8Array(sig);
}

/** Mint a host-call token for one run. Returns `null` when the deployment has
 * no HMAC root to sign with. `now` is injectable for tests. */
export async function signHostcallToken(
  payload: {
    org: string;
    connector: string;
    action: string;
    credentialRef?: string;
  },
  now: number = Date.now(),
): Promise<string | null> {
  const root = hmacRoot();
  if (root === null) return null;
  const full: HostcallTokenPayload = {
    org: payload.org,
    connector: payload.connector,
    action: payload.action,
    ...(payload.credentialRef !== undefined && {
      credentialRef: payload.credentialRef,
    }),
    exp: now + HOSTCALL_TOKEN_TTL_MS,
  };
  const payloadB64 = b64urlEncode(utf8(JSON.stringify(full)));
  const message = `${TOKEN_VERSION}.${payloadB64}`;
  const sig = await signMessage(root, message);
  return `${message}.${b64urlEncode(sig)}`;
}

export type HostcallTokenVerdict =
  | { ok: true; payload: HostcallTokenPayload }
  | {
      ok: false;
      reason: 'unconfigured' | 'malformed' | 'bad_signature' | 'expired';
    };

/** Verify a host-call token. Signature is checked BEFORE expiry so the two
 * failure modes are indistinguishable in timing to a forger. */
export async function verifyHostcallToken(
  token: string,
  now: number = Date.now(),
): Promise<HostcallTokenVerdict> {
  const root = hmacRoot();
  if (root === null) return { ok: false, reason: 'unconfigured' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: 'malformed' };
  }
  const [, payloadB64, sigB64] = parts;
  const sigBytes = b64urlDecode(sigB64 ?? '');
  if (sigBytes === null) return { ok: false, reason: 'malformed' };
  const expected = await signMessage(root, `${TOKEN_VERSION}.${payloadB64}`);
  if (!timingSafeEqualBytes(sigBytes, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const payloadBytes = b64urlDecode(payloadB64 ?? '');
  if (payloadBytes === null) return { ok: false, reason: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { org?: unknown }).org !== 'string' ||
    typeof (parsed as { connector?: unknown }).connector !== 'string' ||
    typeof (parsed as { action?: unknown }).action !== 'string' ||
    typeof (parsed as { exp?: unknown }).exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated field-by-field above
  const payload = parsed as HostcallTokenPayload;
  if (payload.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
