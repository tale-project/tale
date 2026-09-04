// @vitest-environment node

/**
 * Webhook delivery identity — the two lanes the door de-duplicates on. A
 * sender's delivery id names the delivery (a redelivery repeats it, whatever
 * the body); without one, byte-identical bodies are the same delivery for the
 * short window. The requested project is always part of the identity.
 */

import { describe, expect, it } from 'vitest';

import {
  BODY_LANE_WINDOW_MS,
  DELIVERY_ID_HEADERS,
  deliveryIdentity,
  HEADER_LANE_WINDOW_MS,
  MAX_WEBHOOK_BODY_BYTES,
  pickDeliveryId,
  readWebhookBody,
  WEBHOOK_BODY_DRAIN_BYTES,
} from './webhook_delivery.ts';

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text);
const HEX_64 = /^[0-9a-f]{64}$/;

/** A request body streamed in fixed chunks, counting what the reader took. */
function streamOf(
  payload: Uint8Array,
  chunkSize: number,
): {
  body: ReadableStream<Uint8Array>;
  pulled: () => number;
  cancelled: () => boolean;
} {
  let offset = 0;
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= payload.byteLength) {
        controller.close();
        return;
      }
      const next = payload.subarray(offset, offset + chunkSize);
      offset += next.byteLength;
      pulled += next.byteLength;
      controller.enqueue(next);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { body, pulled: () => pulled, cancelled: () => cancelled };
}

describe('readWebhookBody', () => {
  it('assembles a body under the cap from its chunks', async () => {
    const payload = bytes('{"event":"paid","id":"evt_1"}');
    const stream = streamOf(payload, 7);
    const read = await readWebhookBody({
      headers: new Headers(),
      body: stream.body,
    });
    expect(read.ok).toBe(true);
    if (read.ok)
      expect(new TextDecoder().decode(read.bytes)).toBe(
        '{"event":"paid","id":"evt_1"}',
      );
  });

  it('answers an absent body as empty', async () => {
    const read = await readWebhookBody({ headers: new Headers(), body: null });
    expect(read).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });

  it('counts bytes, not code units: 150k two-byte characters are over a 256 KB cap', async () => {
    const payload = bytes(`"${'é'.repeat(150_000)}"`);
    expect(payload.byteLength).toBeGreaterThan(MAX_WEBHOOK_BODY_BYTES);
    const stream = streamOf(payload, 64 * 1024);
    const read = await readWebhookBody({
      headers: new Headers(),
      body: stream.body,
    });
    expect(read).toEqual({ ok: false, reason: 'too_large' });
    // Drained to the end so the sender reads the 413 instead of a reset.
    expect(stream.pulled()).toBe(payload.byteLength);
    expect(stream.cancelled()).toBe(false);
  });

  it('refuses a declared Content-Length over the cap, buffering nothing, and drains it', async () => {
    const payload = new Uint8Array(300 * 1024).fill(0x78);
    const stream = streamOf(payload, 64 * 1024);
    const read = await readWebhookBody({
      headers: new Headers({ 'content-length': String(payload.byteLength) }),
      body: stream.body,
    });
    expect(read).toEqual({ ok: false, reason: 'too_large' });
    expect(stream.pulled()).toBe(payload.byteLength);
  });

  it('stops draining a hostile body at the drain cap and cancels the stream', async () => {
    const payload = new Uint8Array(WEBHOOK_BODY_DRAIN_BYTES * 3).fill(0x78);
    const stream = streamOf(payload, 128 * 1024);
    const read = await readWebhookBody({
      headers: new Headers({ 'content-length': String(payload.byteLength) }),
      body: stream.body,
    });
    expect(read).toEqual({ ok: false, reason: 'too_large' });
    expect(stream.pulled()).toBeGreaterThanOrEqual(WEBHOOK_BODY_DRAIN_BYTES);
    expect(stream.pulled()).toBeLessThan(payload.byteLength);
    expect(stream.cancelled()).toBe(true);
  });

  it('honours custom limits', async () => {
    const payload = bytes('0123456789');
    const under = await readWebhookBody(
      { headers: new Headers(), body: streamOf(payload, 4).body },
      { maxBytes: 10, drainBytes: 40 },
    );
    const over = await readWebhookBody(
      { headers: new Headers(), body: streamOf(payload, 4).body },
      { maxBytes: 9, drainBytes: 40 },
    );
    expect(under.ok).toBe(true);
    expect(over).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('pickDeliveryId', () => {
  it('prefers the generic idempotency key over a vendor id', () => {
    const headers = new Headers({
      'X-GitHub-Delivery': 'gh-1',
      'Idempotency-Key': 'idem-1',
    });
    expect(pickDeliveryId(headers)).toEqual({
      header: 'idempotency-key',
      value: 'idem-1',
    });
  });

  it('reads a vendor delivery id case-insensitively and trims it', () => {
    const headers = new Headers({ 'X-GitHub-Delivery': '  72d3162e-cc78  ' });
    expect(pickDeliveryId(headers)).toEqual({
      header: 'x-github-delivery',
      value: '72d3162e-cc78',
    });
  });

  it('skips a blank id header and falls through to the next', () => {
    const headers = new Headers({
      'Idempotency-Key': '   ',
      'webhook-id': 'msg_2',
    });
    expect(pickDeliveryId(headers)).toEqual({
      header: 'webhook-id',
      value: 'msg_2',
    });
  });

  it('answers null when no delivery id header is present', () => {
    expect(
      pickDeliveryId(new Headers({ 'content-type': 'application/json' })),
    ).toBeNull();
  });

  it('lists every header once, lower-cased', () => {
    expect(new Set(DELIVERY_ID_HEADERS).size).toBe(DELIVERY_ID_HEADERS.length);
    for (const header of DELIVERY_ID_HEADERS) {
      expect(header).toBe(header.toLowerCase());
    }
  });
});

describe('deliveryIdentity', () => {
  it('header lane: the same id is the same delivery whatever the body', async () => {
    const first = await deliveryIdentity({
      headers: new Headers({ 'X-GitHub-Delivery': 'd-1' }),
      body: bytes('{"attempt":1}'),
    });
    const retried = await deliveryIdentity({
      headers: new Headers({ 'x-github-delivery': 'd-1' }),
      body: bytes('{"attempt":2}'),
    });
    const other = await deliveryIdentity({
      headers: new Headers({ 'X-GitHub-Delivery': 'd-2' }),
      body: bytes('{"attempt":1}'),
    });
    expect(first.source).toBe('header:x-github-delivery');
    expect(first.windowMs).toBe(HEADER_LANE_WINDOW_MS);
    expect(first.key).toMatch(HEX_64);
    expect(retried.key).toBe(first.key);
    expect(other.key).not.toBe(first.key);
  });

  it('body lane: identical bytes are one delivery for the short window', async () => {
    const first = await deliveryIdentity({
      headers: new Headers(),
      body: bytes('{"event":"paid","id":"evt_1"}'),
    });
    const retried = await deliveryIdentity({
      headers: new Headers({ 'content-type': 'application/json' }),
      body: bytes('{"event":"paid","id":"evt_1"}'),
    });
    const other = await deliveryIdentity({
      headers: new Headers(),
      body: bytes('{"event":"paid","id":"evt_2"}'),
    });
    expect(first.source).toBe('body');
    expect(first.windowMs).toBe(BODY_LANE_WINDOW_MS);
    expect(first.key).toMatch(HEX_64);
    expect(retried.key).toBe(first.key);
    expect(other.key).not.toBe(first.key);
  });

  it('the requested project is part of the identity in both lanes', async () => {
    const headers = new Headers({ 'Idempotency-Key': 'k-1' });
    const body = bytes('{}');
    const headerA = await deliveryIdentity({ headers, body, projectId: 'p-a' });
    const headerB = await deliveryIdentity({ headers, body, projectId: 'p-b' });
    const headerNone = await deliveryIdentity({ headers, body });
    expect(headerA.key).not.toBe(headerB.key);
    expect(headerA.key).not.toBe(headerNone.key);
    const bodyA = await deliveryIdentity({
      headers: new Headers(),
      body,
      projectId: 'p-a',
    });
    const bodyB = await deliveryIdentity({
      headers: new Headers(),
      body,
      projectId: 'p-b',
    });
    expect(bodyA.key).not.toBe(bodyB.key);
  });

  it('keys stay bounded however large the header value or the body', async () => {
    const hugeHeader = await deliveryIdentity({
      headers: new Headers({ 'Idempotency-Key': 'x'.repeat(8_000) }),
      body: bytes(''),
    });
    const hugeBody = await deliveryIdentity({
      headers: new Headers(),
      body: new Uint8Array(1024 * 1024).fill(0x41),
    });
    expect(hugeHeader.key).toMatch(HEX_64);
    expect(hugeBody.key).toMatch(HEX_64);
  });

  it('the body lane window is short and the header lane window is long', () => {
    expect(BODY_LANE_WINDOW_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(HEADER_LANE_WINDOW_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });
});
