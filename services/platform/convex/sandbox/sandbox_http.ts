// HTTP callback endpoints the sandbox spawner uses to negotiate
// presigned upload URLs and report each successful storage write.
//
// Routes (registered in `convex/http.ts`, proxied through Caddy
// `handle /api/sandbox/*` → convex:3211):
//
//   EP1: POST /api/sandbox/output_upload_url
//     Body:   {executionId: string, count: number}
//     200:    {urls: string[], remainingQuota: number}
//     412:    {code: "QUOTA_EXCEEDED"}            — per-run quota exhausted
//     401:    {error: "unauthorized"}             — HMAC verify failed
//     400:    {error: "bad_request", ...}
//
//   EP2: POST /api/sandbox/record_uploaded
//     Body:   {executionId, fileName, storageId, size, contentType}
//     200:    {ok: true}
//     401/400 as above.
//
// HMAC contract (mirrors services/sandbox/src/auth.ts):
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)
// Both sides share the same SANDBOX_TOKEN so we don't introduce a new
// secret-management surface (see plan §2).

// Web Crypto API (V8 runtime, no `'use node'` directive needed). The
// spawner-side mirror in services/sandbox/src/sandbox-callback.ts uses
// node:crypto, but the produced hex digests are byte-identical so the
// two sides interoperate. Using Web Crypto here keeps the httpAction in
// the fast V8 isolate path instead of paying Node-runtime cold-start
// overhead per upload-slot RPC.
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { toSandboxStorageUrl } from '../lib/helpers/public_storage_url';
import { toId } from '../lib/type_cast_helpers';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';
// Matches the spawner-side window in services/sandbox/src/auth.ts:29.
// Keeping the two sides symmetric simplifies the threat model (replay
// surface is the same in either direction) and 30s is enough for any
// realistic Convex action latency + Caddy hop.
const TIMESTAMP_TOLERANCE_MS = 30_000;

// Nonce cache mirrors services/sandbox/src/auth.ts:36-52 — bounds the
// replay window even within the skew tolerance. Module-level state lives
// for the lifetime of the V8 isolate; on isolate recycle the cache
// resets, but the spawner-side cache is authoritative for the
// Convex→spawner direction anyway. This is defense-in-depth on the
// spawner→Convex direction (EP1 quota drain / EP2 storageId planting).
const NONCE_TTL_MS = TIMESTAMP_TOLERANCE_MS + 5_000;
const NONCE_SWEEP_INTERVAL = 100;
const seenSignatures = new Map<string, number>();
let verifyCallsSinceSweep = 0;

function maybeSweepNonces(now: number): void {
  verifyCallsSinceSweep += 1;
  if (verifyCallsSinceSweep < NONCE_SWEEP_INTERVAL) return;
  verifyCallsSinceSweep = 0;
  for (const [sig, expiresAt] of seenSignatures) {
    if (expiresAt <= now) seenSignatures.delete(sig);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < arr.length; i += 1) {
    out += arr[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(digest);
}

async function hmacSha256Hex(token: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(token),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(sig);
}

/**
 * Constant-time hex-string equality. Mirrors `crypto.timingSafeEqual`
 * (Node) but works in V8 runtime where that API isn't exposed. Both
 * strings must already be lower-case hex of the same length; the
 * length pre-check is non-secret (the signature header length is
 * attacker-controlled anyway, so leaking it via short-circuit is fine).
 */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

async function verifyHmac(
  method: string,
  path: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  token: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (Math.abs(nowMs - ts) > TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, reason: 'timestamp_skew' };
  }
  const bodyHash = await sha256Hex(body);
  const signedString = `${method.toUpperCase()}\n${path}\n${timestampHeader}\n${bodyHash}`;
  const expected = await hmacSha256Hex(token, signedString);
  if (!timingSafeHexEqual(expected, signatureHeader)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Signature is structurally valid AND within the skew window. Check
  // the nonce cache to block replay-within-window.
  maybeSweepNonces(nowMs);
  const cached = seenSignatures.get(signatureHeader);
  if (cached !== undefined && cached > nowMs) {
    return { ok: false, reason: 'replay' };
  }
  seenSignatures.set(signatureHeader, nowMs + NONCE_TTL_MS);
  return { ok: true };
}

function getSandboxToken(): string | null {
  const token = process.env.SANDBOX_TOKEN;
  return token && token.length > 0 ? token : null;
}

async function readBody(req: Request): Promise<string> {
  return req.text();
}

function parsePathFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    // Fallback for malformed Request.url — shouldn't happen but defend
    // against it so we don't 500 in the auth path.
    return rawUrl;
  }
}

/**
 * EP1: presigned-URL upload-slot vendor.
 *
 * Spawner asks for `count` additional upload URLs. We consume `granted` of
 * those from the per-run quota counter (atomic mutation), then call
 * `ctx.storage.generateUploadUrl()` `granted` times, rewriting each URL
 * through `toSandboxStorageUrl()` so the spawner can POST through the
 * internal Caddy alias. Returns 412 + QUOTA_EXCEEDED when the run has hit
 * its per-run output-file cap (`SANDBOX_MAX_OUTPUT_FILES_PER_RUN`).
 */
export const outputUploadUrlAction = httpAction(async (ctx, req) => {
  const path = parsePathFromUrl(req.url);
  const body = await readBody(req);

  const token = getSandboxToken();
  if (token !== null) {
    const verifyResult = await verifyHmac(
      req.method,
      path,
      body,
      req.headers.get(SIGNATURE_HEADER),
      req.headers.get(TIMESTAMP_HEADER),
      token,
    );
    if (!verifyResult.ok) {
      // Log the discriminator server-side; surface only "unauthorized"
      // so an attacker can't probe the failure mode.
      console.warn(`[sandbox_http.EP1] unauthorized (${verifyResult.reason})`);
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonResponse(
      { error: 'bad_request', message: 'body must be an object' },
      400,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above
  const b = parsed as Record<string, unknown>;
  if (typeof b.executionId !== 'string' || b.executionId.length === 0) {
    return jsonResponse(
      { error: 'bad_request', message: 'executionId required' },
      400,
    );
  }
  if (
    typeof b.count !== 'number' ||
    !Number.isFinite(b.count) ||
    b.count <= 0 ||
    b.count > 16
  ) {
    return jsonResponse(
      { error: 'bad_request', message: 'count must be 1..16' },
      400,
    );
  }

  const executionId = toId<'sandboxExecutions'>(b.executionId);
  const { granted, remaining } = await ctx.runMutation(
    internal.sandbox.internal_mutations.applyConsumeUrlQuota,
    { executionId, count: b.count },
  );
  if (granted === 0) {
    return jsonResponse(
      { code: 'QUOTA_EXCEEDED', remainingQuota: remaining },
      412,
    );
  }
  const urls: string[] = [];
  for (let i = 0; i < granted; i += 1) {
    const raw = await ctx.storage.generateUploadUrl();
    urls.push(toSandboxStorageUrl(raw));
  }
  return jsonResponse({ urls, remainingQuota: remaining }, 200);
});

/**
 * EP2: incremental storageId report-back.
 *
 * The spawner POSTs here after each successful presigned-URL upload so the
 * audit row's `uploadedStorageIds` rollback set tracks the live blob set
 * before the SSE result event finalizes the run. Without this, a spawner
 * crash mid-harvest would orphan the already-uploaded blobs (see plan §3).
 */
export const recordUploadedAction = httpAction(async (ctx, req) => {
  const path = parsePathFromUrl(req.url);
  const body = await readBody(req);

  const token = getSandboxToken();
  if (token !== null) {
    const verifyResult = await verifyHmac(
      req.method,
      path,
      body,
      req.headers.get(SIGNATURE_HEADER),
      req.headers.get(TIMESTAMP_HEADER),
      token,
    );
    if (!verifyResult.ok) {
      console.warn(`[sandbox_http.EP2] unauthorized (${verifyResult.reason})`);
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonResponse(
      { error: 'bad_request', message: 'body must be an object' },
      400,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above
  const b = parsed as Record<string, unknown>;
  if (typeof b.executionId !== 'string' || b.executionId.length === 0) {
    return jsonResponse(
      { error: 'bad_request', message: 'executionId required' },
      400,
    );
  }
  if (typeof b.fileName !== 'string' || b.fileName.length === 0) {
    return jsonResponse(
      { error: 'bad_request', message: 'fileName required' },
      400,
    );
  }
  if (typeof b.storageId !== 'string' || b.storageId.length === 0) {
    return jsonResponse(
      { error: 'bad_request', message: 'storageId required' },
      400,
    );
  }
  if (typeof b.size !== 'number' || !Number.isFinite(b.size) || b.size < 0) {
    return jsonResponse(
      { error: 'bad_request', message: 'size required' },
      400,
    );
  }
  if (typeof b.contentType !== 'string') {
    return jsonResponse(
      { error: 'bad_request', message: 'contentType required' },
      400,
    );
  }

  // Pass executionId as a raw string — the mutation `normalizeId`s it so an
  // unaudited infra run (synthetic id) no-ops rather than 500-ing the harvest.
  const storageId = toId<'_storage'>(b.storageId);
  await ctx.runMutation(
    internal.sandbox.internal_mutations.applyRecordUploaded,
    {
      executionId: b.executionId,
      fileName: b.fileName,
      storageId,
      size: b.size,
      contentType: b.contentType,
    },
  );
  return jsonResponse({ ok: true }, 200);
});
