/**
 * Signed capability tokens for staging org-bucket (`s3:`) blobs into sandbox
 * sessions.
 *
 * A session container can only reach Convex through the sandbox-net `convex`
 * alias — it has no route to an org's S3/R2 endpoint, and a presigned bucket
 * URL is a bearer credential that must never enter an untrusted container.
 * So `s3:` workspace files are staged via the `/api/sandbox-blob` httpAction
 * (reachable at `SANDBOX_HTTP_API_BASE_URL`), which verifies one of these
 * tokens, presigns server-side, and streams the bytes through.
 *
 * Token: `v1.<b64url(payload)>.<b64url(hmac)>` where payload is
 * `{ref, org, exp}` and the signature is HMAC-SHA256 over `v1.<b64url(payload)>`
 * with a purpose-derived subkey, so a token grants exactly one blob in one
 * org's bucket for a few minutes — nothing else, and nothing if it leaks
 * after expiry.
 *
 * Key: derived from the deployment HMAC root `WEBDAV_APP_PASSWORD_HMAC_KEY`
 * (itself derived from INSTANCE_SECRET at boot — see lib/webdav/hmac-key.ts;
 * despite the WebDAV-scoped name it is the deployment-wide HMAC secret every
 * install already carries, and reusing it means zero new env plumbing). The
 * subkey is sha256("<root>:sandbox-blob-stage:v1"), so a compromise of one
 * domain's derived key never crosses into the other.
 *
 * Pure Web-Crypto — usable from both the Convex isolate (the httpAction
 * verifier) and node actions (the session-exec signer).
 */

const TOKEN_VERSION = 'v1';
const KEY_DERIVATION_CONTEXT = 'sandbox-blob-stage:v1';
/** Staging URLs are consumed by the daemon within the same exec call; 10
 * minutes absorbs a slow multi-hundred-MB stage without leaving a long-lived
 * bearer lying around in spawner logs. */
export const STAGE_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface StageTokenPayload {
  /** Blob reference — an `s3:<key>` ref (the `_storage` lane has its own
   * capability URLs via `ctx.storage.getUrl`). */
  ref: string;
  /** Better Auth organization id owning the bucket — the presign step
   * re-checks the key belongs to this org's namespace. */
  org: string;
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

/** The deployment HMAC root this module derives its subkey from. `null` when
 * the deployment carries no HMAC root (minimal dev setups) — signing callers
 * fall back to the bounded inline-staging lane, the verifier refuses. */
function hmacRoot(): string | null {
  const raw = process.env.WEBDAV_APP_PASSWORD_HMAC_KEY;
  if (!raw || raw.length < 64) return null;
  return raw;
}

export function stageTokenSigningAvailable(): boolean {
  return hmacRoot() !== null;
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

/** Mint a stage token for one blob. Returns `null` when the deployment has no
 * HMAC root to sign with. `now` is injectable for tests. */
export async function signStageToken(
  payload: { ref: string; org: string },
  now: number = Date.now(),
): Promise<string | null> {
  const root = hmacRoot();
  if (root === null) return null;
  const full: StageTokenPayload = {
    ref: payload.ref,
    org: payload.org,
    exp: now + STAGE_TOKEN_TTL_MS,
  };
  const payloadB64 = b64urlEncode(utf8(JSON.stringify(full)));
  const message = `${TOKEN_VERSION}.${payloadB64}`;
  const sig = await signMessage(root, message);
  return `${message}.${b64urlEncode(sig)}`;
}

export type StageTokenVerdict =
  | { ok: true; payload: StageTokenPayload }
  | {
      ok: false;
      reason: 'unconfigured' | 'malformed' | 'bad_signature' | 'expired';
    };

/** Verify a stage token. Signature is checked BEFORE expiry so the two
 * failure modes are indistinguishable in timing to a forger. */
export async function verifyStageToken(
  token: string,
  now: number = Date.now(),
): Promise<StageTokenVerdict> {
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
    typeof (parsed as { ref?: unknown }).ref !== 'string' ||
    typeof (parsed as { org?: unknown }).org !== 'string' ||
    typeof (parsed as { exp?: unknown }).exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated field-by-field above
  const payload = parsed as StageTokenPayload;
  if (payload.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

/**
 * Build the sandbox-reachable staging URL for an `s3:` blob: the
 * `/api/sandbox-blob` route on the backend origin as seen from INSIDE the
 * sandbox network (`backend-api:3005` by default — under compose the api
 * container is dual-homed onto the sandbox net; in host dev the
 * `backend-relay` socat carries the alias to the host-run backend; override
 * with SANDBOX_HTTP_API_BASE_URL for non-standard topologies). Returns
 * `null` when no HMAC root is configured.
 */
export async function buildSandboxBlobStageUrl(
  ref: string,
  organizationId: string,
): Promise<string | null> {
  const token = await signStageToken({ ref, org: organizationId });
  if (token === null) return null;
  const base = (
    process.env.SANDBOX_HTTP_API_BASE_URL ?? 'http://backend-api:3005'
  ).replace(/\/$/, '');
  return `${base}/api/sandbox-blob?token=${encodeURIComponent(token)}`;
}
