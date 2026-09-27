import { describe, expect, test } from 'bun:test';

import {
  encodeFrame,
  FRAME,
  INITIAL_WINDOW_BYTES,
  MAX_STREAMS_PER_SIDE,
  TUNNEL_CLOSE,
  TunnelBusyError,
  TunnelClosedError,
  TunnelEndpoint,
  TunnelStreamResetError,
  type ControlFrameType,
  type IncomingStream,
  type TunnelTransport,
} from './tunnel.ts';

/** Two endpoints joined by an in-order, asynchronous in-memory pipe — the
 * shape a WebSocket gives the tunnel, without the socket. */
function tunnelPair(handlers: {
  hub?: (s: IncomingStream) => void;
  device?: (s: IncomingStream) => void;
  hubControl?: (t: ControlFrameType, p: Record<string, unknown>) => void;
  deviceControl?: (t: ControlFrameType, p: Record<string, unknown>) => void;
}) {
  const closes: Array<{ side: string; code: number; reason: string }> = [];
  const pipe = (deliver: () => TunnelEndpoint, side: string) => {
    const queue: Uint8Array[] = [];
    let scheduled = false;
    const transport: TunnelTransport = {
      send(frame) {
        queue.push(frame);
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          const target = deliver();
          for (const f of queue.splice(0)) target.receive(f);
        }, 0);
      },
      bufferedAmount: () => 0,
      close(code, reason) {
        closes.push({ side, code, reason });
        setTimeout(() => deliver().close(new TunnelClosedError(reason)), 0);
      },
    };
    return transport;
  };
  // Each pipe resolves its peer lazily, at first delivery (after both exist).
  const hub: TunnelEndpoint = new TunnelEndpoint(
    'hub',
    pipe(() => device, 'hub'),
    {
      onStream: handlers.hub ?? ((s) => s.reset('unexpected')),
      onControl: handlers.hubControl ?? (() => {}),
    },
  );
  const device: TunnelEndpoint = new TunnelEndpoint(
    'device',
    pipe(() => hub, 'device'),
    {
      onStream: handlers.device ?? ((s) => s.reset('unexpected')),
      onControl: handlers.deviceControl ?? (() => {}),
    },
  );
  return { hub, device, closes };
}

/** The error a promise rejects with (fails the test if it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function bytes(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

/** A device handler that echoes the request body back with the method/path. */
function echo(stream: IncomingStream): void {
  void readAll(stream.body).then((body) => {
    stream.respond(
      {
        status: 200,
        headers: [
          ['x-method', stream.head.method],
          ['x-path', stream.head.path],
        ],
      },
      new Response(body).body,
    );
    return null;
  });
}

describe('TunnelEndpoint', () => {
  test('round-trips a request head, body and response', async () => {
    const { hub } = tunnelPair({ device: echo });
    const res = await hub.request(
      {
        method: 'POST',
        path: '/v1/sessions?x=1',
        headers: [['content-type', 'application/json']],
      },
      '{"hello":"device"}',
    );
    expect(res.status).toBe(200);
    expect(res.headers).toContainEqual(['x-method', 'POST']);
    expect(res.headers).toContainEqual(['x-path', '/v1/sessions?x=1']);
    expect(new TextDecoder().decode(await readAll(res.body))).toBe(
      '{"hello":"device"}',
    );
  });

  test('carries multi-window bodies in both directions byte-exact', async () => {
    const { hub } = tunnelPair({ device: echo });
    const payload = bytes(3 * 1024 * 1024 + 17);
    const res = await hub.request(
      { method: 'PUT', path: '/big', headers: [] },
      payload,
    );
    const back = await readAll(res.body);
    expect(back.byteLength).toBe(payload.byteLength);
    expect(Buffer.compare(back, payload)).toBe(0);
  });

  test('device-opened streams reach the hub handler (relay direction)', async () => {
    const { device } = tunnelPair({
      hub: (s) => {
        expect(s.head.relay).toBe('gateway');
        s.respond({ status: 201, headers: [] }, new Response('ok').body);
      },
    });
    const res = await device.request({
      method: 'GET',
      path: '/openai/v1/models',
      headers: [],
      relay: 'gateway',
    });
    expect(res.status).toBe(201);
    expect(await new Response(res.body).text()).toBe('ok');
  });

  test('a slow consumer holds the producer to the credit window', async () => {
    let pulled = 0;
    const { hub } = tunnelPair({
      device: (s) => {
        const source = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 16 * 1024;
            controller.enqueue(bytes(16 * 1024));
            if (pulled >= 4 * 1024 * 1024) controller.close();
          },
        });
        s.respond({ status: 200, headers: [] }, source);
      },
    });
    const res = await hub.request({
      method: 'GET',
      path: '/stream',
      headers: [],
    });
    // Read nothing for a while: the device may only run ahead by the window
    // (plus the reader's one-chunk lookahead), never by the whole 4 MiB.
    await new Promise((r) => setTimeout(r, 100));
    expect(pulled).toBeLessThanOrEqual(INITIAL_WINDOW_BYTES + 64 * 1024);
    const all = await readAll(res.body);
    expect(all.byteLength).toBe(4 * 1024 * 1024);
  });

  test('a reset before the head rejects the request with its code', async () => {
    const { hub } = tunnelPair({
      device: (s) => s.reset('device_busy', 'at capacity'),
    });
    const err = await hub
      .request({ method: 'POST', path: '/v1/sessions', headers: [] }, '{}')
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TunnelStreamResetError);
    expect(err instanceof TunnelStreamResetError && err.code).toBe(
      'device_busy',
    );
  });

  test("the caller's abort resets the stream and cancels the responder's source", async () => {
    let sourceCancelled = false;
    let responderAborted = false;
    const { hub } = tunnelPair({
      device: (s) => {
        s.signal.addEventListener('abort', () => {
          responderAborted = true;
        });
        const source = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('event: a\n\n'));
          },
          cancel() {
            sourceCancelled = true;
          },
        });
        s.respond({ status: 200, headers: [] }, source);
      },
    });
    const ac = new AbortController();
    const res = await hub.request(
      { method: 'POST', path: '/exec', headers: [] },
      null,
      ac.signal,
    );
    const reader = res.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('event: a\n\n');
    ac.abort();
    expect(await rejection(reader.read())).toBeInstanceOf(
      TunnelStreamResetError,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(responderAborted).toBe(true);
    expect(sourceCancelled).toBe(true);
  });

  test('cancelling the response body resets the responder', async () => {
    let responderAborted = false;
    const { hub, device } = tunnelPair({
      device: (s) => {
        s.signal.addEventListener('abort', () => {
          responderAborted = true;
        });
        s.respond(
          { status: 200, headers: [] },
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new Uint8Array([1]));
            },
          }),
        );
      },
    });
    const res = await hub.request({ method: 'GET', path: '/x', headers: [] });
    await res.body.cancel('client went away');
    await new Promise((r) => setTimeout(r, 20));
    expect(responderAborted).toBe(true);
    expect(hub.streamCount).toBe(0);
    expect(device.streamCount).toBe(0);
  });

  test('closing the tunnel fails pending requests and aborts served streams', async () => {
    let responderSignal: AbortSignal | undefined;
    const { hub, device } = tunnelPair({
      device: (s) => {
        responderSignal = s.signal;
      },
    });
    const pending = hub.request({ method: 'GET', path: '/hang', headers: [] });
    await new Promise((r) => setTimeout(r, 10));
    hub.close(new TunnelClosedError('socket dropped'));
    device.close(new TunnelClosedError('socket dropped'));
    expect(await rejection(pending)).toBeInstanceOf(TunnelClosedError);
    expect(responderSignal?.aborted).toBe(true);
    expect(
      await rejection(
        hub.request({ method: 'GET', path: '/after', headers: [] }),
      ),
    ).toBeInstanceOf(TunnelClosedError);
  });

  test('control frames reach the other side as JSON', async () => {
    const seen: Array<[number, Record<string, unknown>]> = [];
    const { device } = tunnelPair({
      hubControl: (t, p) => seen.push([t, p]),
    });
    device.sendControl(FRAME.HELLO, { protocol: 1, version: '0.5.60' });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([[FRAME.HELLO, { protocol: 1, version: '0.5.60' }]]);
  });

  test('many concurrent streams keep their bodies apart', async () => {
    const { hub } = tunnelPair({ device: echo });
    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        const body = bytes(70_000 + i, i);
        const res = await hub.request(
          { method: 'POST', path: `/s/${i}`, headers: [] },
          body,
        );
        const back = await readAll(res.body);
        return Buffer.compare(back, body) === 0;
      }),
    );
    expect(results.every(Boolean)).toBe(true);
  });

  test('refuses to open more streams than the per-side limit', async () => {
    const { hub } = tunnelPair({ device: () => {} });
    const open = Array.from({ length: MAX_STREAMS_PER_SIDE }, () =>
      hub
        .request({ method: 'GET', path: '/wait', headers: [] })
        .catch(() => null),
    );
    expect(
      await rejection(
        hub.request({ method: 'GET', path: '/one-more', headers: [] }),
      ),
    ).toBeInstanceOf(TunnelBusyError);
    hub.close();
    await Promise.all(open);
  });

  test('an OPEN with the wrong id parity is a protocol error', async () => {
    const { hub, closes } = tunnelPair({});
    // Odd ids belong to the hub; a device may never open one.
    hub.receive(
      encodeFrame(
        FRAME.OPEN,
        3,
        new TextEncoder().encode(
          JSON.stringify({ method: 'GET', path: '/', headers: [] }),
        ),
      ),
    );
    expect(closes).toContainEqual({
      side: 'hub',
      code: TUNNEL_CLOSE.PROTOCOL_ERROR,
      reason: 'stream id out of turn',
    });
    expect(hub.closed).toBe(true);
  });

  test('a sender overrunning the granted window gets its stream reset', async () => {
    let responderError: unknown;
    const { hub } = tunnelPair({
      hub: (s) => {
        readAll(s.body).catch((e: unknown) => {
          responderError = e;
        });
      },
    });
    const open = new TextEncoder().encode(
      JSON.stringify({ method: 'POST', path: '/up', headers: [] }),
    );
    hub.receive(encodeFrame(FRAME.OPEN, 2, open));
    const chunk = bytes(64 * 1024);
    for (let i = 0; i < 5; i++) hub.receive(encodeFrame(FRAME.DATA, 2, chunk));
    await new Promise((r) => setTimeout(r, 10));
    expect(responderError).toBeInstanceOf(TunnelStreamResetError);
    expect(
      responderError instanceof TunnelStreamResetError && responderError.code,
    ).toBe('flow_control');
  });

  test('frames for an unknown stream are dropped, not fatal', () => {
    const { hub } = tunnelPair({});
    hub.receive(encodeFrame(FRAME.DATA, 5, new Uint8Array([1, 2, 3])));
    hub.receive(encodeFrame(FRAME.END, 5));
    expect(hub.closed).toBe(false);
  });

  test('an answer sent before the request body was read retires the stream on both sides', async () => {
    // The responder answers at once and never reads the (multi-window)
    // request body — an upstream refusing before reading a large upload.
    const { hub, device } = tunnelPair({
      hub: (s) =>
        s.respond({ status: 401, headers: [] }, new Response('refused').body),
    });
    const res = await device.request(
      { method: 'POST', path: '/api/tools/upload', headers: [], relay: 'api' },
      bytes(INITIAL_WINDOW_BYTES * 3),
    );
    expect(res.status).toBe(401);
    expect(new TextDecoder().decode(await readAll(res.body))).toBe('refused');
    await new Promise((r) => setTimeout(r, 20));
    expect(device.streamCount).toBe(0);
    expect(hub.streamCount).toBe(0);
    expect(hub.closed || device.closed).toBe(false);
  });

  test('a stalled socket keeps one drain waiter per waiting stream, not one per tick', async () => {
    let buffered = Number.MAX_SAFE_INTEGER;
    const sent: Uint8Array[] = [];
    const endpoint = new TunnelEndpoint(
      'hub',
      {
        send: (frame) => {
          sent.push(frame);
        },
        bufferedAmount: () => buffered,
        close: () => {},
      },
      { onStream: () => {}, onControl: () => {} },
    );
    const pending = endpoint.request(
      { method: 'POST', path: '/v1/sessions/pa-1/exec', headers: [] },
      bytes(1024),
    );
    await new Promise((r) => setTimeout(r, 120));
    // White box: the waiter set is the resource that used to grow per tick.
    const waiters: unknown = Reflect.get(endpoint, 'drainWaiters');
    if (!(waiters instanceof Set)) throw new Error('no drain waiter set');
    expect(waiters.size).toBeLessThanOrEqual(1);
    buffered = 0;
    endpoint.notifyDrained();
    await new Promise((r) => setTimeout(r, 20));
    // The body went out once the socket drained.
    expect(sent.some((f) => f[0] === FRAME.DATA)).toBe(true);
    endpoint.close();
    await rejection(pending);
  });

  test('a frame the transport cannot send closes the socket as well', () => {
    const closes: number[] = [];
    const endpoint = new TunnelEndpoint(
      'hub',
      {
        send: () => {
          throw new Error('socket dropped the frame');
        },
        bufferedAmount: () => 0,
        close: (code) => closes.push(code),
      },
      { onStream: () => {}, onControl: () => {} },
    );
    endpoint.sendControl(FRAME.STATUS_ACK, {});
    expect(endpoint.closed).toBe(true);
    expect(closes).toEqual([TUNNEL_CLOSE.SEND_FAILED]);
  });
});
