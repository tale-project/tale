/**
 * The spawner door the burst watches: `GET /v1/admission`, the verdict an
 * agent session's start would get now and the evidence it was judged on —
 * the host's available memory against the spawner's reserve, its sessions
 * against the limit.
 *
 * The spawner authenticates every request by an HMAC of its method, path,
 * timestamp, nonce and body hash under the shared `SANDBOX_TOKEN`; this is a
 * mirror of that signed-string format, like the platform's session client.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { HttpClient } from '../client/http.ts';
import { withQuery } from '../client/http.ts';

export const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
export const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';
export const NONCE_HEADER = 'x-tale-sandbox-nonce';

export interface SpawnerSignature {
  method: string;
  /** Path and query, exactly as sent. */
  path: string;
  /** Milliseconds since the epoch, in decimal. */
  timestamp: string;
  nonce: string;
  body: string;
  token: string;
}

/** The hex HMAC-SHA256 the spawner expects in `x-tale-sandbox-signature`. */
export function signSpawnerRequest(request: SpawnerSignature): string {
  const bodyHash = createHash('sha256').update(request.body).digest('hex');
  const signed = `${request.method.toUpperCase()}\n${request.path}\n${request.timestamp}\n${request.nonce}\n${bodyHash}`;
  return createHmac('sha256', request.token).update(signed).digest('hex');
}

/**
 * The auth headers of one request. Each call draws a fresh nonce: the
 * spawner's replay cache refuses a signed string it has seen, and two probes
 * of the same door in one millisecond would otherwise sign the same one.
 */
export function spawnerHeaders(
  request: Omit<SpawnerSignature, 'timestamp' | 'nonce'>,
  nowMs: number = Date.now(),
): Record<string, string> {
  const timestamp = String(nowMs);
  const nonce = randomBytes(16).toString('hex');
  return {
    [SIGNATURE_HEADER]: signSpawnerRequest({ ...request, timestamp, nonce }),
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
  };
}

const admissionSchema = z.object({
  verdict: z.enum(['admit', 'hold']),
  reason: z.string().nullable(),
  retryAfterMs: z.number().nullable(),
  observedAtMs: z.number(),
  evidence: z.object({
    memory: z
      .object({
        availableBytes: z.number(),
        reserveBytes: z.number(),
        totalBytes: z.number(),
      })
      .nullable(),
    sessions: z.object({
      running: z.number(),
      starting: z.number(),
      limit: z.number(),
    }),
  }),
});

/** What the burst keeps of one admission answer. */
export interface AdmissionSample {
  verdict: 'admit' | 'hold';
  /** Why it holds (`memory`, `pressure`, `limit`, …); null on an admit. */
  reason: string | null;
  observedAtMs: number;
  /** Null when the spawner could not read the host's memory. */
  memory: {
    availableBytes: number;
    reserveBytes: number;
    totalBytes: number;
  } | null;
  sessions: { running: number; starting: number; limit: number };
}

/** An admission answer's body, or null when it is not one. */
export function parseAdmission(body: unknown): AdmissionSample | null {
  const parsed = admissionSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const { verdict, reason, observedAtMs, evidence } = parsed.data;
  return {
    verdict,
    reason,
    observedAtMs,
    memory: evidence.memory,
    sessions: evidence.sessions,
  };
}

export type AdmissionRead =
  | { ok: true; sample: AdmissionSample }
  | { ok: false; error: string };

/**
 * Ask the spawner what a start for `organizationId` would get now. The
 * spawner signs `pathname + search` as it receives them, so the signed path
 * carries the client's base path and the query.
 */
export async function readAdmission(
  spawner: HttpClient,
  token: string,
  organizationId: string,
): Promise<AdmissionRead> {
  const path = withQuery('/v1/admission', { organizationId, kind: 'start' });
  const basePath = new URL(spawner.baseUrl).pathname.replace(/\/+$/, '');
  const response = await spawner.request({
    method: 'GET',
    path,
    headers: spawnerHeaders({
      method: 'GET',
      path: basePath + path,
      body: '',
      token,
    }),
    name: 'GET /v1/admission',
    timeoutMs: 5_000,
  });
  if (!response.ok) {
    return {
      ok: false,
      error:
        response.status === 0
          ? `no answer (${response.errorKind ?? 'unknown'})`
          : `HTTP ${response.status}`,
    };
  }
  const sample = parseAdmission(response.json());
  return sample === null
    ? { ok: false, error: 'not an admission answer' }
    : { ok: true, sample };
}
