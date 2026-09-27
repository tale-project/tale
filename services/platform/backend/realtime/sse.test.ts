// @vitest-environment node

import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AuthEnv } from '../auth/session.ts';
import { reportError } from '../error-reporting.ts';
import { createEventsHandler, type EventsHandlerOptions } from './sse.ts';

vi.mock('../error-reporting.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../error-reporting.ts')>()),
  reportError: vi.fn(),
}));

/**
 * A `postgres` stand-in: the tagged-template call is answered by query text.
 * The handler's own reads (outbox tail, hints) come back empty; the tests
 * steer the three authorization reads — member row, organization row,
 * session row — between polls.
 */
function fakeSql(answer: (text: string) => unknown[]) {
  return ((strings: TemplateStringsArray) =>
    Promise.resolve(answer(strings.join('?')))) as unknown as Parameters<
    typeof createEventsHandler
  >[0];
}

const MEMBER = { id: 'm1', organizationId: 'o1', userId: 'u1', role: 'member' };

function appWith(
  answer: (text: string) => unknown[],
  options: EventsHandlerOptions = {
    pollIntervalMs: 5,
    authRecheckIntervalMs: 20,
  },
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set('sessionBundle', {
      user: { id: 'u1', email: 'u1@example.com', name: 'U1' },
      session: { id: 's1' },
    });
    await next();
  });
  app.get('/events', createEventsHandler(fakeSql(answer), options));
  return app;
}

/** Read the SSE body to its end, or give up after `timeoutMs`. */
async function drain(
  response: Response,
  timeoutMs: number,
): Promise<{ text: string; ended: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      await reader.cancel();
      return { text, ended: false };
    }
    const next = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), remaining),
      ),
    ]);
    if (next === 'timeout') {
      await reader.cancel();
      return { text, ended: false };
    }
    if (next.done) return { text, ended: true };
    text += decoder.decode(next.value, { stream: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(reportError).mockClear();
});

describe('GET /events re-proves the reader while the stream is open', () => {
  test('a member disabled mid-stream is told forbidden and the stream ends', async () => {
    let role = 'member';
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return [{ ...MEMBER, role }];
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    expect(response.status).toBe(200);
    // The connect-time check passed; now the membership is soft-removed.
    role = 'disabled';
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a member hard-removed mid-stream ends the same way', async () => {
    let memberRows: unknown[] = [MEMBER];
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return memberRows;
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    memberRows = [];
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a session revoked mid-stream ends the stream too', async () => {
    let sessionRows: unknown[] = [{ id: 's1' }];
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) return [MEMBER];
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return sessionRows;
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    // Idle enforcement (or a member removal) deleted the session row.
    sessionRows = [];
    const { text, ended } = await drain(response, 2_000);
    expect(ended).toBe(true);
    expect(text).toContain('event: forbidden');
  });

  test('a still-authorized reader is never ended by the re-check', async () => {
    let memberReads = 0;
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) {
        memberReads += 1;
        return [MEMBER];
      }
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    const { text, ended } = await drain(response, 150);
    expect(ended).toBe(false);
    expect(text).not.toContain('forbidden');
    // Connect-time read plus several interval re-checks: the cadence ran.
    expect(memberReads).toBeGreaterThan(2);
  });

  test('a database fault during the re-check backs off instead of ending a legitimate stream', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let mode: 'ok' | 'fault' | 'gone' = 'ok';
    const app = appWith((text) => {
      if (text.includes('FROM "member"')) {
        if (mode === 'fault') throw new Error('connection reset');
        return mode === 'gone' ? [] : [MEMBER];
      }
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      return [];
    });
    const response = await app.request('/events?orgId=o1');
    mode = 'fault';
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    // The fault lands on the first re-check; the stream must still be open
    // after it (the poll backs off a second and retries). The read stays
    // pending across the probe — a fresh read would race it for the chunk.
    let pending = reader.read();
    const probe = await Promise.race([
      pending,
      new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 300)),
    ]);
    expect(probe).toBe('open');
    // Once the database answers again with a definite refusal, the stream ends.
    mode = 'gone';
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3_000;
    for (;;) {
      const next = await Promise.race([
        pending,
        new Promise<'timeout'>((resolve) =>
          setTimeout(
            () => resolve('timeout'),
            Math.max(1, deadline - Date.now()),
          ),
        ),
      ]);
      if (next === 'timeout') {
        await reader.cancel();
        throw new Error(`stream did not end; saw: ${text}`);
      }
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      pending = reader.read();
    }
    expect(text).toContain('event: forbidden');
    // A fault that does not say the database is unavailable is still a
    // defect, reported like before.
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
      tags: { 'tale.lane': 'events-poll' },
    });
  });
});

/** Collect an SSE body as it arrives. */
function collect(response: Response) {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  let ended = false;
  const pump = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        return;
      }
      text += decoder.decode(next.value, { stream: true });
    }
  })();
  return {
    get text() {
      return text;
    },
    get ended() {
      return ended;
    },
    /** Wait until everything read so far satisfies `predicate`. */
    async until(
      predicate: (read: string) => boolean,
      timeoutMs: number,
    ): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(text)) {
        if (ended || Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return true;
    },
    async close(): Promise<void> {
      await reader.cancel();
      await pump;
    },
  };
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('GET /events through a database restart', () => {
  /** What postgres.js rejects a query with once its server has gone. */
  const unavailable = (): Error =>
    Object.assign(new Error('write CONNECTION_CLOSED db:5432'), {
      code: 'CONNECTION_CLOSED',
    });

  /** The organization's outbox; `down` fails every query the way a
   * restarting database does, and `rows` is read by the next poll once. */
  function outboxWorld() {
    const world = {
      down: false,
      rows: [] as {
        id: string;
        org_id: string;
        entity: string;
        entity_id: string | null;
      }[],
    };
    const answer = (text: string): unknown[] => {
      if (world.down) throw unavailable();
      if (text.includes('FROM "member"')) return [MEMBER];
      if (text.includes('FROM "organization"')) return [{ id: 'o1' }];
      if (text.includes('FROM "session"')) return [{ id: 's1' }];
      if (text.includes('max(id)')) return [{ max: '0' }];
      if (text.includes('AS id, org_id, entity, entity_id')) {
        const rows = world.rows;
        world.rows = [];
        return rows;
      }
      return [];
    };
    return { world, answer };
  }

  const FAST: EventsHandlerOptions = {
    pollIntervalMs: 5,
    authRecheckIntervalMs: 60_000,
    heartbeatIntervalMs: 40,
    errorBackoffMs: 5,
    unavailableBackoffMaxMs: 20,
    outageReportAfterMs: 60_000,
  };

  test('stays open, keeps its heartbeat, and resumes once the database is back — logged, not reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { world, answer } = outboxWorld();
    const response = await appWith(answer, FAST).request('/events?orgId=o1');
    expect(response.status).toBe(200);
    const stream = collect(response);
    world.down = true;
    const mark = stream.text.length;
    // Every query fails, and the lane still hears from the server: a proxy
    // that sees no byte for a minute would cut it.
    expect(
      await stream.until(
        (read) => occurrences(read.slice(mark), 'event: heartbeat') >= 2,
        2_000,
      ),
    ).toBe(true);
    world.rows = [{ id: '7', org_id: 'o1', entity: 'task', entity_id: 't1' }];
    world.down = false;
    expect(
      await stream.until((read) => read.includes('event: hint'), 2_000),
    ).toBe(true);
    expect(stream.ended).toBe(false);
    expect(stream.text).toContain('"entity":"task"');
    await stream.close();
    expect(reportError).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.filter(([line]) =>
        String(line).includes('database unavailable'),
      ),
    ).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('/events: database back after'),
    );
  });

  test('reports an outage that outlasts its threshold once, at warning level, however many streams wait it out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { world, answer } = outboxWorld();
    const app = appWith(answer, {
      ...FAST,
      unavailableBackoffMaxMs: 10,
      outageReportAfterMs: 50,
    });
    const first = collect(await app.request('/events?orgId=o1'));
    const second = collect(await app.request('/events?orgId=o1'));
    world.down = true;
    await vi.waitFor(() => expect(reportError).toHaveBeenCalled(), {
      timeout: 2_000,
    });
    // Well past the threshold, both streams still failing: still one report.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONNECTION_CLOSED' }),
      expect.objectContaining({
        level: 'warning',
        tags: { 'tale.lane': 'events-poll' },
      }),
    );
    expect(first.ended).toBe(false);
    expect(second.ended).toBe(false);
    await first.close();
    await second.close();
  });

  test('a stream opened as the database went away backs off instead of ending', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { world, answer } = outboxWorld();
    let tailReads = 0;
    const app = appWith((text) => {
      if (text.includes('max(id)')) {
        tailReads += 1;
        // The membership check at connect passed; the tail read after it is
        // the first query the restart catches.
        if (tailReads === 1) throw unavailable();
      }
      return answer(text);
    }, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    world.rows = [
      { id: '3', org_id: 'o1', entity: 'document', entity_id: 'd1' },
    ];
    expect(
      await stream.until((read) => read.includes('event: hint'), 2_000),
    ).toBe(true);
    expect(tailReads).toBe(2);
    expect(stream.ended).toBe(false);
    await stream.close();
    expect(reportError).not.toHaveBeenCalled();
  });
});
