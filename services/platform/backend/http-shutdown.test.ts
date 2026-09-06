// @vitest-environment node

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuthEnv } from './auth/session.ts';
import { closeServerGracefully } from './http-shutdown.ts';
import { createEventsHandler, endAllEventStreams } from './realtime/sse.ts';

/**
 * Graceful shutdown must resolve while `/events` SSE clients are connected:
 * `server.close()` waits for every open connection and an SSE response never
 * ends on its own (15s heartbeats; the loop exits only on client abort), so
 * a bare close parked shutdown until the orchestrator's SIGKILL — jobs died
 * mid-write on every deploy with a browser open. These tests drive the REAL
 * server (`serve`) with the REAL events handler over a live socket.
 */

/** Tagged-template `sql` stub routed on query text — the three reads the
 *  events lane performs (membership, outbox tail, hints after cursor). */
function fakeSql(strings: TemplateStringsArray): Promise<unknown[]> {
  const query = strings.join('?');
  if (query.includes('FROM "member"')) {
    return Promise.resolve([
      { id: 'm1', organizationId: 'org1', userId: 'u1', role: 'member' },
    ]);
  }
  if (query.includes('max(id)')) {
    return Promise.resolve([{ max: '0' }]);
  }
  return Promise.resolve([]);
}

interface Harness {
  server: ReturnType<typeof serve>;
  origin: string;
}

const harnesses: Harness[] = [];

function startServer(): Promise<Harness> {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    // requireSession's contract, minus the auth round-trip.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
    c.set('sessionBundle', {
      user: { id: 'u1' },
      session: { id: 's1' },
    } as never);
    await next();
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  app.get('/events', createEventsHandler(fakeSql as never));
  // A non-SSE response that never ends and is NOT in the stream registry —
  // stands in for any long streaming response the registry cannot see.
  app.get('/hang', () => new Response(new ReadableStream<Uint8Array>()));

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      const harness: Harness = {
        server,
        origin: `http://127.0.0.1:${info.port}`,
      };
      harnesses.push(harness);
      resolve(harness);
    });
  });
}

async function openEventStream(origin: string): Promise<Response> {
  const res = await fetch(`${origin}/events?orgId=org1`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  // Belt and braces so one failing test never wedges the runner.
  endAllEventStreams();
  for (const { server } of harnesses.splice(0)) {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

describe('closeServerGracefully', () => {
  it('a bare server.close() parks while an /events stream is open', async () => {
    const { server, origin } = await startServer();
    await openEventStream(origin);

    let closed = false;
    const closePromise = new Promise<void>((resolve) => {
      server.close(() => {
        closed = true;
        resolve();
      });
    });
    await sleep(500);
    // The regression premise: with one SSE client, close never fires.
    expect(closed).toBe(false);

    // Ending the streams is exactly what unblocks it — plus one idle sweep,
    // because close() reaps idle connections only at the moment it is
    // called, and this connection goes idle a tick AFTER the stream ends.
    expect(endAllEventStreams()).toBe(1);
    await sleep(300);
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    await closePromise;
    expect(closed).toBe(true);
  });

  it('resolves with an open /events client, via the graceful path', async () => {
    const { server, origin } = await startServer();
    const res = await openEventStream(origin);

    const startedAt = Date.now();
    await closeServerGracefully(server, { forceAfterMs: 4_000 });
    // Well before the force deadline: the stream registry did the work.
    expect(Date.now() - startedAt).toBeLessThan(3_000);

    // The client observes its stream ending rather than hanging forever.
    const reader = res.body?.getReader();
    if (reader) {
      await expect(
        Promise.race([reader.read(), sleep(2_000).then(() => 'timeout')]),
      ).resolves.not.toBe('timeout');
    }
  });

  it('force-closes connections the registry cannot see at the deadline', async () => {
    const { server, origin } = await startServer();
    const hang = fetch(`${origin}/hang`);
    await hang; // headers received — the response body never ends

    const startedAt = Date.now();
    await closeServerGracefully(server, { forceAfterMs: 300 });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThan(3_000);
  });
});
