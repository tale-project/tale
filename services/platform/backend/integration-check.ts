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
 * Agents: the REUSED 0.4 file layer (org config tree yaml + history trail)
 * behind the 0.5 routes — save (verify-before-write), list, read, resolve
 * for a turn, history + additive restore, delete, and the slug gate.
 */
async function checkAgents(
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const call = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const agentDoc = z
    .object({
      agent: z.looseObject({
        slug: z.string(),
        displayName: z.string(),
        visibility: z.string(),
        canEdit: z.boolean(),
        instructions: z.string().optional(),
      }),
    })
    .loose();

  const created = agentDoc.safeParse(
    await (
      await call('PUT', `/api/app/agents/helper?orgId=${orgId}`, {
        displayName: 'Helper',
        instructions: 'Be helpful, v1.',
        visibility: 'org',
      })
    ).json(),
  );
  const listed = z
    .object({ agents: z.array(z.looseObject({ slug: z.string() })) })
    .loose()
    .safeParse(
      await (await call('GET', `/api/app/agents?orgId=${orgId}`)).json(),
    );
  const badSlug = await call(
    'PUT',
    `/api/app/agents/${encodeURIComponent('Bad Slug!')}?orgId=${orgId}`,
    { displayName: 'Nope' },
  );

  // Second save supersedes v1 into the history trail.
  await call('PUT', `/api/app/agents/helper?orgId=${orgId}`, {
    displayName: 'Helper',
    instructions: 'Be helpful, v2.',
  });
  const history = z
    .object({
      entries: z.array(z.object({ entry: z.string(), savedAt: z.number() })),
    })
    .safeParse(
      await (
        await call('GET', `/api/app/agents/helper/history?orgId=${orgId}`)
      ).json(),
    );
  const firstEntry = history.success ? history.data.entries[0]?.entry : '';
  const restored = agentDoc.safeParse(
    await (
      await call('POST', `/api/app/agents/helper/restore?orgId=${orgId}`, {
        entry: firstEntry,
      })
    ).json(),
  );
  const resolved = z
    .object({ agent: z.looseObject({ instructions: z.string().optional() }) })
    .loose()
    .safeParse(
      await (
        await call(
          'GET',
          `/api/app/agents/helper/resolved?locale=en&orgId=${orgId}`,
        )
      ).json(),
    );
  const deleted = z
    .object({ deleted: z.boolean() })
    .safeParse(
      await (
        await call('DELETE', `/api/app/agents/helper?orgId=${orgId}`)
      ).json(),
    );
  const readAfter = await call('GET', `/api/app/agents/helper?orgId=${orgId}`);

  record(
    'agents file layer (save/list/history/restore/resolve/delete)',
    created.success &&
      created.data.agent.canEdit &&
      created.data.agent.visibility === 'org' &&
      listed.success &&
      listed.data.agents.some((agent) => agent.slug === 'helper') &&
      badSlug.status === 400 &&
      history.success &&
      history.data.entries.length >= 1 &&
      restored.success &&
      restored.data.agent.instructions === 'Be helpful, v1.' &&
      resolved.success &&
      deleted.success &&
      deleted.data.deleted &&
      readAfter.status === 404,
    `created=${created.success}, listed=${listed.success ? listed.data.agents.length : 'ERR'}, badSlug → ${badSlug.status} (want 400), history=${history.success ? history.data.entries.length : 'ERR'}, restoredV1=${restored.success && restored.data.agent.instructions === 'Be helpful, v1.'}, delete=${deleted.success && deleted.data.deleted}, readAfter → ${readAfter.status} (want 404)`,
  );
}

/**
 * Skills: the REUSED 0.4 file layer (SKILL.md frontmatter + bundle files)
 * behind the 0.5 routes — save (verify-before-write, org default), list,
 * read (body + file entries), delete, and the slug/team gates.
 */
async function checkSkills(
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const call = (
    method: 'GET' | 'PUT' | 'DELETE',
    route: string,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${base}${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const saved = z
    .object({
      skill: z.looseObject({
        slug: z.string(),
        visibility: z.string(),
        body: z.string(),
      }),
    })
    .loose()
    .safeParse(
      await (
        await call('PUT', `/api/app/skills/web-research?orgId=${orgId}`, {
          description: 'Research the web methodically.',
          body: '# Web research\n\nSearch, read, verify, cite.',
        })
      ).json(),
    );
  const listed = z
    .object({ skills: z.array(z.looseObject({ slug: z.string() })) })
    .loose()
    .safeParse(
      await (await call('GET', `/api/app/skills?orgId=${orgId}`)).json(),
    );
  const teamMissing = await call(
    'PUT',
    `/api/app/skills/team-skill?orgId=${orgId}`,
    {
      description: 'Team-scoped skill',
      body: 'body',
      visibility: 'team',
    },
  );
  const deleted = z
    .object({ deleted: z.boolean() })
    .safeParse(
      await (
        await call('DELETE', `/api/app/skills/web-research?orgId=${orgId}`)
      ).json(),
    );
  const readAfter = await call(
    'GET',
    `/api/app/skills/web-research?orgId=${orgId}`,
  );

  record(
    'skills file layer (save/list/delete + gates)',
    saved.success &&
      saved.data.skill.visibility === 'org' &&
      saved.data.skill.body.includes('Search, read') &&
      listed.success &&
      listed.data.skills.some((skill) => skill.slug === 'web-research') &&
      teamMissing.status === 400 &&
      deleted.success &&
      deleted.data.deleted &&
      readAfter.status === 404,
    `saved=${saved.success} (visibility=${saved.success ? saved.data.skill.visibility : 'ERR'}), listed=${listed.success ? listed.data.skills.length : 'ERR'}, teamWithoutTeams → ${teamMissing.status} (want 400), delete=${deleted.success && deleted.data.deleted}, readAfter → ${readAfter.status} (want 404)`,
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
 * Knowledge (RAG) vertical against the real corpus database and a local
 * fake embedding endpoint: upload → document bind → rag.index_file job
 * (extract → embed → chunk upsert) → hybrid search → windowed fetch.
 */
async function checkKnowledge(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'knowledge RAG loop (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — RAG lanes not exercised in this run',
    );
    return;
  }
  const { cookie, orgId } = ctx;

  // Deterministic fake embedder: 8-dim vectors from character statistics.
  const { createServer } = await import('node:http');
  const embedServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(fakeEmbeddingsPayload(body));
    });
  });
  await new Promise<void>((resolve) => {
    embedServer.listen(0, '127.0.0.1', resolve);
  });
  const embedAddress = embedServer.address();
  const embedPort =
    embedAddress !== null && typeof embedAddress === 'object'
      ? embedAddress.port
      : 0;

  try {
    // Org embedding config + corpus bootstrap.
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const dir = path.join(configRoot, orgSlug, 'knowledge');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'embedding.json'),
      JSON.stringify({
        providerSlug: 'openai',
        model: 'itest-embed',
        dimensions: 8,
        baseUrl: `http://127.0.0.1:${embedPort}/v1`,
      }),
    );
    const { ensureDefaultCorpusSchema } =
      await import('./domains/knowledge/service.ts');
    await ensureDefaultCorpusSchema();

    const send = (
      method: 'POST',
      route: string,
      body?: unknown,
    ): Promise<Response> =>
      fetch(`${base}${route}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const payload =
      'The Heidelberg quarterly review covers verdigris pigments and the zeppelin ledger.';
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
      record('knowledge RAG loop', false, 'upload handoff failed');
      return;
    }
    await fetch(handoff.data.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: payload,
    });
    const registered = z.object({ fileId: z.string() }).safeParse(
      await (
        await send('POST', `/api/app/files/register?orgId=${orgId}`, {
          storageRef: handoff.data.storageRef,
          fileName: 'quarterly.txt',
          contentType: 'text/plain',
        })
      ).json(),
    );
    await send('POST', `/api/app/documents/from-upload?orgId=${orgId}`, {
      fileId: registered.success ? registered.data.fileId : '',
      fileName: 'quarterly.txt',
    });

    // The rag.index_file job runs on the live worker; wait for completion.
    const indexed = await waitFor(async () => {
      const rows = await sql<{ status: string | null }[]>`
        SELECT rag_status AS status FROM app.file_metadata
        WHERE id = ${registered.success ? registered.data.fileId : ''}
      `;
      return rows[0]?.status === 'completed';
    }, 20_000);
    const statusRows = await sql<
      { status: string | null; error: string | null }[]
    >`
      SELECT rag_status AS status, rag_error AS error FROM app.file_metadata
      WHERE id = ${registered.success ? registered.data.fileId : ''}
    `;

    const searchBody = await (
      await send('POST', `/api/app/knowledge/search?orgId=${orgId}`, {
        query: 'verdigris zeppelin ledger',
        limit: 5,
      })
    ).json();
    const search = z
      .object({ hits: z.array(z.looseObject({})) })
      .loose()
      .safeParse(searchBody);
    const searchRaw = JSON.stringify(searchBody);
    const fetchRes = await (
      await send('POST', `/api/app/knowledge/fetch?orgId=${orgId}`, {
        fileId: handoff.data.storageRef,
      })
    ).json();
    const fetchRaw = JSON.stringify(fetchRes);

    record(
      'knowledge RAG loop (extract→embed→index→search→fetch)',
      indexed &&
        search.success &&
        search.data.hits.length > 0 &&
        searchRaw.includes('verdigris') &&
        fetchRaw.includes('zeppelin ledger'),
      `indexed=${indexed} (status=${statusRows[0]?.status}${statusRows[0]?.error ? `, err=${statusRows[0].error.slice(0, 80)}` : ''}), hits=${search.success ? search.data.hits.length : 'ERR'}, searchHit=${searchRaw.includes('verdigris')}, fetchHit=${fetchRaw.includes('zeppelin ledger')}`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      embedServer.close(() => resolve());
    });
  }
}

/** OpenAI-shaped embeddings response for a raw request body — deterministic
 * 8-dim vectors from character statistics; base64 Float32 when asked (the
 * OpenAI SDK's default decode path). */
function fakeEmbeddingsPayload(rawBody: string): string {
  const parsed = z
    .object({
      input: z.union([z.string(), z.array(z.string())]),
      encoding_format: z.string().optional(),
    })
    .safeParse(JSON.parse(rawBody || '{}'));
  const inputs = parsed.success
    ? Array.isArray(parsed.data.input)
      ? parsed.data.input
      : [parsed.data.input]
    : [''];
  const wantsBase64 =
    parsed.success && parsed.data.encoding_format === 'base64';
  const data = inputs.map((text, index) => {
    const vector = Array.from({ length: 8 }, (_, i) => {
      let acc = 0;
      for (let j = i; j < text.length; j += 8) {
        acc += text.charCodeAt(j) % 97;
      }
      return (acc % 1000) / 1000 + 0.001;
    });
    const embedding = wantsBase64
      ? Buffer.from(new Float32Array(vector).buffer).toString('base64')
      : vector;
    return { object: 'embedding', embedding, index };
  });
  return JSON.stringify({
    object: 'list',
    data,
    model: 'itest-embed',
    usage: { prompt_tokens: 1, total_tokens: 1 },
  });
}

/**
 * Chat vertical: the REUSED 0.4 `executeTurn` + tool executor over PG,
 * against a fake OpenAI-compatible provider (models endpoint + streaming
 * chat completions + embeddings). Proves: model resolution from an org
 * custom provider, the credential wire, the streaming store (generations
 * row + throttled writes), a REAL tool round (`rag_search` → the corpus the
 * knowledge check indexed), usage ledgering, the SSE progress lane, and
 * mid-stream cancel through the store's cancel flag.
 */
async function checkChat(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'chat turn engine (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — chat vertical rides the knowledge fixture',
    );
    return;
  }
  const { cookie, orgId } = ctx;
  const { createServer } = await import('node:http');

  const SLOW_MARKER = 'COUNT SLOWLY';
  const FINAL_ANSWER = 'The ledger mentions verdigris pigments.';
  const SLOW_CHUNKS = 40;

  const sse = (payload: unknown): string =>
    `data: ${JSON.stringify(payload)}\n\n`;
  const aiServer = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.endsWith('/models')) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'itest-chat',
              object: 'model',
              context_length: 32_768,
              max_output_tokens: 512,
            },
          ],
        }),
      );
      return;
    }
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      if (url.endsWith('/embeddings')) {
        res.setHeader('content-type', 'application/json');
        res.end(fakeEmbeddingsPayload(body));
        return;
      }
      if (!url.endsWith('/chat/completions')) {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      const parsed = z
        .object({
          messages: z.array(
            z.looseObject({ role: z.string(), content: z.unknown() }),
          ),
          tools: z.array(z.unknown()).optional(),
        })
        .loose()
        .safeParse(JSON.parse(body || '{}'));
      const messages = parsed.success ? parsed.data.messages : [];
      const hasToolResult = messages.some((m) => m.role === 'tool');
      const transcript = JSON.stringify(messages);
      res.setHeader('content-type', 'text/event-stream');
      const finish = (finishReason: string): void => {
        res.write(
          sse({
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
      };
      if (
        parsed.success &&
        parsed.data.tools !== undefined &&
        !hasToolResult &&
        !transcript.includes(SLOW_MARKER)
      ) {
        // Round 1: ask for the knowledge tool.
        res.write(
          sse({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_itest_1',
                      type: 'function',
                      function: { name: 'rag_search', arguments: '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          sse({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments:
                          '{"action":"search","query":"verdigris zeppelin ledger"}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
        finish('tool_calls');
        return;
      }
      if (transcript.includes(SLOW_MARKER)) {
        // A slow drip the cancel test can interrupt mid-stream.
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          res.write(
            sse({
              choices: [
                {
                  index: 0,
                  delta: { content: `tick${sent} ` },
                  finish_reason: null,
                },
              ],
            }),
          );
          if (sent >= SLOW_CHUNKS) {
            clearInterval(timer);
            finish('stop');
          }
        }, 100);
        res.on('close', () => {
          clearInterval(timer);
        });
        return;
      }
      // Round 2 (after the tool result): the final answer.
      for (const word of FINAL_ANSWER.split(' ')) {
        res.write(
          sse({
            choices: [
              { index: 0, delta: { content: `${word} ` }, finish_reason: null },
            ],
          }),
        );
      }
      finish('stop');
    });
  });
  await new Promise<void>((resolve) => {
    aiServer.listen(0, '127.0.0.1', resolve);
  });
  const aiAddress = aiServer.address();
  const aiPort =
    aiAddress !== null && typeof aiAddress === 'object' ? aiAddress.port : 0;
  const aiBase = `http://127.0.0.1:${aiPort}/v1`;

  try {
    // The org's chat provider: a custom provider file + an api-key
    // credential, exactly the operator flow. Private host opt-in mirrors
    // the self-hosted-endpoint deployment posture.
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const providersDir = path.join(configRoot, orgSlug, 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(
      path.join(providersDir, 'itestchat.yml'),
      [
        'name: itestchat',
        'displayName: Itest Chat',
        'apiFormat: openai',
        `baseUrl: ${aiBase}`,
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ].join('\n'),
    );
    // Re-point the org's embedding config at this server (same model and
    // dimensions as the knowledge fixture — only the port differs), so the
    // tool round's query embedding resolves after that fixture closed.
    await writeFile(
      path.join(configRoot, orgSlug, 'knowledge', 'embedding.json'),
      JSON.stringify({
        providerSlug: 'openai',
        model: 'itest-embed',
        dimensions: 8,
        baseUrl: aiBase,
      }),
    );

    const send = (route: string, body?: unknown): Promise<Response> =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    await send(`/api/app/provider-credentials?orgId=${orgId}`, {
      providerSlug: 'itestchat',
      authMethod: 'api-key',
      name: 'Chat key',
      secret: 'sk-itest-chat-key',
    });

    const created = z.object({ id: z.string() }).safeParse(
      await (
        await send(`/api/app/chat/threads?orgId=${orgId}`, {
          title: 'Itest chat',
        })
      ).json(),
    );
    const threadId = created.success ? created.data.id : '';

    // Turn 1 — a real tool round: model asks for rag_search, the executor
    // answers from the corpus the knowledge check indexed, model concludes.
    const outcome = z
      .object({ status: z.string(), reason: z.string().optional() })
      .safeParse(
        await (
          await send(
            `/api/app/chat/threads/${threadId}/messages?orgId=${orgId}`,
            {
              text: 'What does the quarterly review cover?',
              modelId: 'itest-chat',
              providerSlug: 'itestchat',
            },
          )
        ).json(),
      );

    const history = z
      .object({
        messages: z.array(
          z.looseObject({
            role: z.string(),
            parts: z.unknown(),
            sequence: z.number(),
            model: z.string().optional(),
          }),
        ),
      })
      .loose()
      .safeParse(
        await (
          await fetch(
            `${base}/api/app/chat/threads/${threadId}/messages?orgId=${orgId}`,
            { headers: { cookie } },
          )
        ).json(),
      );
    const assistantRow = history.success
      ? history.data.messages.findLast((m) => m.role === 'assistant')
      : undefined;
    const assistantRaw = JSON.stringify(assistantRow ?? {});
    const usageRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.usage_events
      WHERE org_id = ${orgId} AND model = 'itest-chat'
    `;
    const settledGen = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.generations
      WHERE thread_id = ${threadId}
    `;
    record(
      'chat turn (0.4 executeTurn over PG + real tool round)',
      outcome.success &&
        outcome.data.status === 'completed' &&
        history.success &&
        history.data.messages.length >= 2 &&
        assistantRaw.includes('rag_search') &&
        assistantRaw.includes('verdigris') &&
        assistantRaw.includes(FINAL_ANSWER.split(' ')[0] ?? '') &&
        Number(usageRows[0]?.count ?? '0') >= 1 &&
        settledGen[0]?.count === '0',
      `outcome=${outcome.success ? outcome.data.status : 'ERR'}${outcome.success && outcome.data.reason !== undefined ? ` (${outcome.data.reason})` : ''}, messages=${history.success ? history.data.messages.length : 'ERR'}, toolRound=${assistantRaw.includes('rag_search') && assistantRaw.includes('verdigris')}, usageRows=${usageRows[0]?.count}, genSettled=${settledGen[0]?.count === '0'}`,
    );

    // Turn 2 — SSE progress + mid-stream cancel: subscribe the stream lane,
    // start a slow turn, cancel after the first progress event, and verify
    // the turn settles early with a prefix of the drip.
    const streamController = new AbortController();
    const streamRes = await fetch(
      `${base}/api/app/chat/threads/${threadId}/stream?orgId=${orgId}`,
      { headers: { cookie }, signal: streamController.signal },
    );
    const reader = streamRes.body?.getReader();
    const sawProgress = (async (): Promise<boolean> => {
      if (!reader) return false;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return false;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes('event: progress') && buffer.includes('tick')) {
          return true;
        }
      }
    })();

    const slowSend = send(
      `/api/app/chat/threads/${threadId}/messages?orgId=${orgId}`,
      {
        text: `${SLOW_MARKER} please`,
        modelId: 'itest-chat',
        providerSlug: 'itestchat',
      },
    );
    const progressed = await Promise.race([
      sawProgress,
      sleep(15_000).then(() => false),
    ]);
    const cancelRes = await send(
      `/api/app/chat/threads/${threadId}/cancel?orgId=${orgId}`,
    );
    const slowOutcome = await slowSend;
    streamController.abort();
    const finalRows = await sql<{ text: string | null; status: string }[]>`
      SELECT text, status FROM app.messages
      WHERE thread_id = ${threadId} AND role = 'assistant'
      ORDER BY "order" DESC LIMIT 1
    `;
    const finalText = finalRows[0]?.text ?? '';
    const genGone = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.generations
      WHERE thread_id = ${threadId}
    `;
    record(
      'chat SSE progress + mid-stream cancel',
      progressed &&
        cancelRes.ok &&
        slowOutcome.ok &&
        finalText.includes('tick1') &&
        !finalText.includes(`tick${SLOW_CHUNKS}`) &&
        genGone[0]?.count === '0',
      `progressSeen=${progressed}, cancel=${cancelRes.status}, settledLen=${finalText.length} (cancelled before tick${SLOW_CHUNKS}=${!finalText.includes(`tick${SLOW_CHUNKS}`)}), genGone=${genGone[0]?.count === '0'}`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      aiServer.close(() => resolve());
    });
  }
}

/**
 * Automations: the REUSED 0.4 durable stepper on PG + pg-boss — save
 * (immutable versions) → deploy (tests gate) → start → the worker's
 * `automation.step` job walks transform + llm nodes (checkpoints, epoch
 * fence, terminal audit row), plus the liveness sweep re-poking a run whose
 * scheduled resume was lost, webhook token mint/rotate, and tombstones.
 */
async function checkAutomations(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId } = ctx;
  const { createServer } = await import('node:http');

  // Fake OpenAI-compatible provider for the llm node (non-streaming).
  const llmServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const url = req.url ?? '';
      if (req.method === 'GET' && url.endsWith('/models')) {
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'itest-llm', object: 'model', context_length: 32_768 },
            ],
          }),
        );
        return;
      }
      if (url.endsWith('/chat/completions')) {
        res.end(
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '{"verdict":"LGTM-42"}',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 6,
              total_tokens: 18,
            },
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    llmServer.listen(0, '127.0.0.1', resolve);
  });
  const llmAddress = llmServer.address();
  const llmPort =
    llmAddress !== null && typeof llmAddress === 'object' ? llmAddress.port : 0;

  try {
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const providersDir = path.join(configRoot, orgSlug, 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(
      path.join(providersDir, 'itestllm.yml'),
      [
        'name: itestllm',
        'displayName: Itest LLM',
        'apiFormat: openai',
        `baseUrl: http://127.0.0.1:${llmPort}/v1`,
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ].join('\n'),
    );
    const post = (route: string, body?: unknown): Promise<Response> =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const get = async (route: string): Promise<unknown> =>
      (await fetch(`${base}${route}`, { headers: { cookie } })).json();
    await post(`/api/app/provider-credentials?orgId=${orgId}`, {
      providerSlug: 'itestllm',
      authMethod: 'api-key',
      name: 'LLM key',
      secret: 'sk-itest-llm',
    });

    const document = {
      version: 1,
      name: 'ops/greet',
      nodes: [
        {
          id: 'shape',
          type: 'transform',
          input: { who: '{{ input.who }}' },
          code: 'return { greeting: "hi " + input.who }',
        },
        {
          id: 'review',
          type: 'llm',
          model: 'itest-llm',
          prompt: 'Review this greeting: {{ nodes.shape.output.greeting }}',
          outputSchema: {
            type: 'object',
            properties: { verdict: { type: 'string' } },
            required: ['verdict'],
          },
        },
      ],
      output: '{{ nodes.review.output.verdict }}',
    };
    const saved = z.object({ name: z.string(), version: z.number() }).safeParse(
      await (
        await post(`/api/app/automations/ops/greet/save?orgId=${orgId}`, {
          document,
          message: 'first',
        })
      ).json(),
    );
    const deployed = await post(
      `/api/app/automations/ops/greet/deploy?orgId=${orgId}`,
      { version: 1 },
    );
    // Failing-tests versions must be refused by the deploy gate.
    await post(`/api/app/automations/ops/greet/save?orgId=${orgId}`, {
      document,
      testsPassed: false,
    });
    const gate = await post(
      `/api/app/automations/ops/greet/deploy?orgId=${orgId}`,
      { version: 2 },
    );

    const started = z.object({ runId: z.string() }).safeParse(
      await (
        await post(`/api/app/automations/ops/greet/start?orgId=${orgId}`, {
          input: { who: 'ops' },
          mode: 'live',
        })
      ).json(),
    );
    const runId = started.success ? started.data.runId : '';
    const settled = await waitFor(async () => {
      const body = z
        .object({ run: z.looseObject({ status: z.string() }) })
        .loose()
        .safeParse(
          await get(`/api/app/automations/runs/${runId}?orgId=${orgId}`),
        );
      return (
        body.success &&
        ['success', 'failed', 'cancelled'].includes(body.data.run.status)
      );
    }, 30_000);
    const runView = z
      .object({
        run: z.looseObject({
          status: z.string(),
          output: z.unknown(),
          trace: z.unknown(),
          detail: z.string().nullable(),
        }),
      })
      .loose()
      .safeParse(
        await get(`/api/app/automations/runs/${runId}?orgId=${orgId}`),
      );
    const runRaw = JSON.stringify(runView.success ? runView.data : {});
    const auditRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'automation.run.success'
    `;

    // Liveness: a queued run whose step job was LOST (inserted directly, no
    // enqueue) is overdue — the sweep must re-poke it to completion.
    const orphan = await sql<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, status, mode, started_by, input, checkpoints,
        wake_at_ms, claim_epoch, started_at_ms
      ) VALUES (
        ${orgId}, 'ops/greet', 1, 'queued', 'mock', 'itest:liveness',
        ${sql.json('{"who":"sweep"}')}, ${sql.json('{"nodes":{},"executions":0}')},
        ${Date.now() - 60_000}, 0, ${Date.now() - 60_000}
      ) RETURNING id
    `;
    const automationsStore = await import('./domains/automations/store.ts');
    const swept = await automationsStore.sweepOverdueRuns(sql);
    const orphanSettled = await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs
        WHERE id = ${orphan[0]?.id ?? ''}
      `;
      return rows[0]?.status === 'success';
    }, 30_000);

    // Webhook trigger: token minted once, kept on re-bind, rotated on ask.
    const minted = z.object({ token: z.string() }).safeParse(
      await (
        await post(`/api/app/automations/ops/greet/trigger?orgId=${orgId}`, {
          kind: 'webhook',
        })
      ).json(),
    );
    const rebound = await (
      await post(`/api/app/automations/ops/greet/trigger?orgId=${orgId}`, {
        kind: 'webhook',
      })
    ).json();
    const rotated = z.object({ token: z.string() }).safeParse(
      await (
        await post(`/api/app/automations/ops/greet/trigger?orgId=${orgId}`, {
          kind: 'webhook',
          rotateToken: true,
        })
      ).json(),
    );

    // Webhook DELIVERY: the rotated token starts a live run; garbage 404s.
    const hookRes = await fetch(
      `${base}/api/automations/webhook/${rotated.success ? rotated.data.token : ''}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'vendor' }),
      },
    );
    const hookRun = z
      .object({ runId: z.string() })
      .safeParse(await hookRes.json());
    const hookSettled = await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs
        WHERE id = ${hookRun.success ? hookRun.data.runId : ''}
      `;
      return rows[0]?.status === 'success';
    }, 30_000);
    const hookBadToken = await fetch(
      `${base}/api/automations/webhook/not-a-real-token`,
      { method: 'POST', body: '{}' },
    );

    // Schedule DELIVERY: retarget the trigger to a minute cron, backdate its
    // fire stamp, and let the scan (the per-minute job's body) fire it.
    await post(`/api/app/automations/ops/greet/trigger?orgId=${orgId}`, {
      kind: 'schedule',
      cron: '* * * * *',
      timezone: 'UTC',
    });
    await sql`
      UPDATE app.automation_triggers
      SET last_fired_at_ms = ${Date.now() - 120_000}
      WHERE org_id = ${orgId} AND name = 'ops/greet'
    `;
    const triggersModule = await import('./domains/automations/triggers.ts');
    const scan = await triggersModule.scanScheduledTriggers(sql);
    const scheduleStamp = await sql<{ last: number | null }[]>`
      SELECT last_fired_at_ms::float8 AS last FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = 'ops/greet'
    `;

    // Event DELIVERY through the REAL producer: retarget to contact.created,
    // create a contact via the API, and the emit seam starts the run inside
    // the producing transaction.
    await post(`/api/app/automations/ops/greet/trigger?orgId=${orgId}`, {
      kind: 'event',
      event: 'contact.created',
    });
    const runsBefore = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.automation_runs
      WHERE org_id = ${orgId} AND started_by LIKE 'trigger:%'
    `;
    const probeContact = await post(`/api/app/contacts?orgId=${orgId}`, {
      name: 'Event Probe',
      email: 'event-probe@example.com',
      source: 'manual_import',
    });
    if (!probeContact.ok) {
      console.warn(
        `[itest] event-probe contact create → ${probeContact.status}`,
      );
    }
    const eventFired = await waitFor(async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM app.automation_runs
        WHERE org_id = ${orgId} AND started_by LIKE 'trigger:%'
      `;
      return (
        Number(rows[0]?.count ?? '0') > Number(runsBefore[0]?.count ?? '0')
      );
    }, 15_000);

    // Delete → tombstone; saving again clears it.
    await fetch(`${base}/api/app/automations/ops/greet?orgId=${orgId}`, {
      method: 'DELETE',
      headers: { cookie, origin: base },
    });
    const tombstoned = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.automation_tombstones
      WHERE org_id = ${orgId} AND name = 'ops/greet'
    `;
    await post(`/api/app/automations/ops/greet/save?orgId=${orgId}`, {
      document,
    });
    const cleared = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.automation_tombstones
      WHERE org_id = ${orgId} AND name = 'ops/greet'
    `;

    record(
      'automations durable stepper (0.4 engine over PG + pg-boss)',
      saved.success &&
        saved.data.version === 1 &&
        deployed.ok &&
        gate.status === 409 &&
        started.success &&
        settled &&
        runView.success &&
        runView.data.run.status === 'success' &&
        runView.data.run.output === 'LGTM-42' &&
        runRaw.includes('"shape"') &&
        runRaw.includes('"review"') &&
        Number(auditRows[0]?.count ?? '0') >= 1 &&
        swept >= 1 &&
        orphanSettled &&
        minted.success &&
        JSON.stringify(rebound) === '{}' &&
        rotated.success &&
        rotated.data.token !== minted.data.token &&
        tombstoned[0]?.count === '1' &&
        cleared[0]?.count === '0' &&
        hookRes.status === 202 &&
        hookSettled &&
        hookBadToken.status === 404 &&
        scan.fired >= 1 &&
        (scheduleStamp[0]?.last ?? 0) > Date.now() - 90_000 &&
        eventFired,
      `save=${saved.success}, deploy=${deployed.status}, gate → ${gate.status} (want 409), run=${runView.success ? runView.data.run.status : 'ERR'} output=${runView.success ? JSON.stringify(runView.data.run.output) : 'ERR'} (want "LGTM-42"), audit=${auditRows[0]?.count}, sweep=${swept}/settled=${orphanSettled}, webhook(mint=${minted.success}, keep=${JSON.stringify(rebound) === '{}'}, rotate=${rotated.success && rotated.data.token !== (minted.success ? minted.data.token : '')}, fire → ${hookRes.status}/settled=${hookSettled}, bad → ${hookBadToken.status}), schedule(fired=${scan.fired}), event(fired=${eventFired}), tombstone=${tombstoned[0]?.count}→${cleared[0]?.count}`,
    );
  } finally {
    await new Promise<void>((resolve) => {
      llmServer.close(() => resolve());
    });
  }
}

/**
 * Governance enforcement: the model-access policy FILE blocks a model at
 * the chat turn boundary with the 0.4 evaluator's own wording, feature
 * flags cap the context window, and the usage ledger aggregates the turns
 * already run into period buckets.
 */
async function checkGovernance(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const governance = await import('./domains/governance/service.ts');
  const orgConfig = await import('./lib/org-config.ts');

  // The chat turns and tool dispatches already run accumulated buckets.
  const buckets = await governance.readUsageBuckets(sql, {
    organizationId: orgId,
    userId,
  });
  const chatBucket = buckets.find(
    (bucket) => bucket.model === 'itest-chat' && bucket.granularity === 'daily',
  );
  const connectorBuckets = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.usage_ledger
    WHERE org_id = ${orgId} AND connector_name = 'chat-tools'
  `;

  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const governanceDir = path.join(configRoot, orgSlug, 'governance');
  await mkdir(governanceDir, { recursive: true });

  // Allowlist WITHOUT itest-chat: the next send must refuse with the
  // policy evaluator's wording, before any wire is touched.
  await writeFile(
    path.join(governanceDir, 'model-access.yml'),
    [
      'enabled: true',
      'mode: allowlist',
      'rules:',
      '  - scope: default',
      '    allowedModels:',
      '      - some-other-model',
    ].join('\n'),
  );
  await writeFile(
    path.join(governanceDir, 'feature-flags.yml'),
    [
      'enabled: true',
      'rules:',
      '  - scope: default',
      '    maxContextTokens: 9000',
    ].join('\n'),
  );
  orgConfig.clearOrgConfigCaches();

  const threadRes = z.object({ id: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/app/chat/threads?orgId=${orgId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ title: 'Governance probe' }),
      })
    ).json(),
  );
  const threadId = threadRes.success ? threadRes.data.id : '';
  const refused = z
    .object({ status: z.string(), reason: z.string().optional() })
    .safeParse(
      await (
        await fetch(
          `${base}/api/app/chat/threads/${threadId}/messages?orgId=${orgId}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              cookie,
              origin: base,
            },
            body: JSON.stringify({
              text: 'hello',
              modelId: 'itest-chat',
              providerSlug: 'itestchat',
            }),
          },
        )
      ).json(),
    );
  const cap = await governance.getContextCapForUser(sql, {
    organizationId: orgId,
    userId,
  });

  // Lift the policy: access opens again (proven cheaply at the service).
  const { unlink } = await import('node:fs/promises');
  await unlink(path.join(governanceDir, 'model-access.yml'));
  orgConfig.clearOrgConfigCaches();
  const reopened = await governance.checkModelAccessForUser(sql, {
    organizationId: orgId,
    userId,
    modelId: 'itest-chat',
  });

  record(
    'governance enforcement (model access + caps + usage buckets)',
    chatBucket !== undefined &&
      chatBucket.totalTokens > 0 &&
      Number(connectorBuckets[0]?.count ?? '0') >= 1 &&
      refused.success &&
      refused.data.status === 'refused' &&
      (refused.data.reason ?? '').includes('not available for your account') &&
      cap === 9000 &&
      reopened.allowed,
    `bucket tokens=${chatBucket?.totalTokens ?? 'MISSING'}, connectorBuckets=${connectorBuckets[0]?.count}, blocked=${refused.success ? refused.data.status : 'ERR'} ("${refused.success ? refused.data.reason : ''}"), cap=${cap} (want 9000), reopened=${reopened.allowed}`,
  );
}

/**
 * The REST machine door: a Better Auth API key minted through the session
 * surface authenticates `/api/v1` (org resolved from membership), the thin
 * adapters answer over the same domain services, and a run started through
 * the door executes on the worker.
 */
async function checkRestDoor(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie } = ctx;
  const minted = z.looseObject({ key: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ name: 'itest-door' }),
      })
    ).json(),
  );
  const apiKey = minted.success ? minted.data.key : '';
  const v1 = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${base}/api/v1${route}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  const contacts = z
    .object({ page: z.array(z.looseObject({ id: z.string() })) })
    .loose()
    .safeParse(await (await v1('/contacts')).json());
  const productCreated = z
    .object({ id: z.string() })
    .safeParse(
      await (
        await v1('/products', { body: { name: 'Door Widget', price: 9.5 } })
      ).json(),
    );
  const productRead = z
    .looseObject({ name: z.string() })
    .safeParse(
      await (
        await v1(
          `/products/${productCreated.success ? productCreated.data.id : ''}`,
        )
      ).json(),
    );
  const agents = z
    .object({ agents: z.array(z.unknown()) })
    .loose()
    .safeParse(await (await v1('/agents')).json());

  // Save + run an automation entirely through the door.
  const doorDoc = {
    version: 1,
    name: 'ops/door',
    nodes: [
      {
        id: 'shape',
        type: 'transform',
        input: { n: '{{ input.n }}' },
        code: 'return { doubled: input.n * 2 }',
      },
    ],
    output: '{{ nodes.shape.output.doubled }}',
  };
  await v1('/automations/ops/door/save', { body: { document: doorDoc } });
  const doorStart = z.object({ runId: z.string() }).safeParse(
    await (
      await v1('/automations/ops/door/start', {
        body: { input: { n: 21 }, version: 1 },
      })
    ).json(),
  );
  const doorRunId = doorStart.success ? doorStart.data.runId : '';
  const doorSettled = await waitFor(async () => {
    const body = z
      .looseObject({ status: z.string() })
      .safeParse(await (await v1(`/runs/${doorRunId}`)).json());
    return body.success && body.data.status === 'success';
  }, 30_000);
  const doorRun = z
    .looseObject({ output: z.unknown() })
    .safeParse(await (await v1(`/runs/${doorRunId}`)).json());

  const badKey = await fetch(`${base}/api/v1/contacts`, {
    headers: { authorization: 'Bearer not-a-key' },
  });
  const noKey = await fetch(`${base}/api/v1/contacts`);

  record(
    'REST machine door (/api/v1 on api-key auth)',
    minted.success &&
      contacts.success &&
      contacts.data.page.length >= 1 &&
      productCreated.success &&
      productRead.success &&
      productRead.data.name === 'Door Widget' &&
      agents.success &&
      doorStart.success &&
      doorSettled &&
      doorRun.success &&
      doorRun.data.output === 42 &&
      badKey.status === 401 &&
      noKey.status === 401,
    `key=${minted.success}, contacts=${contacts.success ? contacts.data.page.length : 'ERR'}, product=${productRead.success ? productRead.data.name : 'ERR'}, agents=${agents.success}, door run=${doorSettled} output=${doorRun.success ? JSON.stringify(doorRun.data.output) : 'ERR'} (want 42), badKey → ${badKey.status}, noKey → ${noKey.status} (want 401/401)`,
  );
}

/**
 * Sandbox session substrate: per-owner and per-budget caps, park-on-capacity
 * FIFO tickets (fairness + release-edge admission), hibernate/resume slot
 * accounting, hash-only token lifecycle, and durable op rows — all under the
 * per-org advisory-lock admission section.
 */
async function checkSandboxSessions(
  sql: Sql,
  ctx: { orgId: string; userId: string },
): Promise<void> {
  const sessions = await import('./domains/sandbox/sessions.ts');
  const { orgId, userId } = ctx;
  const reserve = (
    n: number,
    ownerType: string,
    ticket?: { source: 'chat' | 'workflow' },
  ): Promise<string> =>
    sessions.reserveSessionSlot(sql, {
      organizationId: orgId,
      sessionId: `itest-sb-${n}`,
      profile: { image: 'itest' },
      ownerType,
      ownerId: `owner-${n}`,
      createdBy: userId,
      ...(ticket !== undefined ? { ticket } : {}),
    });
  const code = (error: unknown): string =>
    error !== null && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : String(error);

  // Slots 1+2 fill the default project budget (maxSessionsPerOrg=2).
  await reserve(1, 'project_agent');
  await sessions.setSessionStatus(sql, {
    organizationId: orgId,
    sessionId: 'itest-sb-1',
    status: 'active',
  });
  await reserve(2, 'project_agent');
  const dupOwner = await sessions
    .reserveSessionSlot(sql, {
      organizationId: orgId,
      sessionId: 'itest-sb-1b',
      profile: {},
      ownerType: 'project_agent',
      ownerId: 'owner-1',
      createdBy: userId,
    })
    .then(() => 'ok')
    .catch(code);
  const hardCap = await reserve(3, 'project_agent')
    .then(() => 'ok')
    .catch(code);
  const parked3 = await reserve(3, 'project_agent', { source: 'workflow' })
    .then(() => 'ok')
    .catch(code);
  // A second, LATER waiter — FIFO fairness must keep it behind owner-3.
  const parked4 = await reserve(4, 'project_agent', { source: 'workflow' })
    .then(() => 'ok')
    .catch(code);
  const pollWhileFull = await sessions.pollAdmission(sql, {
    organizationId: orgId,
    ownerType: 'project_agent',
    ownerId: 'owner-3',
    ticket: { source: 'workflow' },
  });

  // Release edge: hibernating slot 1 opens exactly one slot — the FIFO head
  // (owner-3) may proceed, the later waiter (owner-4) may not.
  await sessions.markSessionStopped(sql, {
    organizationId: orgId,
    sessionId: 'itest-sb-1',
  });
  const pollLater = await sessions.pollAdmission(sql, {
    organizationId: orgId,
    ownerType: 'project_agent',
    ownerId: 'owner-4',
    ticket: { source: 'workflow' },
  });
  const pollHead = await sessions.pollAdmission(sql, {
    organizationId: orgId,
    ownerType: 'project_agent',
    ownerId: 'owner-3',
    ticket: { source: 'workflow' },
  });
  const admitted3 = await reserve(3, 'project_agent', { source: 'workflow' })
    .then(() => 'ok')
    .catch(code);

  // Resuming the hibernated slot 1 while the budget is full re-queues fairly.
  const resumeFull = await sessions
    .resumeSessionSlot(sql, {
      organizationId: orgId,
      sessionId: 'itest-sb-1',
    })
    .then(() => 'ok')
    .catch(code);
  await sessions.markSessionDestroyed(sql, {
    organizationId: orgId,
    sessionId: 'itest-sb-3',
  });
  const resumeAfterFree = await sessions
    .resumeSessionSlot(sql, {
      organizationId: orgId,
      sessionId: 'itest-sb-1',
    })
    .then(() => 'ok')
    .catch(code);

  // Separate workflow budget (default 4) — untouched by the project fill.
  const wf = await reserve(10, 'workflow_run')
    .then(() => 'ok')
    .catch(code);

  // Tokens: hash-only lifecycle.
  await sessions.insertSessionToken(sql, {
    organizationId: orgId,
    sessionId: 'itest-sb-1',
    tokenHash: 'hash-abc',
    scope: {
      agentKind: 'claude-code',
      allowedModels: ['m1'],
      connectorGrants: [],
      budgetCents: 100,
    },
    ttlMs: 60_000,
  });
  const tokenLive = await sessions.getSessionTokenByHash(sql, 'hash-abc');
  await sessions.revokeTokensForSession(sql, orgId, 'itest-sb-1');
  const tokenRevoked = await sessions.getSessionTokenByHash(sql, 'hash-abc');

  // Ops: start → progress → exactly-once finalize; watchdog staleness read.
  await sessions.startSessionOp(sql, {
    organizationId: orgId,
    sessionId: 'itest-sb-1',
    execId: 'exec-1',
    kind: 'agent-run',
    threadId: 'itest-thread-1',
  });
  await sessions.flushOpProgress(sql, {
    sessionId: 'itest-sb-1',
    execId: 'exec-1',
    progressText: 'working…',
    lastSeq: 7,
  });
  const liveOp = await sessions.latestAgentRunForThread(sql, 'itest-thread-1');
  const abandoned = await sessions.listAbandonedOps(sql, Date.now() + 60_000);
  const finalizedOnce = await sessions.finalizeSessionOp(sql, {
    sessionId: 'itest-sb-1',
    execId: 'exec-1',
    status: 'completed',
    exitCode: 0,
  });
  const finalizedTwice = await sessions.finalizeSessionOp(sql, {
    sessionId: 'itest-sb-1',
    execId: 'exec-1',
    status: 'failed',
  });

  const reaped = await sessions.reapStaleAdmissionTickets(
    sql,
    Date.now() + 60_000,
  );

  record(
    'sandbox sessions (caps + FIFO admission + tokens + ops)',
    dupOwner === 'QUOTA_EXCEEDED' &&
      hardCap === 'QUOTA_EXCEEDED' &&
      parked3 === 'WAIT_FIFO' &&
      parked4 === 'WAIT_FIFO' &&
      !pollWhileFull.proceed &&
      !pollLater.proceed &&
      pollHead.proceed &&
      admitted3 === 'ok' &&
      resumeFull === 'QUOTA_EXCEEDED' &&
      resumeAfterFree === 'ok' &&
      wf === 'ok' &&
      tokenLive !== null &&
      tokenLive.scope.agentKind === 'claude-code' &&
      tokenRevoked === null &&
      liveOp?.progressText === 'working…' &&
      abandoned.some((op) => op.execId === 'exec-1') &&
      finalizedOnce &&
      !finalizedTwice &&
      reaped >= 1,
    `dupOwner=${dupOwner}, hardCap=${hardCap}, park=${parked3}/${parked4}, fifo(full=${pollWhileFull.proceed},later=${pollLater.proceed},head=${pollHead.proceed}), admit=${admitted3}, resume(full=${resumeFull},freed=${resumeAfterFree}), wfBudget=${wf}, token(live=${tokenLive !== null},revoked=${tokenRevoked === null}), op(progress=${liveOp?.progressText === 'working…'},finalize=${finalizedOnce}/${finalizedTwice}), reaped=${reaped}`,
  );
}

/**
 * Sandbox spawner dispatch: the REUSED session client (HMAC signing, drain
 * semantics) against a fake spawner that VERIFIES every signature, plus the
 * provisioning choreography (reuse-in-place, phantom heal, orphan adopt,
 * host-busy re-park) and the admin management surface.
 */
async function checkSandboxSpawner(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const { createServer } = await import('node:http');
  const { createHash, createHmac } = await import('node:crypto');

  const SPAWNER_TOKEN = 'itest-spawner-token';
  const live = new Map<string, { pinned: boolean }>();
  let badSignatures = 0;
  const busyOnce = new Set<string>();
  const spawner = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      // Verify the platform's HMAC (the spawner auth contract).
      const bodyHash = createHash('sha256').update(body).digest('hex');
      const signedString = `${method}\n${url}\n${String(req.headers['x-tale-sandbox-timestamp'] ?? '')}\n${String(req.headers['x-tale-sandbox-nonce'] ?? '')}\n${bodyHash}`;
      const expected = createHmac('sha256', SPAWNER_TOKEN)
        .update(signedString)
        .digest('hex');
      if (req.headers['x-tale-sandbox-signature'] !== expected) {
        badSignatures += 1;
        res.statusCode = 401;
        res.end('{"error":"bad signature"}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      const sessionInfo = (sessionId: string): unknown => ({
        session: {
          sessionId,
          organizationId: orgId,
          profile: 'agent',
          state: 'ready',
          backend: 'itest',
          createdAtMs: Date.now(),
          lastActivityAtMs: Date.now(),
          expiresAtMs: Date.now() + 3_600_000,
          idleTimeoutMs: 600_000,
        },
      });
      if (method === 'POST' && url === '/v1/sessions') {
        const parsed = z
          .object({ sessionId: z.string() })
          .loose()
          .safeParse(JSON.parse(body || '{}'));
        const sessionId = parsed.success ? parsed.data.sessionId : '';
        if (busyOnce.has(sessionId)) {
          busyOnce.delete(sessionId);
          res.statusCode = 429;
          res.setHeader('retry-after', '1');
          res.end('{"error":"session_quota"}');
          return;
        }
        if (live.has(sessionId)) {
          res.statusCode = 409;
          res.end('{"error":"duplicate"}');
          return;
        }
        live.set(sessionId, { pinned: false });
        res.end(JSON.stringify(sessionInfo(sessionId)));
        return;
      }
      const idMatch = /^\/v1\/sessions\/([^/]+)(\/pin)?$/.exec(url);
      const sessionId =
        idMatch?.[1] !== undefined ? decodeURIComponent(idMatch[1]) : '';
      if (method === 'GET' && idMatch && idMatch[2] === undefined) {
        if (!live.has(sessionId)) {
          res.statusCode = 404;
          res.end('{"error":"not found"}');
          return;
        }
        res.end(JSON.stringify(sessionInfo(sessionId)));
        return;
      }
      if (method === 'DELETE' && idMatch) {
        live.delete(sessionId);
        res.end('{"destroyed":true}');
        return;
      }
      if (method === 'PATCH' && idMatch && idMatch[2] === '/pin') {
        const parsed = z
          .object({ pinned: z.boolean() })
          .safeParse(JSON.parse(body || '{}'));
        const entry = live.get(sessionId);
        if (entry && parsed.success) entry.pinned = parsed.data.pinned;
        res.end(
          JSON.stringify({ pinned: parsed.success && parsed.data.pinned }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    spawner.listen(0, '127.0.0.1', resolve);
  });
  const address = spawner.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;
  process.env.SANDBOX_URL = `http://127.0.0.1:${port}`;
  process.env.SANDBOX_TOKEN = SPAWNER_TOKEN;

  try {
    const service = await import('./domains/sandbox/service.ts');
    const sessions = await import('./domains/sandbox/sessions.ts');
    const code = (error: unknown): string =>
      error !== null && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : String(error);

    const first = await service.provisionSession(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-1',
      profile: 'agent',
      ownerType: 'workflow_run',
      ownerId: 'wf-20',
      createdBy: userId,
    });
    const rowAfterCreate = await sessions.getSessionBySessionId(
      sql,
      orgId,
      'itest-spawn-1',
    );
    const reused = await service.provisionSession(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-1',
      profile: 'agent',
      ownerType: 'workflow_run',
      ownerId: 'wf-20',
      createdBy: userId,
    });

    // Phantom heal: container vanishes spawner-side; re-provision recreates.
    live.delete('itest-spawn-1');
    const healed = await service.provisionSession(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-1',
      profile: 'agent',
      ownerType: 'workflow_run',
      ownerId: 'wf-20',
      createdBy: userId,
    });

    // Orphan adopt: the spawner holds a container the platform lost track of.
    live.set('itest-spawn-adopt', { pinned: false });
    const adopted = await service.provisionSession(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-adopt',
      profile: 'agent',
      ownerType: 'workflow_run',
      ownerId: 'wf-21',
      createdBy: userId,
    });
    const adoptedRow = await sessions.getSessionBySessionId(
      sql,
      orgId,
      'itest-spawn-adopt',
    );

    // Host-capacity busy: the FIFO ticket goes back to waiting for the retry.
    busyOnce.add('itest-spawn-busy');
    const busy = await service
      .provisionSession(sql, {
        organizationId: orgId,
        sessionId: 'itest-spawn-busy',
        profile: 'agent',
        ownerType: 'workflow_run',
        ownerId: 'wf-22',
        createdBy: userId,
        ticket: { source: 'workflow' },
      })
      .then(() => 'ok')
      .catch(code);
    const ticketRows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_admission_tickets
      WHERE owner_type = 'workflow_run' AND owner_id = 'wf-22'
    `;

    // Admin surface over HTTP: list + pin + destroy.
    const listed = z
      .object({
        sessions: z.array(
          z.looseObject({ sessionId: z.string(), status: z.string() }),
        ),
      })
      .loose()
      .safeParse(
        await (
          await fetch(`${base}/api/app/sandbox/sessions?orgId=${orgId}`, {
            headers: { cookie },
          })
        ).json(),
      );
    const pinRes = await fetch(
      `${base}/api/app/sandbox/sessions/itest-spawn-1/pin?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({ pinned: true }),
      },
    );
    const destroyRes = await fetch(
      `${base}/api/app/sandbox/sessions/itest-spawn-1/destroy?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
      },
    );

    record(
      'sandbox spawner dispatch (reused HMAC client + provisioning)',
      badSignatures === 0 &&
        first.created &&
        rowAfterCreate?.status === 'active' &&
        !reused.created &&
        healed.created &&
        adopted.created &&
        adoptedRow?.status === 'active' &&
        busy === 'SpawnerBusyError' &&
        ticketRows[0]?.status === 'waiting' &&
        listed.success &&
        listed.data.sessions.some(
          (row) => row.sessionId === 'itest-spawn-1' && row.status === 'active',
        ) &&
        pinRes.ok &&
        destroyRes.ok &&
        live.get('itest-spawn-1') === undefined &&
        live.get('itest-spawn-adopt')?.pinned === false,
      `signatures ok=${badSignatures === 0}, create=${first.created}/active=${rowAfterCreate?.status === 'active'}, reuse=${!reused.created}, heal=${healed.created}, adopt=${adopted.created}, busy=${busy} (ticket=${ticketRows[0]?.status}), admin(list=${listed.success ? listed.data.sessions.length : 'ERR'}, pin=${pinRes.status}, destroy=${destroyRes.status}), containerGone=${live.get('itest-spawn-1') === undefined}`,
    );

    // --- the in-sandbox workspace-tool door (the REUSED bridge on the shim).
    const post = (route: string, body?: unknown): Promise<Response> =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const projectRes = z.object({ projectId: z.string() }).safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, {
          name: 'Sandbox Tools Project',
        })
      ).json(),
    );
    const toolProjectId = projectRes.success ? projectRes.data.projectId : '';
    const agentRes = z.object({ agentId: z.string() }).safeParse(
      await (
        await post(`/api/app/projects/${toolProjectId}/agents?orgId=${orgId}`, {
          name: 'Tool Bot',
          harness: 'claude-code',
          model: 'anthropic/claude-fable-5',
          skills: [],
          connectors: [],
        })
      ).json(),
    );
    const toolAgentId = agentRes.success ? agentRes.data.agentId : '';
    // Free the project budget of every session earlier scenarios left live.
    for (const leftover of [
      'itest-sb-1',
      'itest-sb-2',
      'itest-sb-3',
      'itest-sb-4',
      'itest-spawn-adopt',
    ]) {
      await sessions.markSessionDestroyed(sql, {
        organizationId: orgId,
        sessionId: leftover,
      });
    }
    await service.provisionSession(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-tools',
      profile: 'agent',
      ownerType: 'project_agent',
      ownerId: toolAgentId,
      createdBy: userId,
    });
    const { createHash: hashFn } = await import('node:crypto');
    const vk = 'itest-vk-tools-1';
    await sessions.insertSessionToken(sql, {
      organizationId: orgId,
      sessionId: 'itest-spawn-tools',
      tokenHash: hashFn('sha256').update(vk).digest('hex'),
      llmGatewayKeyId: 'vk-id-1',
      scope: {
        agentKind: 'claude-code',
        allowedModels: [],
        connectorGrants: [],
        budgetCents: 100,
        toolGrants: ['product_find', 'document_find'],
      },
      ttlMs: 60_000,
    });
    const dispatch = (body: unknown, token = vk): Promise<Response> =>
      fetch(`${base}/api/tools/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    const statusListing = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .loose()
      .safeParse(
        await (
          await fetch(`${base}/api/tools/status`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${vk}`,
            },
            body: '{}',
          })
        ).json(),
      );
    const productFind = z
      .object({ status: z.string() })
      .loose()
      .safeParse(
        await (
          await dispatch({ tool: 'product_find', args: { name: 'Widget' } })
        ).json(),
      );
    const productRaw = JSON.stringify(productFind.success ? productFind : {});
    const ungranted = z
      .object({ status: z.string() })
      .loose()
      .safeParse(
        await (await dispatch({ tool: 'contact_find', args: {} })).json(),
      );
    const badToken = await dispatch(
      { tool: 'product_find', args: {} },
      'wrong-token',
    );
    const ledger = await sql<{ tool: string; outcome: string }[]>`
      SELECT tool, outcome FROM app.sandbox_tool_calls
      WHERE session_id = 'itest-spawn-tools'
      ORDER BY created_at_ms
    `;
    record(
      'workspace-tool door (session-token auth + reused bridge)',
      statusListing.success &&
        statusListing.data.tools.map((t) => t.name).join(',') ===
          'product_find,document_find' &&
        productFind.success &&
        productFind.data.status === 'ok' &&
        productRaw.includes('Widget') &&
        ungranted.success &&
        ungranted.data.status === 'unavailable' &&
        badToken.status === 401 &&
        ledger.some(
          (row) => row.tool === 'product_find' && row.outcome === 'ok',
        ),
      `status=${statusListing.success ? statusListing.data.tools.length : 'ERR'} tools, product_find=${productFind.success ? productFind.data.status : 'ERR'} (hit=${productRaw.includes('Widget')}), ungranted=${ungranted.success ? ungranted.data.status : 'ERR'}, badToken → ${badToken.status} (want 401), ledger=${ledger.map((r) => `${r.tool}:${r.outcome}`).join('/')}`,
    );
  } finally {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
    await new Promise<void>((resolve) => {
      spawner.close(() => resolve());
    });
  }
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

  if (!process.env.KNOWLEDGE_DATABASE_URL) {
    // Same throwaway server; the tale-db image creates tale_knowledge.
    process.env.KNOWLEDGE_DATABASE_URL = databaseUrl.replace(
      /\/[^/]+$/,
      '/tale_knowledge',
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
    await checkAgents(baseUrl, authCtx);
    await checkSkills(baseUrl, authCtx);
    await checkProviderCredentials(sql, baseUrl, authCtx);
    await checkKnowledge(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkChat(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkAutomations(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkRestDoor(sql, baseUrl, authCtx);
    await checkGovernance(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkSandboxSessions(sql, authCtx);
    await checkSandboxSpawner(sql, baseUrl, authCtx);
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
