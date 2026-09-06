import { sha256Hex } from './webhook_token.ts';

/**
 * Webhook DELIVERY identity — what makes a redelivery recognisable.
 *
 * Vendors deliver at-least-once: a slow response, a dropped connection, or an
 * operator's "redeliver" button sends the same delivery again, and the door
 * used to start a fresh live run per POST. This module derives the identity
 * of one delivery so the door can answer a repeat with the run it already
 * started. Two lanes:
 *
 *  - the HEADER lane — the sender named the delivery (`Idempotency-Key`, the
 *    Standard Webhooks `webhook-id`, GitHub's `X-GitHub-Delivery`, …). An
 *    explicit id is an unambiguous statement of identity — a redelivery
 *    carries the same one — so it is remembered for a day;
 *  - the BODY lane — no id header: the SHA-256 of the raw bytes. Two
 *    byte-identical bodies inside a short window are one delivery retried
 *    (retry-on-timeout fires within seconds); after the window they are two
 *    deliveries again, so a heartbeat posting the same body every few minutes
 *    keeps working.
 *
 * The key material always includes the requested project: the same payload
 * aimed at two projects is two deliveries. Keys are opaque digests, so their
 * size is bounded whatever the sender put in the header or the body.
 */

/** The body cap: a webhook takes a payload, not an upload. Counted in BYTES. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * How much of an over-cap body the door still reads (and discards) before it
 * answers 413. Enough that a vendor's merely-oversize payload finishes its
 * upload and reads a clean 413 — a connection closed mid-upload reads as a
 * network error on their side and gets retried forever; little enough that a
 * hostile multi-gigabyte Content-Length costs one megabyte of reading and a
 * closed connection, never memory.
 */
export const WEBHOOK_BODY_DRAIN_BYTES = 4 * MAX_WEBHOOK_BODY_BYTES;

export type WebhookBody =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: 'too_large' };

/**
 * Read a delivery's body under the cap, in bytes, as it streams: a declared
 * Content-Length over the cap is refused before a byte is buffered, a body
 * that grows past the cap is refused where it crosses it, and nothing beyond
 * the cap is ever held in memory. A refused body is drained up to
 * {@link WEBHOOK_BODY_DRAIN_BYTES} so the sender gets the 413, then cancelled.
 */
export async function readWebhookBody(
  request: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  limits: { maxBytes: number; drainBytes: number } = {
    maxBytes: MAX_WEBHOOK_BODY_BYTES,
    drainBytes: WEBHOOK_BODY_DRAIN_BYTES,
  },
): Promise<WebhookBody> {
  if (request.body === null) {
    return { ok: true, bytes: new Uint8Array(0) };
  }
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  let tooLarge = Number.isFinite(declared) && declared > limits.maxBytes;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exhausted = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      exhausted = true;
      break;
    }
    total += value.byteLength;
    if (!tooLarge && total > limits.maxBytes) {
      tooLarge = true;
      chunks.length = 0;
    }
    if (tooLarge) {
      if (total >= limits.drainBytes) break;
      continue;
    }
    chunks.push(value);
  }
  if (tooLarge) {
    if (!exhausted) {
      try {
        await reader.cancel();
      } catch (error) {
        console.warn(
          '[automations] webhook body cancel after the drain cap failed',
          error instanceof Error ? error.message : error,
        );
      }
    }
    return { ok: false, reason: 'too_large' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Delivery-id headers, in precedence order — the generic idempotency keys
 * first, then the vendors that name their deliveries. Lower-case; `Headers`
 * lookups are case-insensitive anyway.
 */
export const DELIVERY_ID_HEADERS = [
  // The generic idempotency key (IETF draft; what API clients send).
  'idempotency-key',
  'x-idempotency-key',
  // Standard Webhooks (Svix and everything built on it).
  'webhook-id',
  // GitHub — a redelivery from the UI keeps the GUID.
  'x-github-delivery',
  // GitLab.
  'x-gitlab-event-uuid',
  // Shopify.
  'x-shopify-webhook-id',
  // Linear.
  'linear-delivery',
  // Jira / Confluence Cloud.
  'x-atlassian-webhook-identifier',
  // Bitbucket Cloud — the same UUID across attempts (X-Attempt-Number counts).
  'x-request-uuid',
  // Twilio.
  'i-twilio-idempotency-token',
  // The plain convention.
  'x-webhook-id',
] as const;

/** An explicit delivery id is remembered for a day. */
export const HEADER_LANE_WINDOW_MS = 24 * 60 * 60_000;

/** A byte-identical body reads as a retry for two minutes. */
export const BODY_LANE_WINDOW_MS = 2 * 60_000;

export interface DeliveryIdentity {
  /** Which lane produced the key: `header:<header-name>` or `body`. */
  source: string;
  /** Opaque, bounded: hex SHA-256 over lane + delivery material + project. */
  key: string;
  /** How long a repeat of this identity reads as the same delivery. */
  windowMs: number;
}

/** The first delivery-id header present with a non-blank value, if any. */
export function pickDeliveryId(
  headers: Headers,
): { header: string; value: string } | null {
  for (const header of DELIVERY_ID_HEADERS) {
    const value = headers.get(header)?.trim() ?? '';
    if (value !== '') return { header, value };
  }
  return null;
}

/** Derive the identity of one delivery to one trigger. */
export async function deliveryIdentity(args: {
  headers: Headers;
  body: Uint8Array<ArrayBuffer>;
  projectId?: string;
}): Promise<DeliveryIdentity> {
  const project = args.projectId ?? '';
  const explicit = pickDeliveryId(args.headers);
  if (explicit !== null) {
    return {
      source: `header:${explicit.header}`,
      key: await sha256Hex(
        `header:${explicit.header}\n${explicit.value}\n${project}`,
      ),
      windowMs: HEADER_LANE_WINDOW_MS,
    };
  }
  const bodyHash = await sha256Hex(args.body);
  return {
    source: 'body',
    key: await sha256Hex(`body\n${bodyHash}\n${project}`),
    windowMs: BODY_LANE_WINDOW_MS,
  };
}
