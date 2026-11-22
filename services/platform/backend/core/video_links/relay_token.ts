/**
 * What a sandbox session is given to reach the platform's relays for one
 * video (tale-project/tale#4942).
 *
 * yt-dlp runs in a session, which has no route to a video proxy and holds
 * none of its credentials, and none to the PO-token provider. It reaches
 * both through the API listener, which every session can already reach, and
 * shows one of these tokens: `v1.<b64url(payload)>.<b64url(hmac)>`, signed
 * with a subkey of the deployment's HMAC root, as the sandbox stage tokens
 * are (`core/lib/storage/sandbox_stage_token.ts`). A token names one job and
 * one use: the tunnels of one configured proxy, by a digest of its entry, or
 * the PO-token provider. It expires with the job, and whichever replica
 * serves the listener can check it without having minted it.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const KEY_DERIVATION_CONTEXT = 'video-relay:v1';

/** A job's longest run: `video.ingest` expires after 25 minutes
 * (`jobs/tasks.ts`); a grant outlives it by a little and nothing more. */
export const VIDEO_RELAY_GRANT_TTL_MS = 30 * 60 * 1000;

/** What a token grants. */
export type VideoRelayGrant =
  | {
      /** Tunnels through one configured proxy. */
      use: 'proxy';
      job: string;
      /** {@link videoProxyDigest} of the proxy's entry. */
      proxy: string;
      /** Expiry, epoch ms. */
      exp: number;
    }
  | { use: 'pot'; job: string; exp: number };

/** What names a configured proxy in a grant: a digest of its entry as it is
 * written, so that a grant minted before the proxies were changed names a
 * proxy that is no longer listed, never the one that took its place. */
export function videoProxyDigest(proxyUrl: string): string {
  return createHash('sha256').update(proxyUrl).digest('hex').slice(0, 32);
}

/** The deployment HMAC root (`lib/webdav/hmac-key.ts`); `null` on a minimal
 * development setup that carries none. */
function hmacRoot(env: NodeJS.ProcessEnv): string | null {
  const raw = env.WEBDAV_APP_PASSWORD_HMAC_KEY;
  return raw === undefined || raw.length < 64 ? null : raw;
}

function sign(root: string, message: string): Buffer {
  const key = createHash('sha256')
    .update(`${root}:${KEY_DERIVATION_CONTEXT}`)
    .digest();
  return createHmac('sha256', key).update(message).digest();
}

/** A token for `grant`, or `null` where the deployment has no HMAC root to
 * sign it with. */
export function signVideoRelayToken(
  grant: VideoRelayGrant,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const root = hmacRoot(env);
  if (root === null) return null;
  const body = `v1.${Buffer.from(JSON.stringify(grant)).toString('base64url')}`;
  return `${body}.${sign(root, body).toString('base64url')}`;
}

function isGrant(value: unknown): value is VideoRelayGrant {
  if (typeof value !== 'object' || value === null) return false;
  const use: unknown = Reflect.get(value, 'use');
  const job: unknown = Reflect.get(value, 'job');
  const exp: unknown = Reflect.get(value, 'exp');
  if (typeof job !== 'string' || job === '') return false;
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return false;
  if (use === 'pot') return true;
  const proxy: unknown = Reflect.get(value, 'proxy');
  return (
    use === 'proxy' && typeof proxy === 'string' && /^[0-9a-f]{32}$/.test(proxy)
  );
}

/** The grant a token carries, or `null` for one that is malformed, signed
 * with another key, or expired. The signature is checked before anything of
 * the payload is believed. */
export function verifyVideoRelayToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): VideoRelayGrant | null {
  const root = hmacRoot(env);
  if (root === null) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload = '', signature = ''] = parts;
  const expected = sign(root, `v1.${payload}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (error) {
    // Signed, and still not JSON: only this code signs, so this is a bug
    // here and not a forgery.
    console.warn(
      '[video-relay] a signed token holds no JSON:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  if (!isGrant(parsed) || parsed.exp <= now) return null;
  return parsed;
}
