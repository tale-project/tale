import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { AuthEnv } from './auth/session';
import { closeServerGracefully } from './http-shutdown';
import {
  connectSse,
  dropOwnedDatabase,
  everyLaneRequired,
  explainSentStatement,
  fullCoverageBlockers,
  isSkippedCheck,
  itestObjectStore,
  ownedDatabaseAdmin,
  recordOpenStreams,
  recordSkip,
  requestedLanes,
  setOwnedDatabaseBudgetInTx,
  settleTeardown,
  videoLaneFfmpegLocation,
  withCleanup,
} from './integration-lane-helpers';
import { createEventsHandler, liveStreamCount } from './realtime/sse';

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

describe('videoLaneFfmpegLocation', () => {
  it('hands yt-dlp the ffmpeg on PATH while the variable is unset or blank (#4715)', async () => {
    const onPath = vi.fn(async () => '/opt/homebrew/bin/ffmpeg');
    expect(await videoLaneFfmpegLocation({}, onPath)).toBe(
      '/opt/homebrew/bin/ffmpeg',
    );
    expect(
      await videoLaneFfmpegLocation(
        { VIDEO_INGEST_FFMPEG_LOCATION: '  ' },
        onPath,
      ),
    ).toBe('/opt/homebrew/bin/ffmpeg');
  });

  it('leaves a variable someone set alone, without looking', async () => {
    const onPath = vi.fn(async () => '/usr/local/bin/ffmpeg');
    expect(
      await videoLaneFfmpegLocation(
        { VIDEO_INGEST_FFMPEG_LOCATION: '/opt/ffmpeg/bin/ffmpeg' },
        onPath,
      ),
    ).toBeNull();
    expect(onPath).not.toHaveBeenCalled();
  });

  it('leaves the product its default when PATH has no ffmpeg', async () => {
    expect(await videoLaneFfmpegLocation({}, async () => null)).toBeNull();
  });

  it('leaves the product its default when the lookup fails, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(
        await videoLaneFfmpegLocation({}, async () => {
          throw new Error('ffmpeg lookup: timed out after 10000 ms');
        }),
      ).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('ffmpeg lookup: timed out after 10000 ms'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('looks on PATH the way the toolchain does by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itest-ffmpeg-'));
    await writeFile(
      join(dir, 'which'),
      '#!/bin/sh\n[ "$1" = ffmpeg ] && echo /opt/fake/ffmpeg\n',
      { mode: 0o755 },
    );
    const inherited = process.env.PATH;
    process.env.PATH = `${dir}:${inherited}`;
    try {
      expect(await videoLaneFfmpegLocation({})).toBe('/opt/fake/ffmpeg');
    } finally {
      process.env.PATH = inherited;
      await rm(dir, { recursive: true, force: true });
    }
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

describe('withCleanup', () => {
  it("reports the body's error when a cleanup step fails too, and runs every step", async () => {
    // The bell-wire lane's shape (#4152): the lane fails, then a tail will
    // not close. A plain `finally` reported the tail; the lane's error won.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const lane = new Error('the recipient never heard the hint');
      const ran: string[] = [];
      await expect(
        withCleanup(
          [
            [
              "closes the owner's tail",
              () => Promise.reject(new Error('the tail did not settle')),
            ],
            ['deletes the project', () => Promise.resolve(ran.push('delete'))],
          ],
          () => Promise.reject(lane),
        ),
      ).rejects.toBe(lane);
      expect(ran).toEqual(['delete']);
      expect(warn.mock.calls).toEqual([
        [
          "[itest] the cleanup step that closes the owner's tail failed: Error: the tail did not settle (logged only: the lane fails with the error before it)",
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('fails a passing body with its first cleanup failure, naming the step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const ran: string[] = [];
      await expect(
        withCleanup(
          [
            ["closes the owner's tail", () => Promise.reject(new Error('one'))],
            ["closes the mate's tail", () => Promise.reject(new Error('two'))],
            ['deletes the project', () => Promise.resolve(ran.push('delete'))],
          ],
          () => Promise.resolve('passed'),
        ),
      ).rejects.toThrow(
        "the cleanup step that closes the owner's tail failed: Error: one",
      );
      expect(ran).toEqual(['delete']);
      expect(warn.mock.calls).toEqual([
        [
          "[itest] the cleanup step that closes the mate's tail failed: Error: two (logged only: the lane fails with the error before it)",
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("returns the body's value once every step has run", async () => {
    const ran: string[] = [];
    await expect(
      withCleanup(
        [['deletes the project', () => Promise.resolve(ran.push('delete'))]],
        () => Promise.resolve('passed'),
      ),
    ).resolves.toBe('passed');
    expect(ran).toEqual(['delete']);
  });
});

describe('recordOpenStreams', () => {
  it('fails a lane that passed with an /events tail still open, naming it, and ends the stream', async () => {
    // Since #4133 the teardown's graceful close ended such a tail without a
    // word, and the run exited 0 (#4152).
    const { server, origin } = await serveEvents();
    try {
      const tail = connectSse(`${origin}/events?orgId=org1`, {});
      while (tail.events.length === 0) await sleep(10);
      const { checks, record } = recorder();
      await recordOpenStreams('checkLeakyLane', record, 200);

      expect(checks).toEqual([
        {
          name: 'harness: checkLeakyLane leaves no SSE stream open',
          ok: false,
          detail: expect.stringMatching(
            /^1 SSE stream\(s\) still open on the backend 0\.2 s after it returned/,
          ),
        },
      ]);
      expect(liveStreamCount()).toBe(0);
      // The harness ended the stream: the tail is over, not stuck.
      await tail.close();
    } finally {
      await closeServerGracefully(server, { forceAfterMs: 3_000 });
    }
  });

  it('records nothing for a lane that closed its tail', async () => {
    const { server, origin } = await serveEvents();
    try {
      const tail = connectSse(`${origin}/events?orgId=org1`, {});
      while (tail.events.length === 0) await sleep(10);
      await tail.close();
      const { checks, record } = recorder();
      // At once: the stream may not have left the backend yet.
      await recordOpenStreams('checkTidyLane', record);

      expect(checks).toEqual([]);
      expect(liveStreamCount()).toBe(0);
    } finally {
      await closeServerGracefully(server, { forceAfterMs: 3_000 });
    }
  });
});

describe('ownedDatabaseAdmin', () => {
  it('gives the DDL two minutes of statement and lock timeout', async () => {
    const admin = ownedDatabaseAdmin(
      'postgres://tale:secret@127.0.0.1:5432/tale_app',
    );
    try {
      expect(String(admin.options.connection.options).trim()).toBe(
        '-c statement_timeout=120000 -c lock_timeout=120000',
      );
      expect(admin.options.max).toBe(1);
    } finally {
      await admin.end();
    }
  });

  it("sets its timeouts after the caller's own options, so they win", async () => {
    const admin = ownedDatabaseAdmin(
      'postgres://tale:secret@127.0.0.1:5432/tale_app?options=-c%20statement_timeout%3D8000%20-c%20search_path%3Dtale',
    );
    try {
      expect(admin.options.connection.options).toBe(
        '-c statement_timeout=8000 -c search_path=tale -c statement_timeout=120000 -c lock_timeout=120000',
      );
    } finally {
      await admin.end();
    }
  });
});

describe('setOwnedDatabaseBudgetInTx', () => {
  it('lifts both timeouts for the rest of its transaction only', async () => {
    // `true` makes each setting the transaction's own: the statements under
    // test, after the commit, run on the connection's timeouts again.
    const queries: { text: string; values: unknown[] }[] = [];
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({
        text: strings.join('$?').replace(/\s+/g, ' ').trim(),
        values,
      });
      return Promise.resolve([]);
    };
    await setOwnedDatabaseBudgetInTx(tx as unknown as TransactionSql);

    expect(queries).toEqual([
      {
        text: "SELECT set_config('statement_timeout', $?, true), set_config('lock_timeout', $?, true)",
        values: ['120000', '120000'],
      },
    ]);
  });
});

describe('dropOwnedDatabase', () => {
  function fakeAdmin(answer: () => Promise<unknown>): {
    admin: Sql;
    statements: { text: string; values: unknown[] }[];
  } {
    const statements: { text: string; values: unknown[] }[] = [];
    const sql = (
      first: TemplateStringsArray | string,
      ...values: unknown[]
    ): unknown => {
      // `admin(name)` quotes an identifier; a template is a statement.
      if (typeof first === 'string') return { identifier: first };
      statements.push({ text: first.join('$?'), values });
      return answer();
    };
    return { admin: sql as unknown as Sql, statements };
  }

  it('drops the named database and logs how long the drop took', async () => {
    const { admin, statements } = fakeAdmin(() => Promise.resolve([]));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await dropOwnedDatabase(admin, 'itest_legacy_0001');

      expect(statements).toEqual([
        {
          text: 'DROP DATABASE $?',
          values: [{ identifier: 'itest_legacy_0001' }],
        },
      ]);
      expect(log.mock.calls).toEqual([
        [
          expect.stringMatching(
            /^\[itest\] dropped database itest_legacy_0001 in \d+\.\d s of its 2 min budget$/,
          ),
        ],
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it('throws a failed drop unchanged and logs no drop', async () => {
    // The run must still fail on a drop that does not complete (#5133).
    const timeout = new Error('canceling statement due to statement timeout');
    const { admin } = fakeAdmin(() => Promise.reject(timeout));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(dropOwnedDatabase(admin, 'itest_legacy_0001')).rejects.toBe(
        timeout,
      );
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('explainSentStatement', () => {
  /** A database that records each statement it is sent, answers an EXPLAIN
   * with a plan and anything else with a row, and describes a statement as
   * its template with numbered parameters. */
  function fakeDatabase(): {
    sql: Sql;
    sent: { strings: string[]; raw: string[]; values: unknown[] }[];
    unsafe: string[];
  } {
    const sent: { strings: string[]; raw: string[]; values: unknown[] }[] = [];
    const unsafe: string[] = [];
    const tx = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        sent.push({ strings: [...strings], raw: [...strings.raw], values });
        const answer = strings[0]?.startsWith('EXPLAIN')
          ? [{ 'QUERY PLAN': 'custom plan' }]
          : [{ id: 'row' }];
        return Object.assign(Promise.resolve(answer), {
          describe: () =>
            Promise.resolve({
              string: strings.reduce((text, part, i) => `${text}$${i}${part}`),
            }),
        });
      },
      {
        unsafe: (text: string) => ({
          simple: () => {
            unsafe.push(text);
            return Promise.resolve([{ 'QUERY PLAN': 'generic plan' }]);
          },
        }),
      },
    );
    const sql = {
      begin: (work: (transaction: unknown) => Promise<unknown>) => work(tx),
    };
    return { sql: sql as unknown as Sql, sent, unsafe };
  }

  it('plans the statement it picks, custom and generic, and sends every other one as it is', async () => {
    const { sql, sent, unsafe } = fakeDatabase();
    const answers: unknown[] = [];
    let fragment: unknown;
    const plans = await explainSentStatement<{ 'QUERY PLAN': string }>(
      sql,
      (template) => template.includes('FROM app.things'),
      async (tx) => {
        answers.push(await tx`SELECT 1 FROM app.others`);
        const unread = tx`AND read = false`;
        fragment = unread;
        answers.push(
          await tx`SELECT id FROM app.things WHERE org_id = ${'org-1'} ${unread} LIMIT ${26}`,
        );
      },
    );

    // Sequential scans and sorts are off before the read sends anything.
    const template = [
      'SELECT id FROM app.things WHERE org_id = ',
      ' ',
      ' LIMIT ',
      '',
    ];
    const explain = [
      'EXPLAIN SELECT id FROM app.things WHERE org_id = ',
      ' ',
      ' LIMIT ',
      '',
    ];
    expect(sent).toEqual([
      {
        strings: ['SET LOCAL enable_seqscan = off'],
        raw: ['SET LOCAL enable_seqscan = off'],
        values: [],
      },
      {
        strings: ['SET LOCAL enable_sort = off'],
        raw: ['SET LOCAL enable_sort = off'],
        values: [],
      },
      {
        strings: ['SELECT 1 FROM app.others'],
        raw: ['SELECT 1 FROM app.others'],
        values: [],
      },
      { strings: ['AND read = false'], raw: ['AND read = false'], values: [] },
      { strings: explain, raw: explain, values: ['org-1', fragment, 26] },
      { strings: template, raw: template, values: ['org-1', fragment, 26] },
    ]);
    // The read's own fragment, not a copy: postgres.js inlines it.
    expect(sent[4]?.values[1]).toBe(fragment);
    expect(unsafe).toEqual([
      'EXPLAIN (GENERIC_PLAN) SELECT id FROM app.things WHERE org_id = $1 $2 LIMIT $3',
    ]);
    expect(plans).toEqual({
      custom: [{ 'QUERY PLAN': 'custom plan' }],
      generic: [{ 'QUERY PLAN': 'generic plan' }],
    });
    // The planned statement answers no rows; the other one its own.
    expect(answers).toEqual([[{ id: 'row' }], []]);
  });

  it.each([
    [{}, 'EXPLAIN ', 'EXPLAIN (GENERIC_PLAN) '],
    [{ analyze: true }, 'EXPLAIN (ANALYZE) ', 'EXPLAIN (GENERIC_PLAN) '],
    [
      { json: true },
      'EXPLAIN (FORMAT JSON) ',
      'EXPLAIN (GENERIC_PLAN, FORMAT JSON) ',
    ],
    [
      { analyze: true, json: true },
      'EXPLAIN (ANALYZE, FORMAT JSON) ',
      'EXPLAIN (GENERIC_PLAN, FORMAT JSON) ',
    ],
  ])(
    'asks EXPLAIN for %o: ANALYZE of the custom plan alone, FORMAT JSON of both',
    async (options, custom, generic) => {
      const { sql, sent, unsafe } = fakeDatabase();
      await explainSentStatement(
        sql,
        () => true,
        async (tx) => {
          await tx`SELECT * FROM app.things LIMIT ${26}`;
        },
        options,
      );

      const prefixed = [`${custom}SELECT * FROM app.things LIMIT `, ''];
      expect(sent[2]).toEqual({
        strings: prefixed,
        raw: prefixed,
        values: [26],
      });
      expect(unsafe).toEqual([`${generic}SELECT * FROM app.things LIMIT $1`]);
    },
  );

  it('plans nothing when the read sends no statement it picks', async () => {
    const { sql, sent, unsafe } = fakeDatabase();
    const plans = await explainSentStatement(
      sql,
      () => false,
      async (tx) => {
        await tx`SELECT * FROM app.things`;
      },
    );

    expect(plans).toEqual({ custom: [], generic: [] });
    expect(sent.map(({ strings }) => strings.join('$?'))).toEqual([
      'SET LOCAL enable_seqscan = off',
      'SET LOCAL enable_sort = off',
      'SELECT * FROM app.things',
    ]);
    expect(unsafe).toEqual([]);
  });
});
