// @vitest-environment node

import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AuthEnv } from '../auth/session.ts';
import { createEventsHandler, type EventsHandlerOptions } from './sse.ts';

vi.mock('../error-reporting.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../error-reporting.ts')>()),
  reportError: vi.fn(),
}));

interface Row {
  id: number;
  org_id: string;
  user_id: string | null;
  entity: string;
  entity_id: string | null;
}

/**
 * An in-memory outbox behind a `postgres` stand-in that answers the hub's
 * queries by their text and parameters, and counts what was asked — the
 * point of the hub is how FEW queries a crowd of streams costs.
 */
function outboxWorld() {
  const world = {
    rows: [] as Row[],
    nextId: 1,
    sessions: new Set<string>(),
    members: new Map<string, string>(),
    queries: [] as string[],
    /** The ids of every late-commit look-up, in order. */
    lookedFor: [] as number[][],
    insert(
      orgId: string,
      entity: string,
      userId: string | null = null,
    ): number {
      const id = world.nextId;
      world.nextId += 1;
      world.rows.push({
        id,
        org_id: orgId,
        user_id: userId,
        entity,
        entity_id: `${entity}-${id}`,
      });
      return id;
    },
    count(fragment: string): number {
      return world.queries.filter((text) => text.includes(fragment)).length;
    },
  };
  const project = (row: Row) => ({
    id: String(row.id),
    org_id: row.org_id,
    user_id: row.user_id,
    entity: row.entity,
    entity_id: row.entity_id,
  });
  const answer = (text: string, values: unknown[]): unknown[] => {
    world.queries.push(text);
    if (text.includes('FROM "member"') && text.includes('unnest')) {
      const orgIds = values[0] as string[];
      const userIds = values[1] as string[];
      const out: unknown[] = [];
      orgIds.forEach((orgId, i) => {
        const userId = userIds[i] ?? '';
        const role = world.members.get(`${orgId}/${userId}`);
        if (role !== undefined)
          out.push({ organizationId: orgId, userId, role });
      });
      return out;
    }
    if (text.includes('FROM "member"')) {
      const [orgId, userId] = values as [string, string];
      const role = world.members.get(`${orgId}/${userId}`);
      return role === undefined
        ? []
        : [{ id: `m-${userId}`, organizationId: orgId, userId, role }];
    }
    if (text.includes('FROM "organization"')) return [{ id: values[0] }];
    if (text.includes('FROM "session"')) {
      const ids = values[0] as string[];
      return ids.filter((id) => world.sessions.has(id)).map((id) => ({ id }));
    }
    if (text.includes('id = ANY(')) {
      const ids = new Set((values[0] as string[]).map(Number));
      world.lookedFor.push([...ids]);
      return world.rows
        .filter((row) => ids.has(row.id))
        .sort((a, b) => a.id - b.id)
        .map(project);
    }
    if (text.includes('min(id)')) {
      const min = world.rows.reduce(
        (m, row) => (m === null || row.id < m ? row.id : m),
        null as number | null,
      );
      return [{ oldest: min === null ? null : String(min) }];
    }
    if (text.includes('max(id)')) {
      const max = world.rows.reduce((m, row) => Math.max(m, row.id), 0);
      return [{ max: String(max) }];
    }
    if (text.includes('extract(epoch')) return [];
    if (text.includes('exists(')) {
      const cursor = Number(values[0]);
      return [{ retained: world.rows.some((row) => row.id <= cursor) }];
    }
    if (text.includes('ORDER BY id DESC')) {
      const [latest, limit] = values as [string, number];
      return world.rows
        .filter((row) => row.id <= Number(latest))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map(project);
    }
    if (text.includes('AS id, org_id, user_id, entity, entity_id')) {
      const [after, limit] = values as [string, number];
      return world.rows
        .filter((row) => row.id > Number(after))
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(project);
    }
    if (text.includes('AS id, org_id, entity, entity_id')) {
      // The per-stream catch-up read of a resumed cursor older than the ring.
      const [orgId, userId, after, limit] = values as [
        string,
        string,
        string,
        number,
      ];
      return world.rows
        .filter(
          (row) =>
            row.org_id === orgId &&
            (row.user_id === null || row.user_id === userId) &&
            row.id > Number(after),
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(project);
    }
    return [];
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(
      answer(strings.join('?'), values),
    )) as unknown as Parameters<typeof createEventsHandler>[0];
  return { world, sql };
}

function appFor(
  sql: Parameters<typeof createEventsHandler>[0],
  options: EventsHandlerOptions,
): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    const userId = c.req.header('x-test-user') ?? 'u1';
    c.set('sessionBundle', {
      user: { id: userId, email: `${userId}@example.com`, name: userId },
      session: { id: `s-${userId}` },
    });
    await next();
  });
  app.get('/events', createEventsHandler(sql, options));
  return app;
}

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
    async until(predicate: (read: string) => boolean, timeoutMs = 2_000) {
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

const FAST: EventsHandlerOptions = {
  pollIntervalMs: 10,
  heartbeatIntervalMs: 60_000,
  authRecheckIntervalMs: 60_000,
  errorBackoffMs: 5,
  unavailableBackoffMaxMs: 20,
  outageReportAfterMs: 60_000,
};

function hintIds(text: string): string[] {
  return [...text.matchAll(/event: hint\ndata: [^\n]*\nid: (\d+)/g)].map(
    (match) => match[1] ?? '',
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the shared hint tail', () => {
  test('a crowd of streams costs one tail read per poll, not one per stream', async () => {
    const { world, sql } = outboxWorld();
    for (let i = 0; i < 40; i += 1) {
      world.members.set(`o1/u${i}`, 'member');
      world.sessions.add(`s-u${i}`);
    }
    const app = appFor(sql, FAST);
    const streams = await Promise.all(
      Array.from({ length: 40 }, async (_, i) =>
        collect(
          await app.request('/events?orgId=o1', {
            headers: { 'x-test-user': `u${i}` },
          }),
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    const tailReadsBefore = world.count('AS id, org_id, user_id, entity');
    const id = world.insert('o1', 'task');
    for (const stream of streams) {
      expect(await stream.until((read) => read.includes(`id: ${id}`))).toBe(
        true,
      );
    }
    const tailReads = world.count('AS id, org_id, user_id, entity');
    // Forty streams, a few polls: the reads track the polls (~10 ms each),
    // never forty per poll.
    expect(tailReads - tailReadsBefore).toBeLessThan(40);
    // No stream ran its own per-org read.
    expect(world.count('AS id, org_id, entity, entity_id')).toBe(0);
    await Promise.all(streams.map((stream) => stream.close()));
  });

  test('a user-targeted hint reaches only that user', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    world.members.set('o1/u2', 'member');
    const app = appFor(sql, FAST);
    const mine = collect(
      await app.request('/events?orgId=o1', {
        headers: { 'x-test-user': 'u1' },
      }),
    );
    const theirs = collect(
      await app.request('/events?orgId=o1', {
        headers: { 'x-test-user': 'u2' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const targeted = world.insert('o1', 'notification', 'u1');
    const orgWide = world.insert('o1', 'task');
    expect(await theirs.until((read) => read.includes(`id: ${orgWide}`))).toBe(
      true,
    );
    expect(await mine.until((read) => read.includes(`id: ${orgWide}`))).toBe(
      true,
    );
    expect(hintIds(mine.text)).toEqual([String(targeted), String(orgWide)]);
    expect(hintIds(theirs.text)).toEqual([String(orgWide)]);
    await mine.close();
    await theirs.close();
  });

  test('another organization’s hints never reach the stream', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    world.insert('o2', 'task');
    const own = world.insert('o1', 'task');
    expect(await stream.until((read) => read.includes(`id: ${own}`))).toBe(
      true,
    );
    expect(hintIds(stream.text)).toEqual([String(own)]);
    await stream.close();
  });

  test('a resume inside the ring replays from memory, without a per-stream read', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    // A first stream starts the tail, so the ring holds what follows.
    const first = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const seen = world.insert('o1', 'task');
    const missed = world.insert('o1', 'document');
    expect(await first.until((read) => read.includes(`id: ${missed}`))).toBe(
      true,
    );
    const resumed = collect(
      await app.request('/events?orgId=o1', {
        headers: { 'Last-Event-ID': String(seen) },
      }),
    );
    expect(await resumed.until((read) => read.includes(`id: ${missed}`))).toBe(
      true,
    );
    expect(hintIds(resumed.text)).toEqual([String(missed)]);
    expect(resumed.text).not.toContain('event: resync');
    expect(world.count('AS id, org_id, entity, entity_id')).toBe(0);
    expect(world.count('exists(')).toBe(0);
    // One shared read of the oldest retained id, not a per-stream catch-up.
    expect(world.count('min(id)')).toBe(1);
    await first.close();
    await resumed.close();
  });

  test('a ring resume whose cursor left retention still says resync, and a crowd shares one check', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const first = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const gone = world.insert('o1', 'task');
    const kept = world.insert('o1', 'document');
    expect(await first.until((read) => read.includes(`id: ${kept}`))).toBe(
      true,
    );
    // The cursor's row was reclaimed by another process; the ring still
    // holds what followed it.
    world.rows = world.rows.filter((row) => row.id > gone);
    const crowd = await Promise.all(
      [0, 1, 2].map(async () =>
        collect(
          await app.request('/events?orgId=o1', {
            headers: { 'Last-Event-ID': String(gone) },
          }),
        ),
      ),
    );
    for (const resumed of crowd) {
      expect(
        await resumed.until((read) => read.includes('event: resync')),
      ).toBe(true);
      // The replay still came from memory.
      expect(hintIds(resumed.text)).toEqual([String(kept)]);
    }
    expect(world.count('min(id)')).toBe(1);
    expect(world.count('AS id, org_id, entity, entity_id')).toBe(0);
    await first.close();
    await Promise.all(crowd.map((resumed) => resumed.close()));
  });

  test('a resume older than the ring reads the database and says resync when the cursor is gone', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    for (let i = 0; i < 10; i += 1) world.insert('o1', 'task');
    // The cursor's rows were reclaimed: the oldest retained row is above it.
    world.rows = world.rows.filter((row) => row.id > 6);
    const app = appFor(sql, { ...FAST, ringCapacity: 2 });
    const resumed = collect(
      await app.request('/events?orgId=o1', {
        headers: { 'Last-Event-ID': '3' },
      }),
    );
    expect(await resumed.until((read) => read.includes('id: 10'))).toBe(true);
    expect(resumed.text).toContain('event: resync');
    expect(hintIds(resumed.text)).toEqual(['7', '8', '9', '10']);
    // The catch-up joined the live tail: a new hint arrives once.
    const next = world.insert('o1', 'task');
    expect(await resumed.until((read) => read.includes(`id: ${next}`))).toBe(
      true,
    );
    expect(
      hintIds(resumed.text).filter((id) => id === String(next)),
    ).toHaveLength(1);
    await resumed.close();
  });

  test('a replay of hundreds of distinct hints reaches the client whole', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const first = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const from = world.insert('o1', 'task');
    let last = from;
    // 400 distinct entities: more than the writer's write-count ceiling.
    for (let i = 0; i < 400; i += 1) last = world.insert('o1', 'product');
    expect(await first.until((read) => read.includes(`id: ${last}`))).toBe(
      true,
    );
    const resumed = collect(
      await app.request('/events?orgId=o1', {
        headers: { 'Last-Event-ID': String(from) },
      }),
    );
    expect(await resumed.until((read) => read.includes(`id: ${last}`))).toBe(
      true,
    );
    expect(hintIds(resumed.text)).toHaveLength(400);
    await first.close();
    await resumed.close();
  });

  test('a hint whose transaction commits after a later one still arrives', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // A transaction takes its id, then commits after a later one did: the
    // tail reads past the id before its row is visible.
    const late = world.nextId;
    world.nextId += 1;
    const early = world.insert('o1', 'task');
    expect(await stream.until((read) => read.includes(`id: ${early}`))).toBe(
      true,
    );
    world.rows.push({
      id: late,
      org_id: 'o1',
      user_id: null,
      entity: 'document',
      entity_id: `document-${late}`,
    });
    expect(
      await stream.until((read) => read.includes(`document-${late}`)),
    ).toBe(true);
    // Framed without an id: the browser's resume position stays put.
    expect(stream.text).not.toContain(`id: ${late}\n`);
    await stream.close();
  });

  test('a hole nobody fills is looked for only for the grace period', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, { ...FAST, lateCommitGraceMs: 150 });
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    world.nextId += 1; // a rolled-back insert: its id never commits
    const after = world.insert('o1', 'task');
    expect(await stream.until((read) => read.includes(`id: ${after}`))).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const looked = world.count('id = ANY(');
    expect(looked).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(world.count('id = ANY(')).toBe(looked);
    await stream.close();
  });

  test('a tail started on an empty outbox looks only just under its first row', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Everything before was reclaimed: the sequence is far past zero.
    world.nextId = 5_000_000;
    const first = world.insert('o1', 'task');
    expect(await stream.until((read) => read.includes(`id: ${first}`))).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ids = world.lookedFor.flat();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBeLessThanOrEqual(1_000);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(first - 1_000);
    await stream.close();
  });

  test('a hole still in flight as the tail starts arrives once it commits', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    world.insert('o1', 'task');
    const late = world.nextId;
    world.nextId += 1;
    const latest = world.insert('o1', 'task');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(world.count('ORDER BY id DESC')).toBeGreaterThan(0);
    world.rows.push({
      id: late,
      org_id: 'o1',
      user_id: null,
      entity: 'document',
      entity_id: `document-${late}`,
    });
    expect(
      await stream.until((read) => read.includes(`document-${late}`)),
    ).toBe(true);
    expect(stream.text).not.toContain(`id: ${latest}\n`);
    await stream.close();
  });

  test('every reader is re-proved in one batched pass', async () => {
    const { world, sql } = outboxWorld();
    for (let i = 0; i < 30; i += 1) {
      world.members.set(`o1/u${i}`, 'member');
      world.sessions.add(`s-u${i}`);
    }
    const app = appFor(sql, { ...FAST, authRecheckIntervalMs: 40 });
    const streams = await Promise.all(
      Array.from({ length: 30 }, async (_, i) =>
        collect(
          await app.request('/events?orgId=o1', {
            headers: { 'x-test-user': `u${i}` },
          }),
        ),
      ),
    );
    const before = world.count('unnest');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const passes = world.count('unnest') - before;
    expect(passes).toBeGreaterThan(0);
    // Thirty streams, a handful of passes: one batched member read each.
    expect(passes).toBeLessThan(15);
    // Revoke one session: only that stream is told forbidden and ends.
    world.sessions.delete('s-u7');
    expect(
      await streams[7]?.until((read) => read.includes('event: forbidden')),
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(streams[7]?.ended).toBe(true);
    expect(streams[8]?.text).not.toContain('forbidden');
    expect(streams[8]?.ended).toBe(false);
    await Promise.all(streams.map((stream) => stream.close()));
  });

  test('a stream opens with a jittered reconnect delay', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    expect(await stream.until((read) => read.includes('retry:'))).toBe(true);
    const retry = Number(/retry: (\d+)/.exec(stream.text)?.[1]);
    expect(retry).toBeGreaterThanOrEqual(1_000);
    expect(retry).toBeLessThanOrEqual(10_000);
    await stream.close();
  });

  test('the tail stops reading once its last stream is gone', async () => {
    const { world, sql } = outboxWorld();
    world.members.set('o1/u1', 'member');
    const app = appFor(sql, FAST);
    const stream = collect(await app.request('/events?orgId=o1'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await stream.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reads = world.count('AS id, org_id, user_id, entity');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(world.count('AS id, org_id, user_id, entity')).toBe(reads);
  });
});
