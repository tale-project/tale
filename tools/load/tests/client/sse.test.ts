import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ServerResponse } from 'node:http';

import { createAgent } from '../../src/client/http.ts';
import { fullJitterDelay, openEventStream } from '../../src/client/sse.ts';
import type { ReconnectInfo, StreamEvent } from '../../src/client/sse.ts';
import { MetricsRegistry } from '../../src/metrics/registry.ts';
import { sleep, startServer } from './test-server.ts';
import type { TestServer } from './test-server.ts';

const agent = createAgent();
let server: TestServer;
let resumeConnections = 0;

function openStream(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  response.flushHeaders();
}

beforeAll(async () => {
  server = await startServer((request, response) => {
    const path = request.url.split('?')[0];
    switch (path) {
      case '/events/basic':
        openStream(response);
        response.write(': connected\n\n');
        response.write(
          'id: 1\nevent: hint\ndata: {"entity":"task","entityId":"t1"}\n\n',
        );
        response.write('data: line one\ndata: line two\n\n');
        // An event split across writes still parses as one.
        response.write('id: 2\nevent: heart');
        response.write('beat\ndata: {}\n\n');
        return;
      case '/events/resume':
        resumeConnections += 1;
        openStream(response);
        if (resumeConnections === 1) {
          response.write('id: 7\nevent: hint\ndata: first\n\n');
          response.end();
        } else {
          response.write('id: 8\nevent: hint\ndata: second\n\n');
        }
        return;
      case '/events/forbidden':
        openStream(response);
        response.write('event: forbidden\ndata: {"reason":"removed"}\n\n');
        return;
      case '/events/unauthorized':
        response.statusCode = 401;
        response.end('{"code":"UNAUTHENTICATED"}');
        return;
      case '/events/unavailable':
        response.statusCode = 503;
        response.end('try later');
        return;
      case '/events/html':
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html>');
        return;
      case '/events/retry':
        openStream(response);
        response.write('retry: 20\nid: r1\nevent: hint\ndata: x\n\n');
        response.end();
        return;
      case '/events/silent':
        openStream(response);
        return;
      default:
        response.statusCode = 500;
        response.end();
    }
  });
});

afterAll(async () => {
  await server.close();
  await agent.destroy();
});

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await sleep(5);
  }
}

function hits(path: string): number {
  return server.requests.filter((request) => request.url.startsWith(path))
    .length;
}

/** Feeds a fixed sequence, then repeats the last value. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('openEventStream', () => {
  test('parses events, ids and multi-line data, and records metrics', async () => {
    const metrics = new MetricsRegistry();
    const events: StreamEvent[] = [];
    let opened = 0;
    const closes: [string, boolean][] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/basic?orgId=org_1`,
      headers: { cookie: 'better-auth.session_token=t.s' },
      metrics,
      name: 'sse.events',
      onEvent: (event) => events.push(event),
      onOpen: () => {
        opened += 1;
      },
      onClose: (reason, info) => closes.push([reason, info.willReconnect]),
    });
    await waitFor(() => events.length === 3);
    expect(events).toEqual([
      { id: '1', event: 'hint', data: '{"entity":"task","entityId":"t1"}' },
      { id: undefined, event: 'message', data: 'line one\nline two' },
      { id: '2', event: 'heartbeat', data: '{}' },
    ]);
    expect(handle.isOpen()).toBe(true);
    expect(handle.lastEventId()).toBe('2');
    expect(opened).toBe(1);
    expect(metrics.gaugeValue('sse.events.open')).toEqual({
      current: 1,
      max: 1,
    });
    const sent = server.requests.find((r) => r.url.startsWith('/events/basic'));
    expect(sent?.url).toBe('/events/basic?orgId=org_1');
    expect(sent?.headers.accept).toBe('text/event-stream');
    expect(sent?.headers.cookie).toBe('better-auth.session_token=t.s');
    expect(sent?.headers['last-event-id']).toBeUndefined();

    handle.close();
    expect(await handle.done).toBe('closed');
    expect(handle.isOpen()).toBe(false);
    expect(closes).toEqual([['closed', false]]);
    expect(metrics.counterValue('sse.events.events')).toBe(3);
    expect(metrics.gaugeValue('sse.events.open')?.current).toBe(0);
    expect(metrics.histogram('sse.events.connect')?.count).toBe(1);
    expect(metrics.snapshot().statuses['sse.events.connect']).toEqual({
      '200': 1,
    });
    expect(metrics.totals().errors).toBe(0);
  });

  test('resends Last-Event-ID when it reconnects', async () => {
    const metrics = new MetricsRegistry();
    const events: string[] = [];
    const closes: [string, boolean][] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/resume`,
      metrics,
      name: 'sse.events',
      lastEventId: '3',
      reconnect: { baseMs: 5 },
      random: () => 0,
      onEvent: (event) => events.push(event.data),
      onClose: (reason, info) => closes.push([reason, info.willReconnect]),
    });
    await waitFor(() => events.length === 2);
    const seen = server.requests.filter((r) => r.url === '/events/resume');
    expect(seen.map((r) => r.headers['last-event-id'])).toEqual(['3', '7']);
    expect(events).toEqual(['first', 'second']);
    expect(handle.reconnects()).toBe(1);
    expect(handle.lastEventId()).toBe('8');
    expect(metrics.counterValue('sse.events.reconnects')).toBe(1);
    handle.close();
    expect(await handle.done).toBe('closed');
    expect(closes).toEqual([
      ['ended', true],
      ['closed', false],
    ]);
  });

  test('a forbidden event stops the stream for good', async () => {
    const metrics = new MetricsRegistry();
    const events: string[] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/forbidden`,
      metrics,
      name: 'sse.events',
      reconnect: { baseMs: 1 },
      random: () => 0,
      onEvent: (event) => events.push(event.event),
    });
    expect(await handle.done).toBe('event_forbidden');
    await sleep(30);
    expect(hits('/events/forbidden')).toBe(1);
    expect(events).toEqual(['forbidden']);
    expect(handle.reconnects()).toBe(0);
    expect(metrics.errorCount('sse.events', 'event_forbidden')).toBe(1);
  });

  test('a 401 stops reconnecting and records the refusal', async () => {
    const metrics = new MetricsRegistry();
    const closes: [string, boolean][] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/unauthorized`,
      metrics,
      name: 'sse.events',
      reconnect: { baseMs: 1 },
      random: () => 0,
      onEvent: () => undefined,
      onClose: (reason, info) => closes.push([reason, info.willReconnect]),
    });
    expect(await handle.done).toBe('refused_401');
    await sleep(30);
    expect(hits('/events/unauthorized')).toBe(1);
    expect(closes).toEqual([['refused_401', false]]);
    const error = metrics.snapshot().errors['sse.events.connect'].http_401;
    expect(error.count).toBe(1);
    expect(error.samples[0]).toContain('UNAUTHENTICATED');
  });

  test('backoff delays follow full jitter within their bounds', async () => {
    const metrics = new MetricsRegistry();
    const reconnects: ReconnectInfo[] = [];
    const randoms = [0.5, 0.25, 0.9, 0.1, 0.999];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/unavailable`,
      metrics,
      name: 'sse.events',
      reconnect: { baseMs: 8, maxMs: 40 },
      random: sequence(randoms),
      onEvent: () => undefined,
      onReconnect: (info) => {
        reconnects.push(info);
        if (reconnects.length === 5) {
          handle.close();
        }
      },
    });
    expect(await handle.done).toBe('closed');
    const ceilings = [8, 16, 32, 40, 40];
    expect(reconnects.map((info) => info.attempt)).toEqual([1, 2, 3, 4, 5]);
    expect(reconnects.map((info) => info.delayMs)).toEqual(
      ceilings.map((ceiling, i) => Math.floor(randoms[i] * ceiling)),
    );
    for (const [i, info] of reconnects.entries()) {
      expect(info.delayMs).toBeGreaterThanOrEqual(0);
      expect(info.delayMs).toBeLessThan(ceilings[i]);
      expect(info.reason).toBe('http_503');
    }
    expect(metrics.errorCount('sse.events.connect', 'http_503')).toBe(5);
  });

  test('a non-event-stream 200 is an error, retried rather than parsed', async () => {
    const metrics = new MetricsRegistry();
    const reasons: string[] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/html`,
      metrics,
      name: 'sse.events',
      reconnect: { baseMs: 1 },
      random: () => 0,
      onEvent: () => undefined,
      onReconnect: (info) => {
        reasons.push(info.reason);
        handle.close();
      },
    });
    expect(await handle.done).toBe('closed');
    expect(reasons).toEqual(['sse_content_type']);
    expect(metrics.errorCount('sse.events.connect', 'sse_content_type')).toBe(
      1,
    );
  });

  test("the server's retry field sets the backoff base", async () => {
    const reconnects: ReconnectInfo[] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/retry`,
      metrics: new MetricsRegistry(),
      name: 'sse.events',
      random: () => 0.999,
      onEvent: () => undefined,
      onReconnect: (info) => {
        reconnects.push(info);
        handle.close();
      },
    });
    expect(await handle.done).toBe('closed');
    // A healthy stream comes back after exactly the server's `retry:`, as a
    // browser's EventSource does (the default would be 3 s).
    expect(reconnects).toEqual([{ attempt: 1, delayMs: 20, reason: 'ended' }]);
  });

  test('a silent stream trips the idle watchdog and reconnects', async () => {
    const metrics = new MetricsRegistry();
    const reasons: string[] = [];
    const handle = openEventStream({
      agent,
      url: `${server.url}/events/silent`,
      metrics,
      name: 'sse.events',
      idleTimeoutMs: 60,
      random: () => 0,
      onEvent: () => undefined,
      onReconnect: (info) => {
        reasons.push(info.reason);
        handle.close();
      },
    });
    expect(await handle.done).toBe('closed');
    expect(reasons).toEqual(['idle_timeout']);
    expect(metrics.errorCount('sse.events', 'idle_timeout')).toBe(1);
    expect(metrics.gaugeValue('sse.events.open')?.current).toBe(0);
  });
});

describe('fullJitterDelay', () => {
  test('stays within [0, min(max, base * 2^attempt))', () => {
    expect(fullJitterDelay(0, 1_000, 60_000, () => 0)).toBe(0);
    expect(fullJitterDelay(0, 1_000, 60_000, () => 0.5)).toBe(500);
    expect(fullJitterDelay(3, 1_000, 60_000, () => 0.999_999)).toBe(7_999);
    expect(fullJitterDelay(10, 1_000, 60_000, () => 0.999_999)).toBe(59_999);
    expect(fullJitterDelay(500, 1_000, 60_000, () => 0.5)).toBe(30_000);
  });
});
