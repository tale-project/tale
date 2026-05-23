// Outbound HMAC-signed callbacks from the spawner back to the Convex
// platform. The platform vends presigned upload URLs (EP1) and accepts
// per-file storageId reports (EP2) via these endpoints; the spawner
// reuses the same SANDBOX_TOKEN it accepts inbound requests with (the
// shared secret is bidirectional — see sandbox-wobbly-origami plan §2).
//
// Signature contract (mirrors auth.ts on the inbound side):
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)

import { createHash, createHmac } from 'node:crypto';

import type { UploadFailure } from './types.ts';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

export function signSandboxRequest(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  token: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
  return createHmac('sha256', token).update(signedString).digest('hex');
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

interface CallbackOptions {
  token: string | null;
}

/**
 * Request additional presigned upload URLs from the platform (EP1). Returns
 * the URL strings, or null on quota-exceeded (HTTP 412) / network failure.
 * Caller handles the null by stopping further uploads and recording an
 * `UPLOAD_QUOTA_EXCEEDED` (412) or `UPLOAD_FAILED` (everything else).
 */
export async function requestUploadUrls(
  endpoint: string,
  executionId: string,
  count: number,
  opts: CallbackOptions,
): Promise<
  | { ok: true; urls: string[] }
  | {
      ok: false;
      code: 'QUOTA_EXCEEDED' | 'FAILED';
      status: number;
      snippet: string;
    }
> {
  const body = JSON.stringify({ executionId, count });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.token !== null) {
    const ts = String(Date.now());
    headers[SIGNATURE_HEADER] = signSandboxRequest(
      'POST',
      pathOf(endpoint),
      ts,
      body,
      opts.token,
    );
    headers[TIMESTAMP_HEADER] = ts;
  }
  let res: Response;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body });
  } catch (err) {
    return {
      ok: false,
      code: 'FAILED',
      status: 0,
      snippet: err instanceof Error ? err.message : String(err),
    };
  }
  if (res.status === 412) {
    return { ok: false, code: 'QUOTA_EXCEEDED', status: 412, snippet: '' };
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: false, code: 'FAILED', status: res.status, snippet };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return {
      ok: false,
      code: 'FAILED',
      status: res.status,
      snippet: `EP1 JSON parse: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'FAILED',
      status: res.status,
      snippet: 'EP1 not object',
    };
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.urls)) {
    return {
      ok: false,
      code: 'FAILED',
      status: res.status,
      snippet: 'EP1 urls missing',
    };
  }
  const urls: string[] = [];
  for (const u of p.urls) {
    if (typeof u === 'string') urls.push(u);
  }
  return { ok: true, urls };
}

/**
 * Report a successful per-file upload to the platform (EP2). Returns true
 * on success, false on any HTTP / network failure. Caller logs the failure
 * via `UploadFailure` but does NOT abort the harvest — EP2 is the rollback
 * safety net, not the correctness contract.
 */
export async function reportUploaded(
  endpoint: string,
  executionId: string,
  file: {
    fileName: string;
    storageId: string;
    size: number;
    contentType: string;
  },
  opts: CallbackOptions,
): Promise<{ ok: true } | { ok: false; status: number; snippet: string }> {
  const body = JSON.stringify({
    executionId,
    fileName: file.fileName,
    storageId: file.storageId,
    size: file.size,
    contentType: file.contentType,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.token !== null) {
    const ts = String(Date.now());
    headers[SIGNATURE_HEADER] = signSandboxRequest(
      'POST',
      pathOf(endpoint),
      ts,
      body,
      opts.token,
    );
    headers[TIMESTAMP_HEADER] = ts;
  }
  let res: Response;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      snippet: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: false, status: res.status, snippet };
  }
  return { ok: true };
}

/**
 * POST raw file bytes to a presigned Convex upload URL. The URL is single-
 * use and 1h-TTL; on success the body carries `{storageId}`. Returns the
 * allocated storage id or a structured failure suitable for inclusion in
 * `ExecuteResponse.uploadStats.failures`.
 */
export async function postToUploadSlot(
  url: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
  slotIndex: number,
  fileName: string,
): Promise<
  { ok: true; storageId: string } | { ok: false; failure: UploadFailure }
> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bytes,
    });
  } catch (err) {
    return {
      ok: false,
      failure: {
        slotIndex,
        fileName,
        httpStatus: 0,
        errorSnippet: err instanceof Error ? err.message : String(err),
      },
    };
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    return {
      ok: false,
      failure: {
        slotIndex,
        fileName,
        httpStatus: res.status,
        errorSnippet: snippet,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return {
      ok: false,
      failure: {
        slotIndex,
        fileName,
        httpStatus: res.status,
        errorSnippet: `JSON parse: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: {
        slotIndex,
        fileName,
        httpStatus: res.status,
        errorSnippet: 'upload response not an object',
      },
    };
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const p = parsed as Record<string, unknown>;
  if (typeof p.storageId !== 'string' || p.storageId.length === 0) {
    return {
      ok: false,
      failure: {
        slotIndex,
        fileName,
        httpStatus: res.status,
        errorSnippet: 'upload response missing storageId',
      },
    };
  }
  return { ok: true, storageId: p.storageId };
}
