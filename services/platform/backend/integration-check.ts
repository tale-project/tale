/**
 * Integration proof against a real Postgres — run with Node (the shipping
 * runtime): `DATABASE_URL=postgres://… node backend/integration-check.ts`.
 *
 * Proves the constitutional properties of the 0.5 backend:
 *   1. Boot migrations: app SQL migrations + Better Auth tables, advisory-lock
 *      guarded (two concurrent migrators, one outcome).
 *   2. SERIALIZABLE + retry: concurrent read-modify-write converges.
 *   3. Transactional enqueue: a rolled-back tx enqueues nothing; a committed
 *      one enqueues exactly once.
 *   4. Worker pickup latency: commit→handler wake through LISTEN/NOTIFY.
 *   5. Auth: sign-up → session cookie; /events is 401 without a session,
 *      403 for a non-member org, and streams + replays (Last-Event-ID) for a
 *      member.
 *
 * Uses a throwaway database (see README) — it installs the pgboss schema,
 * Better Auth tables, and app tables, and writes test rows.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serve } from '@hono/node-server';
import { transactSerializable } from '@tale/shared/db/serializable';
import type { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { computeAuditHash } from '../convex/lib/helpers/audit_hash.ts';
import { createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import { runBootMigrations } from './db/migrate.ts';
import { createSql } from './db/sql.ts';
import { rowToHashInput } from './domains/audit_logs/hash-input.ts';
import type { AuditLogRow } from './domains/audit_logs/types.ts';
import { writeNotificationForOrgs } from './domains/notifications/service.ts';
import { createBoss, ensureQueues } from './jobs/boss.ts';
import { addJobInTx, setEnqueueBoss } from './jobs/enqueue.ts';
import { startWorker } from './jobs/runner.ts';
import { registerSchedules } from './jobs/schedules.ts';
import { createTaskList } from './jobs/task-list.ts';
import { emitHintInTx } from './realtime/outbox.ts';

const noopPayloadSchema = z.object({
  seq: z.number().optional(),
  sentAtMs: z.number().optional(),
});

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countNoopJobs(sql: Sql): Promise<number> {
  // Counts every state — the transactional-enqueue check needs "row exists
  // at all", not "still queued". pg-boss's job table is internal; this test
  // query is pinned to v12 and re-validated on upgrades.
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM pgboss.job
    WHERE name = 'noop'
  `;
  return Number(rows[0]?.count ?? '0');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

async function checkSerializableRetry(sql: Sql): Promise<void> {
  await sql`DROP TABLE IF EXISTS itest_counter`;
  await sql`CREATE TABLE itest_counter (id int PRIMARY KEY, value int NOT NULL)`;
  await sql`INSERT INTO itest_counter VALUES (1, 0)`;

  // Each begin runs the callback exactly once, so counting callback entries
  // counts transaction attempts — >2 total proves a serialization retry.
  let attempts = 0;
  const bump = (): Promise<void> =>
    transactSerializable(sql, async (tx) => {
      attempts += 1;
      const rows = await tx<{ value: number }[]>`
        SELECT value FROM itest_counter WHERE id = 1
      `;
      const current = rows[0]?.value ?? 0;
      await sleep(50); // widen the race window so the two transactions overlap
      await tx`UPDATE itest_counter SET value = ${current + 1} WHERE id = 1`;
    });

  await Promise.all([bump(), bump()]);

  const rows = await sql<{ value: number }[]>`
    SELECT value FROM itest_counter WHERE id = 1
  `;
  const value = rows[0]?.value ?? -1;
  record(
    'serializable retry',
    value === 2 && attempts >= 3,
    `final=${value} (want 2), transaction attempts=${attempts} (>=3 proves a 40001 retry happened)`,
  );
}

async function checkTransactionalEnqueue(sql: Sql): Promise<void> {
  const before = await countNoopJobs(sql);

  let rolledBack = false;
  try {
    await sql.begin(async (tx) => {
      await addJobInTx(tx, 'noop', { seq: -1 });
      throw new Error('deliberate rollback');
    });
  } catch (error) {
    rolledBack =
      error instanceof Error && error.message === 'deliberate rollback';
  }
  const afterRollback = await countNoopJobs(sql);

  await sql.begin(async (tx) => {
    await addJobInTx(tx, 'noop', { seq: 0 });
  });
  const afterCommit = await countNoopJobs(sql);

  record(
    'transactional enqueue',
    rolledBack && afterRollback === before && afterCommit === before + 1,
    `rollback leaked ${afterRollback - before} jobs (want 0); commit added ${afterCommit - before} (want 1)`,
  );
}

async function checkPickupLatency(sql: Sql, boss: PgBoss): Promise<void> {
  const waiters = new Map<number, (latencyMs: number) => void>();

  // Production task list plus an instrumented noop probe — the org.scaffold
  // drain later in the run goes through the real handler.
  await startWorker({
    boss,
    concurrency: 4,
    taskList: {
      ...createTaskList({ sql }),
      noop: (payload) => {
        const parsed = noopPayloadSchema.safeParse(payload);
        if (
          parsed.success &&
          parsed.data.seq !== undefined &&
          parsed.data.sentAtMs !== undefined
        ) {
          waiters.get(parsed.data.seq)?.(Date.now() - parsed.data.sentAtMs);
        }
        return Promise.resolve();
      },
    },
  });

  const iterations = 20;
  const latencies: number[] = [];
  for (let seq = 1; seq <= iterations; seq += 1) {
    const latency = new Promise<number>((resolve) => {
      waiters.set(seq, resolve);
    });
    await transactSerializable(sql, async (tx) => {
      await tx`UPDATE itest_counter SET value = value + 1 WHERE id = 1`;
      await addJobInTx(tx, 'noop', { seq, sentAtMs: Date.now() });
    });
    const ms = await Promise.race([
      latency,
      sleep(5_000).then(() => Number.NaN),
    ]);
    latencies.push(ms);
    waiters.delete(seq);
  }

  const valid = latencies
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const p50 = percentile(valid, 50);
  const p95 = percentile(valid, 95);
  record(
    'worker pickup latency',
    valid.length === iterations && p95 < 1_000,
    `n=${valid.length}/${iterations}, p50=${p50}ms, p95=${p95}ms (enqueue-tx-start → handler wake; gate p95<1000ms)`,
  );
}

interface SseEvent {
  event: string;
  id: string | null;
  data: string;
}

/** Minimal SSE client: collects events until aborted. */
function connectSse(
  url: string,
  headers: Record<string, string>,
): { events: SseEvent[]; abort: () => void; done: Promise<void> } {
  const controller = new AbortController();
  const events: SseEvent[] = [];

  const done = (async () => {
    const response = await fetch(url, { signal: controller.signal, headers });
    const body = response.body;
    if (!body) {
      throw new Error('SSE response has no body');
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        let id: string | null = null;
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('id:')) {
            id = line.slice(3).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        events.push({ event, id, data: dataLines.join('\n') });
        boundary = buffer.indexOf('\n\n');
      }
    }
  })().catch((error: unknown) => {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }
  });

  return { events, abort: () => controller.abort(), done };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(50);
  }
  return predicate();
}

function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
}

async function checkAuthAndSse(
  sql: Sql,
  base: string,
  orgSuffix: string,
): Promise<{ cookie: string; orgId: string; userId: string }> {
  // 5a. No session → 401.
  const unauthed = await fetch(`${base}/events?orgId=whatever`);
  record(
    'events requires session',
    unauthed.status === 401,
    `GET /events without a session → ${unauthed.status} (want 401)`,
  );

  // 5b. Sign-up creates a session.
  const email = `itest-${orgSuffix}@example.com`;
  // Better Auth rejects POSTs without an Origin header (CSRF policy); browsers
  // always send one, so the test client must too.
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email, password: 'itest-password-1', name: 'IT' }),
  });
  const cookie = cookieHeaderFrom(signUp);
  const signUpBody = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await signUp.json());
  const userId = signUpBody.success ? signUpBody.data.user.id : '';
  record(
    'sign-up issues session',
    signUp.ok && cookie.length > 0 && userId.length > 0,
    `sign-up → ${signUp.status}, cookie=${cookie.length > 0 ? 'present' : 'MISSING'}, userId=${userId || 'MISSING'}`,
  );

  // 5c. Create an organization through the org plugin.
  const createOrg = await fetch(`${base}/api/auth/organization/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: base },
    body: JSON.stringify({
      name: `ITest ${orgSuffix}`,
      slug: `itest-${orgSuffix}`,
    }),
  });
  const orgBody = z
    .object({ id: z.string().optional() })
    .safeParse(await createOrg.json());
  const orgId = orgBody.success ? (orgBody.data.id ?? '') : '';
  record(
    'organization create',
    createOrg.ok && orgId.length > 0,
    `create org → ${createOrg.status}, id=${orgId || 'MISSING'}`,
  );

  // 5d. Wrong org → 403.
  const forbidden = await fetch(`${base}/events?orgId=not-my-org`, {
    headers: { cookie },
  });
  record(
    'events rejects non-member org',
    forbidden.status === 403,
    `GET /events for a non-member org → ${forbidden.status} (want 403)`,
  );

  // 5e. Member org → live stream + Last-Event-ID replay without duplicates.
  const url = `${base}/events?orgId=${orgId}`;
  const first = connectSse(url, { cookie });
  await sleep(500); // let the stream establish its tail cursor

  await sql.begin(async (tx) => {
    await emitHintInTx(tx, { orgId, entity: 'task', entityId: 't1' });
  });
  const liveOk = await waitFor(
    () => first.events.some((e) => e.event === 'hint' && e.data.includes('t1')),
    3_000,
  );
  const lastId = [...first.events].reverse().find((e) => e.id)?.id ?? null;
  first.abort();
  await first.done;

  await sql.begin(async (tx) => {
    await emitHintInTx(tx, { orgId, entity: 'task', entityId: 't2' });
  });
  const second = connectSse(url, {
    cookie,
    ...(lastId ? { 'Last-Event-ID': lastId } : {}),
  });
  const replayOk = await waitFor(
    () =>
      second.events.some((e) => e.event === 'hint' && e.data.includes('t2')),
    3_000,
  );
  const noDuplicate = !second.events.some((e) => e.data.includes('"t1"'));
  second.abort();
  await second.done;

  record(
    'authorized outbox → SSE',
    liveOk && replayOk && noDuplicate,
    `live=${liveOk}, resume-replay=${replayOk}, no-duplicate-on-resume=${noDuplicate}`,
  );

  return { cookie, orgId, userId };
}

/**
 * The notifications vertical slice (org-audience bell): serializable write +
 * org-wide hint → SSE delivery → role-gated API reads → dedupe → mark-read.
 */
async function checkNotifications(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const api = `${base}/api/app/notifications`;
  const withOrg = (route: string): string => `${api}${route}?orgId=${orgId}`;

  const stream = connectSse(`${base}/events?orgId=${orgId}`, { cookie });
  await sleep(500);

  // Org-audience write inside a serializable transaction (the producer
  // pattern every domain uses — no job hop for the bell itself).
  await transactSerializable(sql, (tx) =>
    writeNotificationForOrgs(tx, {
      organizationIds: [orgId],
      category: 'system',
      severity: 'info',
      titleKey: 'itestHello',
      bodyKey: 'itestHelloBody',
      params: { n: 1 },
      dedupeKey: 'itest:hello:1',
    }),
  );
  const hintOk = await waitFor(
    () =>
      stream.events.some(
        (e) => e.event === 'hint' && e.data.includes('notification'),
      ),
    5_000,
  );
  stream.abort();
  await stream.done;

  const countAfterCreate = z
    .object({ count: z.number() })
    .safeParse(
      await (
        await fetch(withOrg('/unread-count'), { headers: { cookie } })
      ).json(),
    );
  const listBody = z
    .object({
      items: z.array(
        z.object({ id: z.string(), titleKey: z.string(), read: z.boolean() }),
      ),
      nextCursor: z
        .object({ createdAt: z.number(), id: z.string() })
        .nullable(),
    })
    .safeParse(
      await (await fetch(withOrg(''), { headers: { cookie } })).json(),
    );
  const firstItem = listBody.success ? listBody.data.items[0] : undefined;
  record(
    'notification write → hint → list',
    hintOk &&
      countAfterCreate.success &&
      countAfterCreate.data.count === 1 &&
      firstItem?.titleKey === 'itestHello' &&
      !firstItem.read,
    `hint=${hintOk}, unread=${countAfterCreate.success ? countAfterCreate.data.count : 'ERR'}, first=${firstItem?.titleKey ?? 'none'}`,
  );

  // Dedupe: the same dedupeKey written again must be a no-op.
  await transactSerializable(sql, (tx) =>
    writeNotificationForOrgs(tx, {
      organizationIds: [orgId],
      category: 'system',
      severity: 'info',
      titleKey: 'itestHello',
      bodyKey: 'itestHelloBody',
      params: { n: 2 },
      dedupeKey: 'itest:hello:1',
    }),
  );
  const countAfterDupe = z
    .object({ count: z.number() })
    .safeParse(
      await (
        await fetch(withOrg('/unread-count'), { headers: { cookie } })
      ).json(),
    );
  record(
    'notification dedupe under redelivery',
    countAfterDupe.success && countAfterDupe.data.count === 1,
    `unread after duplicate dedupeKey=${countAfterDupe.success ? countAfterDupe.data.count : 'ERR'} (want 1)`,
  );

  // Mark read via the API; unread returns to 0.
  const readRes = await fetch(
    `${api}/${firstItem?.id ?? '0'}/read?orgId=${orgId}`,
    { method: 'POST', headers: { cookie, origin: base } },
  );
  const countAfterRead = z
    .object({ count: z.number() })
    .safeParse(
      await (
        await fetch(withOrg('/unread-count'), { headers: { cookie } })
      ).json(),
    );
  record(
    'notification mark-read',
    readRes.ok && countAfterRead.success && countAfterRead.data.count === 0,
    `read → ${readRes.status}, unread=${countAfterRead.success ? countAfterRead.data.count : 'ERR'} (want 0)`,
  );
}

/**
 * Identity-domain smoke: the users/organizations/members/user-preferences/
 * audit-log surfaces, end to end through the HTTP routes (session +
 * membership gates included). Runs BEFORE the throttle check so the audit
 * rows it writes are covered by the final chain verification.
 */
async function checkIdentityDomains(
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  email: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();
  const post = (route: string, body: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify(body),
    });

  const me = z
    .object({ user: z.object({ userId: z.string(), email: z.string() }) })
    .safeParse(await get('/api/app/users/me'));
  const hasAny = z
    .object({ hasAny: z.boolean() })
    .safeParse(await get('/api/app/users/has-any'));
  record(
    'users me + has-any',
    me.success &&
      me.data.user.userId === userId &&
      me.data.user.email === email &&
      hasAny.success &&
      hasAny.data.hasAny,
    `me=${me.success ? me.data.user.email : 'ERR'}, hasAny=${hasAny.success ? hasAny.data.hasAny : 'ERR'}`,
  );

  const switchRes = await post(
    `/api/app/organizations/${orgId}/record-switch`,
    {},
  );
  const lastActive = z
    .object({ organizationId: z.string().nullable() })
    .safeParse(await get('/api/app/users/last-active-org'));
  record(
    'org record-switch + last-active pointer',
    switchRes.ok &&
      lastActive.success &&
      lastActive.data.organizationId === orgId,
    `switch → ${switchRes.status}, lastActive=${lastActive.success ? lastActive.data.organizationId : 'ERR'}`,
  );

  const members = z
    .object({
      members: z.array(
        z.object({
          userId: z.string(),
          role: z.string(),
          email: z.string().nullable(),
        }),
      ),
    })
    .safeParse(await get(`/api/app/members?orgId=${orgId}`));
  const memberMe = z
    .object({ status: z.literal('ok'), role: z.string(), isAdmin: z.boolean() })
    .safeParse(await get(`/api/app/members/me?orgId=${orgId}`));
  record(
    'members list + me context',
    members.success &&
      members.data.members.length === 1 &&
      members.data.members[0]?.role === 'owner' &&
      memberMe.success &&
      memberMe.data.role === 'owner' &&
      memberMe.data.isAdmin,
    `members=${members.success ? members.data.members.length : 'ERR'}, meRole=${memberMe.success ? memberMe.data.role : 'ERR'}`,
  );

  const setPrefs = await post(
    `/api/app/user-preferences/custom-instructions?orgId=${orgId}`,
    { customInstructions: 'Prefer concise answers.' },
  );
  const prefs = z
    .object({
      preferences: z.object({ customInstructions: z.string() }).nullable(),
    })
    .safeParse(await get(`/api/app/user-preferences?orgId=${orgId}`));
  record(
    'user preferences roundtrip',
    setPrefs.ok &&
      prefs.success &&
      prefs.data.preferences?.customInstructions === 'Prefer concise answers.',
    `set → ${setPrefs.status}, read=${prefs.success ? JSON.stringify(prefs.data.preferences?.customInstructions) : 'ERR'}`,
  );

  const audits = z
    .object({ items: z.array(z.object({ action: z.string() })) })
    .safeParse(await get(`/api/app/audit-logs?orgId=${orgId}`));
  record(
    'audit-log list route',
    audits.success &&
      audits.data.items.some((i) => i.action === 'signed_in_to_organization'),
    `items=${audits.success ? audits.data.items.length : 'ERR'}`,
  );
}

/**
 * Projects vertical: create → read/overview → settings → agents CRUD →
 * pin/archive/restore → search → delete, through the HTTP surface (access
 * gates + audit writes + rate charges included).
 */
async function checkProjects(
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const api = `${base}/api/app/projects`;
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${api}${route}`, { headers: { cookie } })).json();
  const send = (
    method: 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${api}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const created = z.object({ projectId: z.string() }).safeParse(
    await (
      await send('POST', `?orgId=${orgId}`, {
        name: 'Integration Project',
        description: 'itest',
        externalItemId: 'itest-ext-1',
      })
    ).json(),
  );
  const projectId = created.success ? created.data.projectId : '';
  const dupExternal = await send('POST', `?orgId=${orgId}`, {
    name: 'Second Project',
    externalItemId: 'itest-ext-1',
  });
  const fetched = z
    .object({
      project: z.object({
        name: z.string(),
        key: z.string().nullable(),
        openTaskCount: z.number(),
      }),
    })
    .safeParse(await get(`/${projectId}?orgId=${orgId}`));
  record(
    'project create + read + external-id uniqueness',
    created.success &&
      fetched.success &&
      fetched.data.project.name === 'Integration Project' &&
      (fetched.data.project.key?.length ?? 0) >= 2 &&
      dupExternal.status === 400,
    `id=${projectId || 'ERR'}, key=${fetched.success ? fetched.data.project.key : 'ERR'}, dupExternal → ${dupExternal.status} (want 400)`,
  );

  const agentCreated = z.object({ agentId: z.string() }).safeParse(
    await (
      await send('POST', `/${projectId}/agents?orgId=${orgId}`, {
        name: 'Research Bot',
        harness: 'claude-code',
        model: 'anthropic/claude-fable-5',
        skills: ['web-research'],
        connectors: [],
      })
    ).json(),
  );
  const agents = z
    .object({
      agents: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .safeParse(await get(`/${projectId}/agents?orgId=${orgId}`));
  const overview = z
    .object({
      projects: z.array(
        z.object({ id: z.string(), projectAgentCount: z.number() }),
      ),
    })
    .safeParse(await get(`/overview?orgId=${orgId}`));
  const overviewRow = overview.success
    ? overview.data.projects.find((p) => p.id === projectId)
    : undefined;
  record(
    'project agent create + rollup',
    agentCreated.success &&
      agents.success &&
      agents.data.agents.length === 1 &&
      overviewRow?.projectAgentCount === 1,
    `agents=${agents.success ? agents.data.agents.length : 'ERR'}, rollup=${overviewRow?.projectAgentCount ?? 'ERR'}`,
  );

  const archived = await send('POST', `/${projectId}/archive?orgId=${orgId}`);
  const listAfterArchive = z
    .object({ projects: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`?orgId=${orgId}`));
  const restored = await send('POST', `/${projectId}/restore?orgId=${orgId}`);
  const searched = z
    .object({ projects: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`/search?orgId=${orgId}&q=Integration`));
  record(
    'project archive/restore + search',
    archived.ok &&
      listAfterArchive.success &&
      !listAfterArchive.data.projects.some((p) => p.id === projectId) &&
      restored.ok &&
      searched.success &&
      searched.data.projects.some((p) => p.id === projectId),
    `archive → ${archived.status}, hidden=${listAfterArchive.success ? !listAfterArchive.data.projects.some((p) => p.id === projectId) : 'ERR'}, search hits=${searched.success ? searched.data.projects.length : 'ERR'}`,
  );

  const badDelete = await send('DELETE', `/${projectId}?orgId=${orgId}`, {
    mode: 'cascade',
    confirmPhrase: 'wrong name',
  });
  const deleted = await send('DELETE', `/${projectId}?orgId=${orgId}`, {
    mode: 'detach',
  });
  const gone = await fetch(`${api}/${projectId}?orgId=${orgId}`, {
    headers: { cookie },
  });
  record(
    'project delete (confirm gate + detach)',
    badDelete.status === 400 && deleted.ok && gone.status === 404,
    `cascade w/ wrong phrase → ${badDelete.status} (want 400), detach → ${deleted.status}, read-after → ${gone.status} (want 404)`,
  );
}

/**
 * Task board vertical: create (label resolve + numbering + rollups) →
 * subtask close-guard → status transitions with project rollups → rank move
 * → dependency cycle rejection → activity trail → archive.
 */
async function checkTasks(
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const get = async (path2: string): Promise<unknown> =>
    (await fetch(`${base}${path2}`, { headers: { cookie } })).json();
  const send = (
    method: 'POST' | 'DELETE',
    path2: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${path2}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const proj = z.object({ projectId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/projects?orgId=${orgId}`, {
        name: 'Task Board Project',
      })
    ).json(),
  );
  const projectId = proj.success ? proj.data.projectId : '';

  const parent = z.object({ taskId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Parent task',
        labels: ['bug'],
        status: 'todo',
      })
    ).json(),
  );
  const parentId = parent.success ? parent.data.taskId : '';
  const child = z.object({ taskId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Child task',
        parentTaskId: parentId,
        status: 'todo',
      })
    ).json(),
  );
  const childId = child.success ? child.data.taskId : '';
  const taskRead = z
    .object({
      task: z.object({ number: z.number(), status: z.string() }),
      labels: z.array(z.object({ name: z.string() })),
    })
    .safeParse(await get(`/api/app/tasks/${parentId}?orgId=${orgId}`));
  record(
    'task create + numbering + label resolve',
    parent.success &&
      child.success &&
      taskRead.success &&
      taskRead.data.task.number === 1 &&
      taskRead.data.labels[0]?.name === 'bug',
    `parent #${taskRead.success ? taskRead.data.task.number : 'ERR'}, labels=${taskRead.success ? taskRead.data.labels.map((l) => l.name).join(',') : 'ERR'}`,
  );

  // Terminal parent while the child is open must be refused.
  const blockedClose = await send(
    'POST',
    `/api/app/tasks/${parentId}/status?orgId=${orgId}`,
    { status: 'done' },
  );
  await send('POST', `/api/app/tasks/${childId}/status?orgId=${orgId}`, {
    status: 'done',
  });
  const parentClose = await send(
    'POST',
    `/api/app/tasks/${parentId}/status?orgId=${orgId}`,
    { status: 'done' },
  );
  const overview = z
    .object({
      projects: z.array(
        z.object({
          id: z.string(),
          openTaskCount: z.number(),
          doneTaskCount: z.number(),
        }),
      ),
    })
    .safeParse(await get(`/api/app/projects/overview?orgId=${orgId}`));
  const row = overview.success
    ? overview.data.projects.find((p) => p.id === projectId)
    : undefined;
  record(
    'task subtask guard + rollup transition',
    blockedClose.status === 400 &&
      parentClose.ok &&
      row?.openTaskCount === 0 &&
      row.doneTaskCount === 2,
    `close-with-open-child → ${blockedClose.status} (want 400); rollups open=${row?.openTaskCount} done=${row?.doneTaskCount} (want 0/2)`,
  );

  // Dependencies: a → b, then b → a must be rejected as a cycle.
  const t1 = z.object({ taskId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Dep A',
      })
    ).json(),
  );
  const t2 = z.object({ taskId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Dep B',
      })
    ).json(),
  );
  const aId = t1.success ? t1.data.taskId : '';
  const bId = t2.success ? t2.data.taskId : '';
  const dep = await send('POST', `/api/app/tasks/dependencies?orgId=${orgId}`, {
    blockerTaskId: aId,
    blockedTaskId: bId,
  });
  const cycle = await send(
    'POST',
    `/api/app/tasks/dependencies?orgId=${orgId}`,
    { blockerTaskId: bId, blockedTaskId: aId },
  );
  const claim = await send(
    'POST',
    `/api/app/tasks/${aId}/claim?orgId=${orgId}`,
  );
  const activity = z
    .object({ activity: z.array(z.object({ action: z.string() })) })
    .safeParse(await get(`/api/app/tasks/${aId}/activity?orgId=${orgId}`));
  const actions = activity.success
    ? activity.data.activity.map((a) => a.action)
    : [];
  record(
    'task dependencies + claim + activity',
    dep.ok &&
      cycle.status === 400 &&
      claim.ok &&
      actions.includes('created') &&
      actions.includes('claimed'),
    `dep → ${dep.status}, cycle → ${cycle.status} (want 400), claim → ${claim.status}, activity=${actions.join('/')}`,
  );

  // Comments on the message store: add ×2 → list → edit → delete → count.
  const c1 = z
    .object({ messageId: z.string(), threadId: z.string() })
    .safeParse(
      await (
        await send('POST', `/api/app/tasks/${aId}/comments?orgId=${orgId}`, {
          body: 'First comment',
        })
      ).json(),
    );
  await send('POST', `/api/app/tasks/${aId}/comments?orgId=${orgId}`, {
    body: 'Second comment',
  });
  const edited = await send(
    'POST',
    `/api/app/tasks/comments/${c1.success ? c1.data.messageId : ''}?orgId=${orgId}`,
    { body: 'First comment (edited)' },
  );
  const listed = z
    .object({
      comments: z.array(
        z.object({
          messageId: z.string(),
          body: z.string(),
          editedAt: z.number().nullable(),
        }),
      ),
    })
    .safeParse(await get(`/api/app/tasks/${aId}/comments?orgId=${orgId}`));
  const removed = await send(
    'DELETE',
    `/api/app/tasks/comments/${c1.success ? c1.data.messageId : ''}?orgId=${orgId}`,
  );
  const afterDelete = z
    .object({
      comments: z.array(z.object({ body: z.string() })),
    })
    .safeParse(await get(`/api/app/tasks/${aId}/comments?orgId=${orgId}`));
  const taskAfter = z
    .object({ task: z.object({ commentCount: z.number() }) })
    .safeParse(await get(`/api/app/tasks/${aId}?orgId=${orgId}`));
  record(
    'task comments (message store) add/edit/delete + count',
    c1.success &&
      edited.ok &&
      listed.success &&
      listed.data.comments.length === 2 &&
      listed.data.comments[0]?.body === 'First comment (edited)' &&
      listed.data.comments[0]?.editedAt !== null &&
      removed.ok &&
      afterDelete.success &&
      afterDelete.data.comments.length === 1 &&
      taskAfter.success &&
      taskAfter.data.task.commentCount === 1,
    `list=${listed.success ? listed.data.comments.length : 'ERR'}, first=${listed.success ? JSON.stringify(listed.data.comments[0]?.body) : 'ERR'}, afterDelete=${afterDelete.success ? afterDelete.data.comments.length : 'ERR'}, count=${taskAfter.success ? taskAfter.data.task.commentCount : 'ERR'}`,
  );
}

/**
 * Files vertical against a REAL S3-compatible store (MinIO): seed the
 * deployment-default connection into the config tree, create the bucket,
 * then run handoff → presigned PUT → register (HEAD-verified) → presigned
 * GET round-trip → delete. Gated on ITEST_S3_ENDPOINT — recorded as skipped
 * (visibly, never silently) when no store is provided.
 */
async function checkFiles(
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const endpoint = process.env.ITEST_S3_ENDPOINT;
  if (!endpoint) {
    record(
      'files upload/serve/delete (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — S3 lanes not exercised in this run',
    );
    return;
  }
  const accessKeyId = process.env.ITEST_S3_ACCESS_KEY ?? 'minioadmin';
  const secretAccessKey = process.env.ITEST_S3_SECRET_KEY ?? 'minioadmin';
  const bucket = 'itest-blobs';

  // Deployment-default connection under the `default` config tree.
  const configRoot = process.env.TALE_CONFIG_DIR;
  if (!configRoot) {
    record('files upload/serve/delete', false, 'TALE_CONFIG_DIR unset');
    return;
  }
  const dir = path.join(configRoot, 'default', 'object-storage');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'connection.json'),
    JSON.stringify({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      bucket,
    }),
  );
  await writeFile(
    path.join(dir, 'connection.secrets.json'),
    JSON.stringify({ accessKeyId, secretAccessKey }),
  );

  // Create the bucket with a signed request (idempotent-ish: 409 = exists).
  const { AwsClient } = await import('aws4fetch');
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: 'us-east-1',
    service: 's3',
  });
  const createBucket = await aws.fetch(`${endpoint}/${bucket}`, {
    method: 'PUT',
  });
  if (!createBucket.ok && createBucket.status !== 409) {
    record(
      'files upload/serve/delete',
      false,
      `bucket create failed: ${createBucket.status}`,
    );
    return;
  }

  const { cookie, orgId } = ctx;
  const send = (
    method: 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const payload = `itest file body ${Date.now()}`;
  const handoff = z
    .object({ storageRef: z.string(), uploadUrl: z.string().url() })
    .safeParse(
      await (
        await send('POST', `/api/app/files/upload-handoff?orgId=${orgId}`, {
          contentType: 'text/plain',
          size: payload.length,
        })
      ).json(),
    );
  if (!handoff.success) {
    record('files upload/serve/delete', false, 'handoff failed');
    return;
  }
  const put = await fetch(handoff.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: payload,
  });
  const registered = z
    .object({ fileId: z.string(), size: z.number() })
    .safeParse(
      await (
        await send('POST', `/api/app/files/register?orgId=${orgId}`, {
          storageRef: handoff.data.storageRef,
          fileName: 'itest.txt',
          contentType: 'text/plain',
        })
      ).json(),
    );
  const fileId = registered.success ? registered.data.fileId : '';
  const urlRes = z.object({ url: z.string().url() }).safeParse(
    await (
      await fetch(`${base}/api/app/files/${fileId}/url?orgId=${orgId}`, {
        headers: { cookie },
      })
    ).json(),
  );
  const roundTrip = urlRes.success
    ? await (await fetch(urlRes.data.url)).text()
    : '';
  const deleted = await send(
    'DELETE',
    `/api/app/files/${fileId}?orgId=${orgId}`,
  );
  const blobGone = urlRes.success
    ? (await fetch(urlRes.data.url)).status === 404
    : false;
  record(
    'files upload/serve/delete',
    put.ok &&
      registered.success &&
      registered.data.size === payload.length &&
      roundTrip === payload &&
      deleted.ok &&
      blobGone,
    `put → ${put.status}, size=${registered.success ? registered.data.size : 'ERR'}, roundtrip=${roundTrip === payload}, delete → ${deleted.status}, blobGone=${blobGone}`,
  );
}

/**
 * Document Hub vertical (needs the S3 store from checkFiles): upload →
 * document bind → hub visibility → folder tree (nesting, name clash,
 * non-empty delete guard) → project attach/detach scope flips → trash.
 */
async function checkDocuments(
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'documents + folders (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — document lanes not exercised in this run',
    );
    return;
  }
  const { cookie, orgId } = ctx;
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();
  const send = (
    method: 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // Upload + register a blob to bind.
  const handoff = z
    .object({ storageRef: z.string(), uploadUrl: z.string().url() })
    .safeParse(
      await (
        await send('POST', `/api/app/files/upload-handoff?orgId=${orgId}`, {
          contentType: 'text/plain',
          size: 11,
        })
      ).json(),
    );
  if (!handoff.success) {
    record('documents + folders', false, 'upload handoff failed');
    return;
  }
  await fetch(handoff.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'hello docs!',
  });
  const registered = z.object({ fileId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/files/register?orgId=${orgId}`, {
        storageRef: handoff.data.storageRef,
        fileName: 'notes.txt',
        contentType: 'text/plain',
      })
    ).json(),
  );
  const created = z.object({ documentId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/documents/from-upload?orgId=${orgId}`, {
        fileId: registered.success ? registered.data.fileId : '',
        fileName: 'notes.txt',
      })
    ).json(),
  );
  const documentId = created.success ? created.data.documentId : '';
  const hubList = z
    .object({ documents: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`/api/app/documents?orgId=${orgId}`));
  const docUrl = z
    .object({ url: z.string().url() })
    .safeParse(
      await get(`/api/app/documents/${documentId}/url?orgId=${orgId}`),
    );
  const body = docUrl.success
    ? await (await fetch(docUrl.data.url)).text()
    : '';
  record(
    'document bind + hub visibility + serve',
    created.success &&
      hubList.success &&
      hubList.data.documents.some((d) => d.id === documentId) &&
      body === 'hello docs!',
    `doc=${documentId || 'ERR'}, hub=${hubList.success ? hubList.data.documents.length : 'ERR'}, serve=${JSON.stringify(body)}`,
  );

  // Folder tree: create, nest, clash, move doc in, non-empty delete guard.
  const rootFolder = z.object({ folderId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/folders?orgId=${orgId}`, {
        name: 'Contracts',
      })
    ).json(),
  );
  const rootId = rootFolder.success ? rootFolder.data.folderId : '';
  const clash = await send('POST', `/api/app/folders?orgId=${orgId}`, {
    name: 'contracts',
  });
  const child = z.object({ folderId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/folders?orgId=${orgId}`, {
        name: '2026',
        parentId: rootId,
      })
    ).json(),
  );
  const moved = await send(
    'POST',
    `/api/app/documents/${documentId}?orgId=${orgId}`,
    {
      folderId: child.success ? child.data.folderId : '',
    },
  );
  const nonEmptyDelete = await send(
    'DELETE',
    `/api/app/folders/${rootId}?orgId=${orgId}`,
  );
  const crumb = z
    .object({ breadcrumb: z.array(z.object({ name: z.string() })) })
    .safeParse(
      await get(
        `/api/app/folders/${child.success ? child.data.folderId : ''}/breadcrumb?orgId=${orgId}`,
      ),
    );
  record(
    'folder tree + clash + non-empty guard',
    rootFolder.success &&
      clash.status === 400 &&
      child.success &&
      moved.ok &&
      nonEmptyDelete.status === 400 &&
      crumb.success &&
      crumb.data.breadcrumb.map((f) => f.name).join('/') === 'Contracts/2026',
    `clash → ${clash.status} (want 400), move → ${moved.status}, non-empty delete → ${nonEmptyDelete.status} (want 400), crumb=${crumb.success ? crumb.data.breadcrumb.map((f) => f.name).join('/') : 'ERR'}`,
  );

  // Project attach flips the doc out of the hub; detach restores it.
  const proj = z.object({ projectId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/projects?orgId=${orgId}`, {
        name: 'Docs Project',
      })
    ).json(),
  );
  const projectId = proj.success ? proj.data.projectId : '';
  const attach = await send(
    'POST',
    `/api/app/documents/${documentId}/attach-to-project?orgId=${orgId}`,
    { projectId },
  );
  const hubAfterAttach = z
    .object({ documents: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`/api/app/documents?orgId=${orgId}`));
  const projDocs = z
    .object({ documents: z.array(z.object({ id: z.string() })) })
    .safeParse(
      await get(`/api/app/documents/by-project/${projectId}?orgId=${orgId}`),
    );
  const detach = await send(
    'POST',
    `/api/app/documents/${documentId}/detach-from-project?orgId=${orgId}`,
  );
  const trash = await send(
    'POST',
    `/api/app/documents/${documentId}/trash?orgId=${orgId}`,
  );
  const hubAfterTrash = z
    .object({ documents: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`/api/app/documents?orgId=${orgId}`));
  record(
    'document project attach/detach + trash',
    attach.ok &&
      hubAfterAttach.success &&
      !hubAfterAttach.data.documents.some((d) => d.id === documentId) &&
      projDocs.success &&
      projDocs.data.documents.some((d) => d.id === documentId) &&
      detach.ok &&
      trash.ok &&
      hubAfterTrash.success &&
      !hubAfterTrash.data.documents.some((d) => d.id === documentId),
    `attach → ${attach.status}, hubHidden=${hubAfterAttach.success ? !hubAfterAttach.data.documents.some((d) => d.id === documentId) : 'ERR'}, inProject=${projDocs.success ? projDocs.data.documents.some((d) => d.id === documentId) : 'ERR'}, trashHidden=${hubAfterTrash.success ? !hubAfterTrash.data.documents.some((d) => d.id === documentId) : 'ERR'}`,
  );
}

/**
 * Small-domain smoke: contacts CRUD + find-or-create shape, message
 * feedback upsert/toggle/stats, support case lifecycle.
 */
async function checkSmallDomains(
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();
  const send = (
    method: 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // Contacts.
  const contact = z.object({ contactId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/contacts?orgId=${orgId}`, {
        name: 'Ada Lovelace',
        email: 'Ada@Example.com',
        source: 'manual_import',
        tags: ['vip'],
      })
    ).json(),
  );
  const contactId = contact.success ? contact.data.contactId : '';
  const found = z
    .object({
      items: z.array(
        z.object({ id: z.string(), email: z.string().nullable() }),
      ),
    })
    .safeParse(await get(`/api/app/contacts?orgId=${orgId}&search=lovelace`));
  const updated = await send(
    'POST',
    `/api/app/contacts/${contactId}?orgId=${orgId}`,
    {
      phone: '+49 30 1234',
    },
  );
  const trashed = await send(
    'DELETE',
    `/api/app/contacts/${contactId}?orgId=${orgId}`,
  );
  const afterTrash = z
    .object({ items: z.array(z.object({ id: z.string() })) })
    .safeParse(await get(`/api/app/contacts?orgId=${orgId}`));
  record(
    'contacts CRUD + normalization + trash',
    contact.success &&
      found.success &&
      found.data.items[0]?.email === 'ada@example.com' &&
      updated.ok &&
      trashed.ok &&
      afterTrash.success &&
      !afterTrash.data.items.some((i) => i.id === contactId),
    `email=${found.success ? found.data.items[0]?.email : 'ERR'} (want normalized), trashHidden=${afterTrash.success ? !afterTrash.data.items.some((i) => i.id === contactId) : 'ERR'}`,
  );

  // Message feedback: vote → toggle → stats reflect one negative.
  await send('POST', `/api/app/feedback?orgId=${orgId}`, {
    threadId: 'itest-thread',
    messageId: 'itest-msg-1',
    rating: 'positive',
  });
  await send('POST', `/api/app/feedback?orgId=${orgId}`, {
    threadId: 'itest-thread',
    messageId: 'itest-msg-1',
    rating: 'negative',
    comment: 'wrong answer',
  });
  const stats = z
    .object({
      items: z.array(z.object({ rating: z.string() })),
      stats: z.object({ positive: z.number(), negative: z.number() }),
    })
    .safeParse(await get(`/api/app/feedback?orgId=${orgId}`));
  record(
    'message feedback upsert + stats',
    stats.success &&
      stats.data.items.length === 1 &&
      stats.data.stats.negative === 1 &&
      stats.data.stats.positive === 0,
    `items=${stats.success ? stats.data.items.length : 'ERR'} (want 1 after toggle), stats=${stats.success ? JSON.stringify(stats.data.stats) : 'ERR'}`,
  );

  // Products: unique-name conflict + translation upsert.
  const product = z.object({ productId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/products?orgId=${orgId}`, {
        name: 'Widget Pro',
        price: 99.5,
        currency: 'EUR',
        status: 'active',
      })
    ).json(),
  );
  const productId = product.success ? product.data.productId : '';
  const dupName = await send('POST', `/api/app/products?orgId=${orgId}`, {
    name: '  widget pro ',
  });
  await send(
    'POST',
    `/api/app/products/${productId}/translations?orgId=${orgId}`,
    {
      language: 'de',
      name: 'Widget Profi',
    },
  );
  const productRead = z
    .object({
      product: z.object({
        name: z.string(),
        translations: z
          .array(
            z.object({ language: z.string(), name: z.string().optional() }),
          )
          .nullable(),
      }),
    })
    .safeParse(await get(`/api/app/products/${productId}?orgId=${orgId}`));
  record(
    'products unique name + translation upsert',
    product.success &&
      dupName.status === 400 &&
      productRead.success &&
      productRead.data.product.translations?.[0]?.name === 'Widget Profi',
    `dup → ${dupName.status} (want 400), de=${productRead.success ? productRead.data.product.translations?.[0]?.name : 'ERR'}`,
  );

  // Support case lifecycle.
  const supportCase = z.object({ caseId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/support-cases?orgId=${orgId}`, {
        subject: 'Printer on fire',
        priority: 'urgent',
        requesterEmail: 'customer@example.com',
      })
    ).json(),
  );
  const caseId = supportCase.success ? supportCase.data.caseId : '';
  await send(
    'POST',
    `/api/app/support-cases/${caseId}/comments?orgId=${orgId}`,
    {
      body: 'Looking into it.',
    },
  );
  await send(
    'POST',
    `/api/app/support-cases/${caseId}/escalate?orgId=${orgId}`,
  );
  await send('POST', `/api/app/support-cases/${caseId}/status?orgId=${orgId}`, {
    status: 'resolved',
  });
  const caseRead = z
    .object({
      supportCase: z.object({
        status: z.string(),
        escalationLevel: z.number().nullable(),
        commentCount: z.number(),
        firstRespondedAt: z.number().nullable(),
        resolvedAt: z.number().nullable(),
      }),
      comments: z.array(z.object({ body: z.string() })),
      activity: z.array(z.object({ action: z.string() })),
    })
    .safeParse(await get(`/api/app/support-cases/${caseId}?orgId=${orgId}`));
  const caseActions = caseRead.success
    ? caseRead.data.activity.map((a) => a.action)
    : [];
  record(
    'support case lifecycle',
    caseRead.success &&
      caseRead.data.supportCase.status === 'resolved' &&
      caseRead.data.supportCase.escalationLevel === 1 &&
      caseRead.data.supportCase.commentCount === 1 &&
      caseRead.data.supportCase.firstRespondedAt !== null &&
      caseRead.data.supportCase.resolvedAt !== null &&
      caseActions.includes('created') &&
      caseActions.includes('escalated') &&
      caseActions.includes('status.changed'),
    `status=${caseRead.success ? caseRead.data.supportCase.status : 'ERR'}, escalation=${caseRead.success ? caseRead.data.supportCase.escalationLevel : 'ERR'}, comments=${caseRead.success ? caseRead.data.supportCase.commentCount : 'ERR'}, activity=${caseActions.join('/')}`,
  );
}

/**
 * Provider credentials: encrypted round-trip through the REUSED 0.4
 * resolver over PG rows (api-key decrypt + env gate + default swap), with
 * the wire surface returning only masked metadata.
 */
async function checkProviderCredentials(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const send = (
    method: 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const created = z.object({ credentialId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/provider-credentials?orgId=${orgId}`, {
        providerSlug: 'openai',
        authMethod: 'api-key',
        name: 'Primary key',
        secret: 'sk-itest-super-secret-value',
      })
    ).json(),
  );
  const credentialId = created.success ? created.data.credentialId : '';
  const listed = z
    .object({
      credentials: z.array(
        z.object({
          id: z.string(),
          maskedPreview: z.string().nullable(),
          isDefault: z.boolean(),
        }),
      ),
    })
    .safeParse(
      await (
        await fetch(`${base}/api/app/provider-credentials?orgId=${orgId}`, {
          headers: { cookie },
        })
      ).json(),
    );
  const listedRow = listed.success ? listed.data.credentials[0] : undefined;
  const listedRaw = JSON.stringify(listed.success ? listed.data : {});

  // Resolve through the reused 0.4 resolver (direct service call — secrets
  // never ride the HTTP surface).
  const { resolveProviderCredential } =
    await import('./domains/provider_credentials/service.ts');
  const resolved = await resolveProviderCredential(sql, {
    organizationId: orgId,
    providerSlug: 'openai',
  });
  const apiKeyOk =
    resolved.authMethod === 'api-key' &&
    'secret' in resolved &&
    resolved.secret === 'sk-itest-super-secret-value';

  // Env method: gate enforced, value read from the deployment env.
  process.env.TALE_PROVIDER_KEY_ITEST = 'env-secret-123';
  const envCred = z.object({ credentialId: z.string() }).safeParse(
    await (
      await send('POST', `/api/app/provider-credentials?orgId=${orgId}`, {
        providerSlug: 'openai',
        authMethod: 'env',
        name: 'Env key',
        envName: 'TALE_PROVIDER_KEY_ITEST',
      })
    ).json(),
  );
  const badEnv = await send(
    'POST',
    `/api/app/provider-credentials?orgId=${orgId}`,
    {
      providerSlug: 'openai',
      authMethod: 'env',
      name: 'Bad env',
      envName: 'HOME',
    },
  );
  const swapped = await send(
    'POST',
    `/api/app/provider-credentials/${envCred.success ? envCred.data.credentialId : ''}?orgId=${orgId}`,
    { isDefault: true },
  );
  const resolvedEnv = await resolveProviderCredential(sql, {
    organizationId: orgId,
    providerSlug: 'openai',
  });
  const envOk =
    resolvedEnv.authMethod === 'env' &&
    'secret' in resolvedEnv &&
    resolvedEnv.secret === 'env-secret-123';

  record(
    'provider credentials (0.4 resolver over PG)',
    created.success &&
      listedRow?.maskedPreview === 'sk-i…ue' &&
      !listedRaw.includes('sk-itest-super-secret-value') &&
      apiKeyOk &&
      envCred.success &&
      badEnv.status === 400 &&
      swapped.ok &&
      envOk,
    `masked=${listedRow?.maskedPreview}, apiKeyResolve=${apiKeyOk}, badEnv → ${badEnv.status} (want 400), defaultSwap+envResolve=${envOk}`,
  );
  void credentialId;
}

/**
 * Login throttle + audit chain, end to end through the real auth hooks:
 * repeated wrong passwords cross the lockout threshold (429 from the
 * before-hook), the lock expires on schedule (default first backoff = 1s),
 * a correct sign-in then succeeds and clears state — and every step wrote
 * org-scoped audit rows whose hash chain recomputes cleanly.
 */
async function checkLoginThrottleAndAuditChain(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  email: string,
): Promise<void> {
  const { orgId } = ctx;
  const signIn = (password: string): Promise<Response> =>
    fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password }),
    });

  // Default policy: 5 failures lock the account (first backoff 1s).
  const statuses: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    statuses.push((await signIn('wrong-password-1')).status);
  }
  const blocked = await signIn('wrong-password-1');
  const lockedOut = blocked.status === 429;
  record(
    'login lockout after repeated failures',
    statuses.every((s) => s === 401) && lockedOut,
    `failures → ${statuses.join(',')}; next attempt → ${blocked.status} (want 429)`,
  );

  // The lock expires (1s schedule) and a correct password signs in.
  await sleep(1_300);
  const recovered = await signIn('itest-password-1');
  record(
    'login lock expiry + success clears state',
    recovered.ok,
    `sign-in after lock expiry → ${recovered.status} (want 200)`,
  );

  // The chain: failure rows + a lockout row + a success row, hash-linked.
  const rows = await sql<AuditLogRow[]>`
    SELECT id, org_id AS "organizationId", actor_id AS "actorId",
           actor_email AS "actorEmail", actor_email_hash AS "actorEmailHash",
           actor_role AS "actorRole", actor_type AS "actorType",
           action, category, resource_type AS "resourceType",
           resource_id AS "resourceId", resource_name AS "resourceName",
           previous_state AS "previousState", new_state AS "newState",
           changed_fields AS "changedFields", session_id AS "sessionId",
           ip_address AS "ipAddress", actor_ip_hash AS "actorIpHash",
           user_agent AS "userAgent", request_id AS "requestId",
           ts::float8 AS "timestamp", status,
           error_message AS "errorMessage", metadata,
           integrity_hash AS "integrityHash", previous_hash AS "previousHash",
           pii_scrubbed AS "piiScrubbed"
    FROM app.audit_logs
    WHERE org_id = ${orgId}
    ORDER BY ts ASC
  `;
  let previousHash = '';
  let chainOk = rows.length > 0;
  const actions = new Set<string>();
  for (const row of rows) {
    actions.add(row.action);
    const recomputed = await computeAuditHash(
      previousHash,
      rowToHashInput(row),
    );
    if (
      recomputed !== row.integrityHash ||
      (row.previousHash ?? '') !== previousHash
    ) {
      chainOk = false;
      break;
    }
    previousHash = row.integrityHash;
  }
  const headRows = await sql<{ lastHash: string }[]>`
    SELECT last_hash AS "lastHash" FROM app.audit_chain_heads
    WHERE org_id = ${orgId}
  `;
  const headOk = headRows[0]?.lastHash === rows[rows.length - 1]?.integrityHash;
  record(
    'audit chain verifies',
    chainOk &&
      headOk &&
      actions.has('login_attempt') &&
      actions.has('login_lockout') &&
      actions.has('login_success'),
    `rows=${rows.length}, chain=${chainOk}, head=${headOk}, actions=${[...actions].join('/')}`,
  );

  // The lockout also raised a security bell notification for org admins.
  const unread = z.object({ count: z.number() }).safeParse(
    await (
      await fetch(`${base}/api/app/notifications/unread-count?orgId=${orgId}`, {
        headers: { cookie: ctx.cookie },
      })
    ).json(),
  );
  record(
    'lockout raises security notification',
    unread.success && unread.data.count >= 1,
    `unread after lockout=${unread.success ? unread.data.count : 'ERR'} (want ≥1)`,
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required (throwaway database — see services/platform/backend/README.md).',
    );
    process.exit(2);
  }

  // Give the scaffold job real (empty) config roots so org creation's
  // `org.scaffold` job runs to success instead of retrying on misconfig.
  if (!process.env.TALE_CONFIG_DIR) {
    process.env.TALE_CONFIG_DIR = await mkdtemp(
      path.join(tmpdir(), 'itest-config-'),
    );
  }
  if (!process.env.TALE_CONFIG_BUILTIN_DIR) {
    process.env.TALE_CONFIG_BUILTIN_DIR = await mkdtemp(
      path.join(tmpdir(), 'itest-builtin-'),
    );
  }

  if (!process.env.ENCRYPTION_SECRET_HEX && !process.env.ENCRYPTION_SECRET) {
    // Secret-box key for the credential round-trip (64 hex chars = 32 bytes).
    process.env.ENCRYPTION_SECRET_HEX = 'ab'.repeat(32);
  }

  // Better Auth validates the request Host against baseURL, so the server
  // port must be known BEFORE the auth instance is created — pick one
  // deterministically instead of binding port 0.
  const port = 30_000 + (process.pid % 20_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  // The production pool factory — the pg-boss tx adapter depends on its
  // json serializer semantics, so the harness must not use a bare pool.
  const sql = createSql(databaseUrl);
  const auth = createAuth({
    databaseUrl,
    secret: 'itest-secret-itest-secret',
    baseUrl,
    sql,
  });

  console.log('[itest] starting pg-boss (installs its own schema)…');
  const boss = createBoss(databaseUrl, { supervise: true });
  await boss.start();
  await ensureQueues(boss);
  await registerSchedules(boss);
  setEnqueueBoss(boss);

  console.log('[itest] running boot migrations twice, concurrently…');
  const migrationOptions = {
    databaseUrl,
    authOptions: auth.options,
    log: () => undefined,
  };
  // 1. Advisory lock: two concurrent migrators must both succeed with one
  //    outcome (no duplicate-DDL failures).
  await Promise.all([
    runBootMigrations(migrationOptions),
    runBootMigrations(migrationOptions),
  ]);
  const migrationRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app_migrations
  `;
  // Schema-agnostic on purpose: better-auth creates unqualified tables, which
  // land in the first search_path schema (`tale` on the tale-db image).
  const authTable = await sql<{ ok: boolean }[]>`
    SELECT to_regclass('"user"') IS NOT NULL AS ok
  `;
  record(
    'boot migrations (concurrent)',
    Number(migrationRows[0]?.count ?? '0') >= 1 && (authTable[0]?.ok ?? false),
    `app_migrations rows=${migrationRows[0]?.count}, better-auth user table=${authTable[0]?.ok ? 'present' : 'MISSING'}`,
  );

  const app = createApp({ sql, auth });
  const server = serve({ fetch: app.fetch, port });
  try {
    await checkSerializableRetry(sql);
    await checkTransactionalEnqueue(sql);
    await checkPickupLatency(sql, boss);

    const orgSuffix = String(Date.now() % 100_000);
    const authCtx = await checkAuthAndSse(sql, baseUrl, orgSuffix);

    // The org create enqueued `org.scaffold`; the worker from the latency
    // check is still running, so it must drain (success, no retry left over).
    const scaffoldDrained = await waitFor(async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM pgboss.job
        WHERE name = 'org.scaffold'
          AND state IN ('created', 'retry', 'active', 'failed')
      `;
      return Number(rows[0]?.count ?? '0') === 0;
    }, 10_000);
    record(
      'org.scaffold job drains',
      scaffoldDrained,
      `org-create scaffold job consumed=${scaffoldDrained}`,
    );

    await checkNotifications(sql, baseUrl, authCtx);
    await checkIdentityDomains(
      baseUrl,
      authCtx,
      `itest-${orgSuffix}@example.com`,
    );
    await checkProjects(baseUrl, authCtx);
    await checkTasks(baseUrl, authCtx);
    await checkFiles(baseUrl, authCtx);
    await checkDocuments(baseUrl, authCtx);
    await checkSmallDomains(baseUrl, authCtx);
    await checkProviderCredentials(sql, baseUrl, authCtx);
    await checkLoginThrottleAndAuditChain(
      sql,
      baseUrl,
      authCtx,
      `itest-${orgSuffix}@example.com`,
    );
  } finally {
    await boss.stop({ graceful: false });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await sql`DROP TABLE IF EXISTS itest_counter`;
    await sql.end({ timeout: 5 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[itest] ${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('[itest] fatal:', error);
  process.exit(1);
});
