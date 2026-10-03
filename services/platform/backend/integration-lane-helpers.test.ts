import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AuthEnv } from './auth/session';
import { closeServerGracefully } from './http-shutdown';
import {
  connectSse,
  everyLaneRequired,
  fullCoverageBlockers,
  isSkippedCheck,
  itestObjectStore,
  recordSkip,
  requestedLanes,
  settleTeardown,
} from './integration-lane-helpers';
import { createEventsHandler } from './realtime/sse';

const store = {
  ITEST_S3_ENDPOINT: 'http://127.0.0.1:9000',
  ITEST_S3_ACCESS_KEY: 'itest-key',
  ITEST_S3_SECRET_KEY: 'itest-secret',
};

function recorder() {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  return {
    checks,
    record: (name: string, ok: boolean, detail: string) => {
      checks.push({ name, ok, detail });
    },
  };
}

describe('everyLaneRequired', () => {
  it('holds only for ITEST_REQUIRE_ALL_LANES=1', () => {
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: '1' })).toBe(true);
    expect(everyLaneRequired({})).toBe(false);
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: 'true' })).toBe(false);
    expect(everyLaneRequired({ ITEST_REQUIRE_ALL_LANES: '0' })).toBe(false);
  });
});

describe('requestedLanes', () => {
  it('names the lanes of a filtered run, trimmed', () => {
    expect(requestedLanes({ ITEST_LANES: ' checkFiles, checkChat,,' })).toEqual(
      new Set(['checkFiles', 'checkChat']),
    );
  });

  it('is null for the full run', () => {
    expect(requestedLanes({})).toBeNull();
    expect(requestedLanes({ ITEST_LANES: '  ' })).toBeNull();
  });
});

describe('itestObjectStore', () => {
  it('reads the endpoint and both credentials', () => {
    expect(itestObjectStore(store)).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      accessKeyId: 'itest-key',
      secretAccessKey: 'itest-secret',
    });
  });

  it("falls back to MinIO's credentials when only the endpoint is set", () => {
    expect(
      itestObjectStore({ ITEST_S3_ENDPOINT: 'http://127.0.0.1:9000' }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    });
  });

  it('is null without an endpoint', () => {
    expect(itestObjectStore({})).toBeNull();
    expect(itestObjectStore({ ...store, ITEST_S3_ENDPOINT: ' ' })).toBeNull();
  });
});

describe('fullCoverageBlockers', () => {
  const required = { ...store, ITEST_REQUIRE_ALL_LANES: '1' };

  it('judges nothing unless every lane is required', () => {
    expect(fullCoverageBlockers({ ITEST_LANES: 'checkFiles' })).toEqual([]);
  });

  it('lets a full run with an object store start', () => {
    expect(fullCoverageBlockers(required)).toEqual([]);
  });

  it('refuses a lane filter, naming the lanes it keeps', () => {
    expect(
      fullCoverageBlockers({
        ...required,
        ITEST_LANES: 'checkFiles,checkChat',
      }),
    ).toEqual(['ITEST_LANES runs only checkFiles, checkChat, not every lane']);
  });

  it('refuses a run missing any object-store variable', () => {
    expect(
      fullCoverageBlockers({ ITEST_REQUIRE_ALL_LANES: '1' }).map(
        (blocker) => blocker.split(' ')[0],
      ),
    ).toEqual([
      'ITEST_S3_ENDPOINT',
      'ITEST_S3_ACCESS_KEY',
      'ITEST_S3_SECRET_KEY',
    ]);
    expect(
      fullCoverageBlockers({ ...required, ITEST_S3_SECRET_KEY: '' }),
    ).toEqual([
      "ITEST_S3_SECRET_KEY is unset, so the blob lanes would sign with MinIO's default credentials",
    ]);
  });
});

describe('recordSkip', () => {
  it('reports a visible skip that passes in a local run', () => {
    const { checks, record } = recorder();
    recordSkip(record, 'files upload', 'no ITEST_S3_ENDPOINT', {});
    expect(checks).toEqual([
      {
        name: 'files upload (SKIPPED)',
        ok: true,
        detail: 'no ITEST_S3_ENDPOINT',
      },
    ]);
    expect(isSkippedCheck(checks[0]?.name ?? '')).toBe(true);
  });

  it('fails the check when every lane is required', () => {
    const { checks, record } = recorder();
    recordSkip(record, 'files upload', 'no ITEST_S3_ENDPOINT', {
      ITEST_REQUIRE_ALL_LANES: '1',
    });
    expect(checks).toEqual([
      {
        name: 'files upload',
        ok: false,
        detail:
          'DID NOT RUN: no ITEST_S3_ENDPOINT (ITEST_REQUIRE_ALL_LANES=1 needs every lane to run)',
      },
    ]);
    expect(isSkippedCheck(checks[0]?.name ?? '')).toBe(false);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One SSE frame as the server writes it. */
const frame = (event: string, data: string): Uint8Array =>
  new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);

describe('connectSse', () => {
  it('ends a tail whose abort never reaches its connection', async () => {
    // The harness boundary after a collection (#4112): fetch answered, the
    // abort went nowhere, and the body never ends on its own.
    let cancelled = false;
    const deafFetch = (): Promise<Response> =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(frame('hint', '{}'));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      );
    const tail = connectSse(
      'http://127.0.0.1:9/events?orgId=o1',
      {},
      { fetch: deafFetch },
    );
    while (tail.events.length === 0) await sleep(5);

    await tail.close();
    expect(cancelled).toBe(true);
    expect(tail.events).toEqual([{ event: 'hint', id: null, data: '{}' }]);
  });

  it('fails a close it cannot finish within the bound, naming the tail', async () => {
    // A connection that never answers and ignores its abort.
    const silentFetch = (): Promise<Response> =>
      new Promise<Response>(() => undefined);
    const tail = connectSse(
      'http://127.0.0.1:9/events?orgId=o1',
      {},
      { fetch: silentFetch, closeWithinMs: 50 },
    );

    await expect(tail.close()).rejects.toThrow(
      'closing the SSE tail /events?orgId=o1 did not settle within 0.05 s',
    );
  });

  it('names a tail whose stream breaks before it is closed, leaving no rejection unhandled', async () => {
    // The backend drops the connection while the lane awaits something
    // else. Unhandled, that rejection ended the whole harness: no lane
    // named, no tally.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const breakingFetch = (): Promise<Response> =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(frame('hint', '{}'));
                setTimeout(() => {
                  controller.error(new TypeError('terminated'));
                }, 10);
              },
            }),
          ),
        );
      const tail = connectSse(
        'http://127.0.0.1:9/events?orgId=o1',
        {},
        { fetch: breakingFetch },
      );
      await sleep(100);

      const failure =
        'the SSE tail /events?orgId=o1 failed: TypeError: terminated';
      expect(unhandled).toEqual([]);
      expect(warn.mock.calls).toEqual([[`[itest] Error: ${failure}`]]);
      await expect(tail.close()).rejects.toThrow(failure);
      // A broken tail has nothing left to cancel: no second warning.
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

/** The `sql` reads the events handler makes, answered for a member of
 * `org1` with an empty outbox. */
function eventsSql(strings: TemplateStringsArray): Promise<unknown[]> {
  const query = strings.join('?');
  if (query.includes('FROM "member"')) {
    return Promise.resolve([
      { id: 'm1', organizationId: 'org1', userId: 'u1', role: 'member' },
    ]);
  }
  if (query.includes('max(id)')) return Promise.resolve([{ max: '0' }]);
  return Promise.resolve([]);
}

/** The real server and `/events` handler, minus the session lookup; it
 * polls and heartbeats every 20 ms, so a tail sees it is live at once. */
function serveEvents(): Promise<{
  server: ReturnType<typeof serve>;
  origin: string;
}> {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
    c.set('sessionBundle', {
      user: { id: 'u1' },
      session: { id: 's1' },
    } as never);
    await next();
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  app.get(
    '/events',
    createEventsHandler(eventsSql as never, {
      pollIntervalMs: 20,
      heartbeatIntervalMs: 20,
    }),
  );
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({ server, origin: `http://127.0.0.1:${info.port}` });
    });
  });
}

describe('settleTeardown', () => {
  it('names a step that never settles and still runs the next ones, within the bound', async () => {
    const { checks, record } = recorder();
    const ran: string[] = [];
    const startedAt = Date.now();
    await settleTeardown(
      [
        ['stops pg-boss', () => Promise.resolve(ran.push('boss'))],
        ['closes the backend', () => new Promise<void>(() => undefined)],
        ['drops itest_counter', () => Promise.reject(new Error('gone'))],
        ['ends the database pool', () => Promise.resolve(ran.push('pool'))],
      ],
      record,
      50,
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(ran).toEqual(['boss', 'pool']);
    expect(checks).toEqual([
      {
        name: 'harness: the teardown step that closes the backend settles',
        ok: false,
        detail:
          'Error: the teardown step that closes the backend did not settle within 0.05 s — the harness went on to its tally regardless',
      },
      {
        name: 'harness: the teardown step that drops itest_counter settles',
        ok: false,
        detail: 'Error: gone — the harness went on to its tally regardless',
      },
    ]);
  });

  it("closes the backend while a stuck lane's /events tail is still open", async () => {
    // A lane past its deadline still holds its tail (#4112). The bare
    // `server.close()` the harness used never settles then; the graceful
    // close the harness uses now ends the stream and settles at once.
    for (const [teardown, settles] of [
      ['bare', false],
      ['graceful', true],
    ] as const) {
      const { server, origin } = await serveEvents();
      const tail = connectSse(`${origin}/events?orgId=org1`, {});
      // A heartbeat in: the stream is live and enrolled for the drain.
      while (tail.events.length === 0) await sleep(10);
      const { checks, record } = recorder();
      await settleTeardown(
        [
          [
            'closes the backend',
            () =>
              teardown === 'graceful'
                ? closeServerGracefully(server, { forceAfterMs: 3_000 })
                : new Promise<void>((resolve) => {
                    server.close(() => resolve());
                  }),
          ],
        ],
        record,
        2_000,
      );

      expect(checks.map((check) => check.name)).toEqual(
        settles
          ? []
          : ['harness: the teardown step that closes the backend settles'],
      );
      if (!settles) {
        // The test's own cleanup, which the harness never had.
        if ('closeAllConnections' in server) server.closeAllConnections();
      }
      await tail.close();
    }
  });
});
