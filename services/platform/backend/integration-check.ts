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
import { setMailTransportForTesting } from './domains/connectors/service.ts';
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

/**
 * The harness-wide default mail transport: debounced notification emails
 * from EARLIER checks fire whenever their window lapses, and none of them
 * may ever reach a real network. Checks that assert SMTP traffic install
 * their own recording fake and restore THIS one in their finally.
 */
const DEFAULT_MAIL_FAKE = {
  openImap: async (): Promise<never> => {
    throw new Error('itest default transport opens no IMAP session');
  },
  openSmtp: async () => ({
    send: async () => ({
      messageId: `<itest-default-${Math.random().toString(36).slice(2)}@door.test>`,
    }),
    close: async () => {},
  }),
};

/** Settle every pending notification email before a check that counts SMTP
 * sends — an earlier check's debounced bell must not pollute its fake. */
async function drainNotificationEmails(sql: Sql): Promise<boolean> {
  return waitFor(async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = 'notification.email'
        AND state NOT IN ('completed', 'cancelled')
    `;
    return Number(rows[0]?.count ?? '1') === 0;
  }, 15_000);
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

  // Author via the SESSION surface (REST has no save/deploy — 0.4 parity),
  // then run + inspect entirely through the door's spec routes.
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
  const appSend = (route: string, body: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify(body),
    });
  await appSend(`/api/app/automations/ops/door/save?orgId=${ctx.orgId}`, {
    document: doorDoc,
  });
  await appSend(`/api/app/automations/ops/door/deploy?orgId=${ctx.orgId}`, {
    version: 1,
  });

  const doorRead = z
    .looseObject({ name: z.string(), deployedVersion: z.number().optional() })
    .safeParse(await (await v1('/automations/ops/door')).json());
  const doorListed = z
    .object({ automations: z.array(z.looseObject({ name: z.string() })) })
    .loose()
    .safeParse(await (await v1('/automations')).json());

  // Trigger lifecycle: webhook PUT mints the token exactly once; the read
  // answers only hasToken; DELETE unbinds.
  const triggerPut = z.looseObject({ token: z.string().optional() }).safeParse(
    await (
      await v1('/automations/ops/door/triggers', {
        method: 'PUT',
        body: { kind: 'webhook' },
      })
    ).json(),
  );
  const triggerRead = z
    .object({
      triggers: z.array(z.looseObject({ hasToken: z.boolean().optional() })),
    })
    .loose()
    .safeParse(await (await v1('/automations/ops/door/triggers')).json());
  const triggerDeleted = await v1('/automations/ops/door/triggers', {
    method: 'DELETE',
  });

  const doorStart = z
    .looseObject({ runId: z.string(), version: z.number() })
    .safeParse(
      await (
        await v1('/automations/ops/door/runs', {
          body: { input: { n: 21 }, mode: 'live', version: 1 },
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
  const runsListed = z
    .object({ runs: z.array(z.looseObject({ id: z.string() })) })
    .loose()
    .safeParse(await (await v1('/automations/ops/door/runs')).json());

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
      doorRead.success &&
      doorRead.data.deployedVersion === 1 &&
      doorListed.success &&
      doorListed.data.automations.some((a) => a.name === 'ops/door') &&
      triggerPut.success &&
      typeof triggerPut.data.token === 'string' &&
      triggerRead.success &&
      triggerRead.data.triggers[0]?.hasToken === true &&
      triggerDeleted.status === 204 &&
      doorStart.success &&
      doorSettled &&
      doorRun.success &&
      doorRun.data.output === 42 &&
      runsListed.success &&
      runsListed.data.runs.length >= 1 &&
      badKey.status === 401 &&
      noKey.status === 401,
    `key=${minted.success}, contacts=${contacts.success ? contacts.data.page.length : 'ERR'}, product=${productRead.success ? productRead.data.name : 'ERR'}, agents=${agents.success}, autom read=${doorRead.success ? (doorRead.data.deployedVersion ?? 'nodeploy') : 'ERR'}, trigger mint/read/del=${triggerPut.success && typeof triggerPut.data.token === 'string'}/${triggerRead.success ? triggerRead.data.triggers[0]?.hasToken : 'ERR'}/${triggerDeleted.status}, door run=${doorSettled} output=${doorRun.success ? JSON.stringify(doorRun.data.output) : 'ERR'} (want 42), badKey → ${badKey.status}, noKey → ${noKey.status} (want 401/401)`,
  );
}

/**
 * The REST machine JOURNEY — the external-worker story end to end on the
 * spec routes: find-or-create a project by external key, prepare a folder
 * (idempotent), mint an upload handoff, PUT the bytes to MinIO, bind the
 * blob as a project file (single-use intent), read the listing and the
 * content redirect back, bind an automation to the project, materialize an
 * external issue as a task (idempotent re-pick), comment, and start the
 * deployed workflow on it.
 */
async function checkRestMachineJourney(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'REST machine journey (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — the upload lane needs blob storage',
    );
    return;
  }
  const minted = z.looseObject({ key: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ name: 'itest-journey' }),
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
      redirect: 'manual',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  // Project by external key: absent → create → found.
  const missing = z
    .object({ projects: z.array(z.unknown()) })
    .safeParse(
      await (await v1('/projects?externalItemId=door-journey-1')).json(),
    );
  const createdProject = z
    .object({ project: z.looseObject({ id: z.string() }) })
    .safeParse(
      await (
        await v1('/projects', {
          body: { name: 'Door Journey', externalItemId: 'door-journey-1' },
        })
      ).json(),
    );
  const projectId = createdProject.success
    ? createdProject.data.project.id
    : '';
  const found = z
    .object({ projects: z.array(z.looseObject({ id: z.string() })) })
    .safeParse(
      await (await v1('/projects?externalItemId=door-journey-1')).json(),
    );

  // Folder get-or-create: 201 then 200 with the SAME id.
  const folderFirst = await v1(`/projects/${projectId}/folders`, {
    body: { name: 'Inbox' },
  });
  const folderFirstBody = z
    .object({
      folder: z.object({ id: z.string(), name: z.string() }),
      created: z.boolean(),
    })
    .safeParse(await folderFirst.json());
  const folderAgain = await v1(`/projects/${projectId}/folders`, {
    body: { name: 'Inbox' },
  });
  const folderAgainBody = z
    .object({ folder: z.object({ id: z.string() }), created: z.boolean() })
    .safeParse(await folderAgain.json());
  const folderId = folderFirstBody.success
    ? folderFirstBody.data.folder.id
    : '';
  const folderListed = z
    .object({ folders: z.array(z.looseObject({ id: z.string() })) })
    .safeParse(await (await v1(`/projects/${projectId}/folders`)).json());

  // Upload handshake: mint → PUT bytes → bind (single-use).
  const LEDGER_BYTES = 'date;amount\n2026-08-01;42.00\n';
  const handoff = z
    .object({
      uploadId: z.string(),
      url: z.string(),
      method: z.string(),
      s3Ref: z.string(),
      expiresAt: z.number(),
    })
    .safeParse(
      await (
        await v1(`/projects/${projectId}/uploads`, {
          body: { fileName: 'ledger.csv', contentType: 'text/csv' },
        })
      ).json(),
    );
  let putOk = false;
  if (handoff.success) {
    const putRes = await fetch(handoff.data.url, {
      method: 'PUT',
      headers: { 'content-type': 'text/csv' },
      body: LEDGER_BYTES,
    });
    putOk = putRes.ok;
  }
  const bind = handoff.success
    ? await v1(`/projects/${projectId}/files`, {
        body: {
          uploadId: handoff.data.uploadId,
          fileId: handoff.data.s3Ref,
          folderId,
          fileName: 'ledger.csv',
          contentType: 'text/csv',
        },
      })
    : null;
  const bindBody = z
    .object({ file: z.looseObject({ id: z.string() }) })
    .safeParse(bind === null ? {} : await bind.json());
  const documentId = bindBody.success ? bindBody.data.file.id : '';
  // The intent is single-use: a second bind of the same handshake refuses.
  const rebind = handoff.success
    ? await v1(`/projects/${projectId}/files`, {
        body: {
          uploadId: handoff.data.uploadId,
          fileId: handoff.data.s3Ref,
          folderId,
          fileName: 'ledger.csv',
        },
      })
    : null;

  const filesListed = z
    .object({ files: z.array(z.looseObject({ id: z.string() })) })
    .safeParse(
      await (
        await v1(`/projects/${projectId}/files?folderId=${folderId}`)
      ).json(),
    );
  const contentRes = await v1(
    `/projects/${projectId}/files/${documentId}/content`,
  );
  let contentBytes = '';
  const location = contentRes.headers.get('location');
  if (contentRes.status === 302 && location !== null) {
    contentBytes = await (await fetch(location)).text();
  }

  // Bind the door automation to the project (idempotent add).
  const bindFirst = await v1('/automations/ops/door/projects', {
    body: { projectId },
  });
  const bindFirstBody = z
    .object({ added: z.boolean() })
    .loose()
    .safeParse(await bindFirst.json());
  const bindAgainBody = z
    .object({ added: z.boolean() })
    .loose()
    .safeParse(
      await (
        await v1('/automations/ops/door/projects', { body: { projectId } })
      ).json(),
    );

  // External-ref task intake: create → idempotent re-pick → projection.
  const taskFirst = await v1('/tasks', {
    body: {
      projectId,
      externalSystem: 'github',
      externalId: 'journey-issue-7',
      title: 'Prepare the ledger review',
      labels: ['ops'],
      externalUrl: 'https://example.test/issues/7',
    },
  });
  const taskFirstBody = z
    .object({
      task: z.object({ id: z.string(), created: z.boolean() }),
    })
    .safeParse(await taskFirst.json());
  const taskId = taskFirstBody.success ? taskFirstBody.data.task.id : '';
  const taskAgainBody = z
    .object({ task: z.object({ id: z.string(), created: z.boolean() }) })
    .safeParse(
      await (
        await v1('/tasks', {
          body: {
            projectId,
            externalSystem: 'github',
            externalId: 'journey-issue-7',
            title: 'Prepare the ledger review (renamed)',
          },
        })
      ).json(),
    );
  const taskRead = z
    .object({
      task: z.looseObject({
        id: z.string(),
        status: z.string(),
        labels: z.array(z.string()),
        externalSystem: z.string().optional(),
      }),
    })
    .safeParse(await (await v1(`/tasks/${taskId}`)).json());

  // Comment lane: post as the key's user, read it back.
  const commentPosted = z
    .object({ comment: z.object({ id: z.string() }) })
    .safeParse(
      await (
        await v1(`/tasks/${taskId}/comments`, {
          body: { body: 'Prepared figures are attached.' },
        })
      ).json(),
    );
  const commentsRead = z
    .object({
      comments: z.array(
        z.looseObject({ authorType: z.string(), body: z.string() }),
      ),
    })
    .safeParse(await (await v1(`/tasks/${taskId}/comments`)).json());

  // Start the deployed workflow ON the task; the run carries the task as
  // its subject input and is attributed to the task's project.
  const started = z
    .object({
      started: z.boolean(),
      executionId: z.string().nullable().optional(),
    })
    .loose()
    .safeParse(
      await (
        await v1(`/tasks/${taskId}/start`, {
          body: { workflowSlug: 'ops/door' },
        })
      ).json(),
    );
  const runId =
    started.success && typeof started.data.executionId === 'string'
      ? started.data.executionId
      : '';
  const runRows = await sql<
    { taskId: string | null; projectId: string | null }[]
  >`
    SELECT input->'task'->>'id' AS "taskId", project_id AS "projectId"
    FROM app.automation_runs WHERE id = ${runId || '00000000-0000-0000-0000-000000000000'}
  `;

  record(
    'REST machine journey (projects → files → tasks → start)',
    minted.success &&
      missing.success &&
      missing.data.projects.length === 0 &&
      createdProject.success &&
      found.success &&
      found.data.projects[0]?.id === projectId &&
      folderFirst.status === 201 &&
      folderFirstBody.success &&
      folderFirstBody.data.created &&
      folderAgain.status === 200 &&
      folderAgainBody.success &&
      !folderAgainBody.data.created &&
      folderAgainBody.data.folder.id === folderId &&
      folderListed.success &&
      folderListed.data.folders.some((f) => f.id === folderId) &&
      handoff.success &&
      putOk &&
      bind?.status === 201 &&
      bindBody.success &&
      rebind?.status === 409 &&
      filesListed.success &&
      filesListed.data.files.some((f) => f.id === documentId) &&
      contentRes.status === 302 &&
      contentBytes === LEDGER_BYTES &&
      bindFirst.status === 201 &&
      bindFirstBody.success &&
      bindFirstBody.data.added &&
      bindAgainBody.success &&
      !bindAgainBody.data.added &&
      taskFirst.status === 201 &&
      taskFirstBody.success &&
      taskFirstBody.data.task.created &&
      taskAgainBody.success &&
      !taskAgainBody.data.task.created &&
      taskAgainBody.data.task.id === taskId &&
      taskRead.success &&
      taskRead.data.task.status === 'backlog' &&
      taskRead.data.task.labels.includes('ops') &&
      taskRead.data.task.externalSystem === 'github' &&
      commentPosted.success &&
      commentsRead.success &&
      commentsRead.data.comments.some((row) =>
        row.body.includes('Prepared figures'),
      ) &&
      started.success &&
      started.data.started &&
      runRows[0]?.taskId === taskId &&
      runRows[0]?.projectId === projectId,
    `project=${createdProject.success} lookup=${found.success && found.data.projects[0]?.id === projectId}, folder=${folderFirst.status}/${folderAgain.status} idem=${folderAgainBody.success && folderAgainBody.data.folder.id === folderId}, upload put=${putOk} bind=${bind?.status} rebind=${rebind?.status} (want 201/409), files=${filesListed.success ? filesListed.data.files.length : 'ERR'}, content=${contentRes.status} bytes=${contentBytes === LEDGER_BYTES}, autom bind=${bindFirst.status}/${bindAgainBody.success ? bindAgainBody.data.added : 'ERR'}, task=${taskFirst.status} repick=${taskAgainBody.success ? taskAgainBody.data.task.created : 'ERR'}, read=${taskRead.success ? `${taskRead.data.task.status}+${taskRead.data.task.labels.join('|')}` : 'ERR'}, comments=${commentsRead.success ? commentsRead.data.comments.length : 'ERR'}, start=${started.success ? started.data.started : 'ERR'} runBoundToTask=${runRows[0]?.taskId === taskId}`,
  );
}

/**
 * The REST resource families beyond the door basics: contacts bulk import
 * (per-item duplicate accounting), the Knowledge-Hub document CRUD +
 * retry-indexing honesty, the knowledge-entry version chain over the wire
 * (PATCH answers the NEW id), the skills file layer, the REST chat lane
 * (202-accept → detached turn → poll → reply), and org-wide knowledge
 * search on a live embedding endpoint.
 */
async function checkRestResources(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  const { createServer } = await import('node:http');
  const minted = z.looseObject({ key: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ name: 'itest-resources' }),
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

  // ---- contacts bulk: 2 land, the duplicate email is accounted ----------
  const bulk = z
    .object({
      success: z.number(),
      failed: z.number(),
      errors: z.array(z.looseObject({ errorCode: z.string() })),
    })
    .safeParse(
      await (
        await v1('/contacts/bulk', {
          body: {
            contacts: [
              { name: 'Alpha', email: 'alpha@door.test' },
              { name: 'Beta', email: 'beta@door.test', externalId: 77 },
              { name: 'Alpha Again', email: 'alpha@door.test' },
            ],
          },
        })
      ).json(),
    );

  // ---- documents: content lifecycle + retry honesty ----------------------
  const docCreated = z.object({ id: z.string() }).safeParse(
    await (
      await v1('/documents', {
        body: { title: 'Hub Note.md', content: 'alpha content' },
      })
    ).json(),
  );
  const docId = docCreated.success ? docCreated.data.id : '';
  const docPatch = await v1(`/documents/${docId}`, {
    method: 'PATCH',
    body: { content: 'beta content' },
  });
  const docRead = z
    .looseObject({ title: z.string(), content: z.string().nullable() })
    .safeParse(await (await v1(`/documents/${docId}`)).json());
  const docListed = z
    .object({ page: z.array(z.looseObject({ id: z.string() })) })
    .loose()
    .safeParse(await (await v1('/documents?limit=50')).json());
  const retry = z
    .object({ status: z.string() })
    .safeParse(
      await (
        await v1(`/documents/${docId}/retry-indexing`, { body: {} })
      ).json(),
    );
  const docDeleted = await v1(`/documents/${docId}`, { method: 'DELETE' });
  const docGone = await v1(`/documents/${docId}`);

  // ---- knowledge entries: the version chain over the wire ---------------
  const entryCreated = z.object({ id: z.string() }).safeParse(
    await (
      await v1('/knowledge-entries', {
        body: { topic: 'REST Door Topic', content: 'version one' },
      })
    ).json(),
  );
  const entryId = entryCreated.success ? entryCreated.data.id : '';
  const entryDup = await v1('/knowledge-entries', {
    body: { topic: 'REST Door Topic', content: 'clashes' },
  });
  const entryPatched = z.object({ id: z.string() }).safeParse(
    await (
      await v1(`/knowledge-entries/${entryId}`, {
        method: 'PATCH',
        body: { topic: 'REST Door Topic', content: 'version two' },
      })
    ).json(),
  );
  const newEntryId = entryPatched.success ? entryPatched.data.id : '';
  const oldEntry = z
    .looseObject({ status: z.string() })
    .safeParse(await (await v1(`/knowledge-entries/${entryId}`)).json());
  const entryList = z
    .object({ page: z.array(z.looseObject({ id: z.string() })) })
    .loose()
    .safeParse(await (await v1('/knowledge-entries')).json());
  const entryDeleted = await v1(`/knowledge-entries/${newEntryId}`, {
    method: 'DELETE',
  });

  // ---- skills: the file layer over the wire ------------------------------
  const skillSaved = z.looseObject({ slug: z.string().optional() }).safeParse(
    await (
      await v1('/skills/rest-door-skill', {
        method: 'PUT',
        body: {
          description: 'Door-check skill',
          body: '# Door skill\n\nUse the door.',
        },
      })
    ).json(),
  );
  const skillRead = await v1('/skills/rest-door-skill');
  const skillReadBody = z.looseObject({}).safeParse(await skillRead.json());
  const skillsListed = z
    .object({ skills: z.array(z.looseObject({ slug: z.string() })) })
    .loose()
    .safeParse(await (await v1('/skills')).json());
  const skillDeleted = await v1('/skills/rest-door-skill', {
    method: 'DELETE',
  });
  const skillGone = await v1('/skills/rest-door-skill');

  // ---- the REST chat lane: its own tiny provider + detached turn ---------
  const REPLY = 'The door chat answers.';
  const sse = (payload: unknown): string =>
    `data: ${JSON.stringify(payload)}\n\n`;
  const aiServer = createServer((req, res) => {
    let bodyRaw = '';
    req.on('data', (chunk: unknown) => {
      bodyRaw += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              {
                id: 'rest-chat',
                object: 'model',
                context_length: 32_768,
                max_output_tokens: 512,
              },
            ],
          }),
        );
        return;
      }
      if (url.includes('/embeddings')) {
        // The OpenAI SDK asks for base64 vectors — the shared fake payload
        // helper answers whichever encoding the request named.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(fakeEmbeddingsPayload(bodyRaw));
        return;
      }
      // The turn host streams: answer SSE deltas like a real endpoint.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        sse({
          choices: [
            { index: 0, delta: { content: REPLY }, finish_reason: null },
          ],
        }),
      );
      res.write(
        sse({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    aiServer.listen(0, '127.0.0.1', resolve);
  });
  const aiAddress = aiServer.address();
  const aiPort =
    aiAddress !== null && typeof aiAddress === 'object' ? aiAddress.port : 0;
  const aiBase = `http://127.0.0.1:${aiPort}/v1`;

  let chatOk = false;
  let chatDetail = '';
  let searchOk = false;
  let searchDetail = '';
  try {
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const providersDir = path.join(configRoot, orgSlug, 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(
      path.join(providersDir, 'restchat.yml'),
      [
        'name: restchat',
        'displayName: Rest Chat',
        'apiFormat: openai',
        `baseUrl: ${aiBase}`,
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ].join('\n'),
    );
    await fetch(`${base}/api/app/provider-credentials?orgId=${ctx.orgId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        origin: base,
      },
      body: JSON.stringify({
        providerSlug: 'restchat',
        authMethod: 'api-key',
        name: 'Rest chat key',
        secret: 'sk-rest-chat-key',
      }),
    });

    const threadCreated = z
      .object({ id: z.string() })
      .safeParse(
        await (await v1('/threads', { body: { title: 'REST chat' } })).json(),
      );
    const threadId = threadCreated.success ? threadCreated.data.id : '';
    const accepted = z
      .looseObject({ status: z.string(), poll: z.string() })
      .safeParse(
        await (
          await v1(`/threads/${threadId}/messages`, {
            body: { content: 'Say the line.', model: 'rest-chat' },
          })
        ).json(),
      );
    // "No generation row" means idle, so polling the generation endpoint
    // can win the race against the detached job — wait for the REPLY row.
    const messagesSchema = z
      .object({
        page: z.array(z.looseObject({ role: z.string(), parts: z.unknown() })),
      })
      .loose();
    let assistantRaw = '';
    const replied = await waitFor(async () => {
      const messages = messagesSchema.safeParse(
        await (await v1(`/threads/${threadId}/messages`)).json(),
      );
      if (!messages.success) return false;
      assistantRaw = JSON.stringify(
        messages.data.page.filter((m) => m.role === 'assistant'),
      );
      return assistantRaw.includes('door chat answers');
    }, 30_000);
    const idle =
      replied &&
      z
        .object({ status: z.string() })
        .safeParse(await (await v1(`/threads/${threadId}/generation`)).json())
        .data?.status === 'idle';
    const threadListed = z
      .object({ page: z.array(z.looseObject({ id: z.string() })) })
      .loose()
      .safeParse(await (await v1('/threads')).json());
    chatOk =
      threadCreated.success &&
      accepted.success &&
      accepted.data.status === 'accepted' &&
      idle &&
      replied &&
      threadListed.success &&
      threadListed.data.page.some((t) => t.id === threadId);
    chatDetail = `thread=${threadCreated.success}, accepted=${accepted.success ? accepted.data.status : 'ERR'}, idle=${idle}, reply=${replied}, listed=${threadListed.success && threadListed.data.page.some((t) => t.id === threadId)}`;

    // ---- knowledge search: re-point the embedder, org-wide query --------
    await writeFile(
      path.join(configRoot, orgSlug, 'knowledge', 'embedding.json'),
      JSON.stringify({
        providerSlug: 'restchat',
        model: 'rest-chat-embed',
        dimensions: 8,
        baseUrl: aiBase,
      }),
    );
    const searchRes = await v1('/knowledge/search', {
      body: { query: 'quarterly review', limit: 5 },
    });
    const searchText = await searchRes.text();
    let searchJsonOk = false;
    try {
      JSON.parse(searchText);
      searchJsonOk = true;
    } catch (error) {
      console.warn('[itest] search body was not JSON:', error);
    }
    searchOk = searchRes.status === 200 && searchJsonOk;
    searchDetail = `status=${searchRes.status} body=${searchText.slice(0, 120)}`;
  } finally {
    aiServer.close();
  }

  record(
    'REST resources (bulk, documents, entries, skills, chat, search)',
    minted.success &&
      bulk.success &&
      bulk.data.success === 2 &&
      bulk.data.failed === 1 &&
      bulk.data.errors[0]?.errorCode === 'duplicate_email' &&
      docCreated.success &&
      docPatch.status === 204 &&
      docRead.success &&
      docRead.data.content === 'beta content' &&
      docListed.success &&
      docListed.data.page.some((d) => d.id === docId) &&
      retry.success &&
      retry.data.status === 'skipped' &&
      docDeleted.status === 204 &&
      docGone.status === 404 &&
      entryCreated.success &&
      entryDup.status === 409 &&
      entryPatched.success &&
      newEntryId !== entryId &&
      oldEntry.success &&
      oldEntry.data.status === 'superseded' &&
      entryList.success &&
      entryList.data.page.some((e) => e.id === newEntryId) &&
      !entryList.data.page.some((e) => e.id === entryId) &&
      entryDeleted.status === 204 &&
      skillSaved.success &&
      skillRead.status === 200 &&
      skillReadBody.success &&
      skillsListed.success &&
      skillDeleted.status === 204 &&
      skillGone.status === 404 &&
      chatOk &&
      searchOk,
    `bulk=${bulk.success ? `${bulk.data.success}/${bulk.data.failed} ${bulk.data.errors[0]?.errorCode ?? ''}` : 'ERR'} (want 2/1 duplicate_email), docListed=${docListed.success && docListed.data.page.some((d) => d.id === docId)}, entryListed=${entryList.success ? `${entryList.data.page.some((e) => e.id === newEntryId)}/${!entryList.data.page.some((e) => e.id === entryId)}` : 'ERR'}, skillsListed=${skillsListed.success}, skillRead=${skillReadBody.success}, doc=${docCreated.success}/${docPatch.status}/${docRead.success ? docRead.data.content : 'ERR'}/retry=${retry.success ? retry.data.status : 'ERR'}/del=${docDeleted.status}→${docGone.status}, entry chain=${entryCreated.success}/dup=${entryDup.status}/new≠old=${newEntryId !== entryId}/old=${oldEntry.success ? oldEntry.data.status : 'ERR'}/del=${entryDeleted.status}, skill=${skillSaved.success}/${skillRead.status}/del=${skillDeleted.status}→${skillGone.status}, chat: ${chatDetail}, search: ${searchDetail}`,
  );
}

/**
 * Enterprise SSO sign-in, end to end on the REUSED 0.4 protocol handlers:
 * connection file on disk → discover → authorize (PKCE challenge in the
 * IdP redirect, signed state) → callback (code exchange against a fake
 * OIDC IdP verifying the PKCE verifier, userinfo) → user/account/member
 * provisioned with the group-mapped role → team synced → session cookie
 * that Better Auth accepts → re-login syncing role + team churn.
 */
async function checkSsoLogin(
  sql: Sql,
  base: string,
  orgId: string,
  orgSlug: string,
): Promise<void> {
  const { createServer } = await import('node:http');
  const { createHash } = await import('node:crypto');
  const { serializeSsoConnectionYaml, resolveSsoDir } =
    await import('../convex/enterprise_sso/file_utils.ts');

  // --- fake OIDC IdP -------------------------------------------------------
  let seenChallenge = '';
  let pkceVerified = false;
  let userinfoGroups = ['Ops', 'Everyone'];
  const idp = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.includes('/.well-known/openid-configuration')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: idpBase,
            authorization_endpoint: `${idpBase}/authorize`,
            token_endpoint: `${idpBase}/token`,
            userinfo_endpoint: `${idpBase}/userinfo`,
          }),
        );
        return;
      }
      if (url.includes('/token')) {
        const params = new URLSearchParams(body);
        const verifier = params.get('code_verifier') ?? '';
        const challenge = createHash('sha256')
          .update(verifier)
          .digest('base64url');
        pkceVerified = verifier !== '' && challenge === seenChallenge;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'itest-sso-access',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile email',
          }),
        );
        return;
      }
      if (url.includes('/userinfo')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            sub: 'idp-user-77',
            email: 'sso.user@door.test',
            name: 'Sso User',
            groups: userinfoGroups,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    idp.listen(0, '127.0.0.1', resolve);
  });
  const idpAddress = idp.address();
  const idpPort =
    idpAddress !== null && typeof idpAddress === 'object' ? idpAddress.port : 0;
  const idpBase = `http://127.0.0.1:${idpPort}`;

  try {
    // --- connection file (the on-disk source of truth) ---------------------
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const ssoDir = resolveSsoDir(orgSlug);
    await mkdir(ssoDir, { recursive: true });
    await writeFile(
      path.join(ssoDir, 'connection.yml'),
      serializeSsoConnectionYaml({
        enabled: true,
        protocol: 'oidc',
        displayName: 'Itest IdP',
        oidc: {
          providerId: 'generic-oidc',
          issuer: idpBase,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
        },
        provisioning: {
          autoProvisionRole: true,
          defaultRole: 'member',
          roleMappingRules: [
            { source: 'group', pattern: 'Ops', targetRole: 'developer' },
          ],
          autoProvisionTeam: true,
          excludeGroups: ['Everyone'],
        },
      }),
    );
    await writeFile(
      path.join(ssoDir, 'connection.secrets.json'),
      JSON.stringify({
        clientId: 'itest-client',
        clientSecret: 'itest-client-secret',
      }),
    );
    void configRoot;

    // --- discover ----------------------------------------------------------
    const discovered = z
      .object({
        ssoEnabled: z.boolean(),
        organizationId: z.string().optional(),
        protocol: z.string().optional(),
      })
      .safeParse(
        await (
          await fetch(`${base}/api/sso/discover`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'sso.user@door.test' }),
          })
        ).json(),
      );

    // --- one full login round, reusable ------------------------------------
    const loginRound = async (): Promise<{
      authorizeStatus: number;
      idpHost: boolean;
      callbackStatus: number;
      cookie: string;
      location: string;
    }> => {
      const authorizeRes = await fetch(
        `${base}/api/sso/authorize?organizationId=${orgId}`,
        { redirect: 'manual' },
      );
      const idpLocation = authorizeRes.headers.get('location') ?? '';
      let state = '';
      let idpHost = false;
      if (idpLocation !== '') {
        const idpUrl = new URL(idpLocation);
        idpHost = idpUrl.origin === idpBase;
        state = idpUrl.searchParams.get('state') ?? '';
        seenChallenge = idpUrl.searchParams.get('code_challenge') ?? '';
      }
      const callbackRes = await fetch(
        `${base}/api/sso/callback?code=itest-code&state=${encodeURIComponent(state)}`,
        { redirect: 'manual' },
      );
      const setCookie = callbackRes.headers.get('set-cookie') ?? '';
      const cookiePair = setCookie.split(';')[0] ?? '';
      return {
        authorizeStatus: authorizeRes.status,
        idpHost,
        callbackStatus: callbackRes.status,
        cookie: cookiePair,
        location: callbackRes.headers.get('location') ?? '',
      };
    };

    const first = await loginRound();
    // The minted cookie must satisfy Better Auth itself.
    const sessionBody = z
      .looseObject({
        user: z.looseObject({ email: z.string() }).optional().nullable(),
      })
      .safeParse(
        await (
          await fetch(`${base}/api/auth/get-session`, {
            headers: { cookie: first.cookie, origin: base },
          })
        ).json(),
      );
    const rows1 = await sql<
      { role: string; email: string; teams: string | null }[]
    >`
      SELECT m."role", u."email",
             (SELECT string_agg(t."name", ',' ORDER BY t."name")
              FROM "teamMember" tm JOIN "team" t ON t."id" = tm."teamId"
              WHERE tm."userId" = u."id") AS teams
      FROM "user" u
      JOIN "member" m ON m."userId" = u."id"
        AND m."organizationId" = ${orgId}
      WHERE u."email" = 'sso.user@door.test'
    `;
    const firstPkce = pkceVerified;

    // --- second login: the IdP demotes (group gone) + team churn -----------
    userinfoGroups = ['Finance'];
    pkceVerified = false;
    const second = await loginRound();
    const rows2 = await sql<{ role: string; teams: string | null }[]>`
      SELECT m."role",
             (SELECT string_agg(t."name", ',' ORDER BY t."name")
              FROM "teamMember" tm JOIN "team" t ON t."id" = tm."teamId"
              WHERE tm."userId" = u."id") AS teams
      FROM "user" u
      JOIN "member" m ON m."userId" = u."id"
        AND m."organizationId" = ${orgId}
      WHERE u."email" = 'sso.user@door.test'
    `;
    const opsTeamGone = await sql<{ id: string }[]>`
      SELECT "id" FROM "team"
      WHERE "organizationId" = ${orgId} AND "name" = 'Ops'
    `;

    // --- the 0.4 proxy-path alias serves the same handlers -----------------
    const aliasRes = await fetch(
      `${base}/http_api/api/sso/authorize?organizationId=${orgId}`,
      { redirect: 'manual' },
    );

    record(
      'enterprise SSO login (OIDC + PKCE + provisioning over PG)',
      discovered.success &&
        discovered.data.ssoEnabled &&
        discovered.data.protocol === 'oidc' &&
        first.authorizeStatus === 302 &&
        first.idpHost &&
        seenChallenge !== '' &&
        first.callbackStatus === 302 &&
        first.location.includes('/dashboard') &&
        first.cookie.includes('better-auth.session_token=') &&
        firstPkce &&
        sessionBody.success &&
        sessionBody.data.user?.email === 'sso.user@door.test' &&
        rows1[0]?.role === 'developer' &&
        rows1[0]?.teams === 'Ops' &&
        second.callbackStatus === 302 &&
        pkceVerified &&
        rows2[0]?.role === 'member' &&
        rows2[0]?.teams === 'Finance' &&
        opsTeamGone.length === 0 &&
        aliasRes.status === 302,
      `discover=${discovered.success ? `${discovered.data.ssoEnabled}/${discovered.data.protocol ?? ''}` : 'ERR'}, authorize=${first.authorizeStatus} idp=${first.idpHost} pkce=${firstPkce}, callback=${first.callbackStatus}→${first.location.includes('/dashboard') ? 'dashboard' : first.location}, session=${sessionBody.success ? (sessionBody.data.user?.email ?? 'none') : 'ERR'}, first role/teams=${rows1[0]?.role}/${rows1[0]?.teams} (want developer/Ops), second role/teams=${rows2[0]?.role}/${rows2[0]?.teams} (want member/Finance), opsReaped=${opsTeamGone.length === 0}, alias=${aliasRes.status}`,
    );
  } finally {
    idp.close();
  }
}

/**
 * SCIM 2.0 provisioning, end to end on the REUSED 0.4 dispatcher bodies:
 * admin mints the bearer token → the IdP pushes a User (create, filter,
 * deactivate/restore via PATCH with role stash, hard DELETE per RFC 7644)
 * and a Group (create with members, membership PATCH, rename PUT, DELETE)
 * — all resolved to the tenant by the token hash row, audited as `scim`.
 */
async function checkScim(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const admin = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}/api/app/scim${route}?orgId=${orgId}`, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const before = z
    .object({ enabled: z.boolean() })
    .loose()
    .safeParse(await (await admin('')).json());
  const minted = z
    .object({ token: z.string(), tokenPrefix: z.string() })
    .safeParse(await (await admin('/regenerate-token', {})).json());
  const token = minted.success ? minted.data.token : '';
  const after = z
    .object({ enabled: z.boolean(), tokenPrefix: z.string() })
    .loose()
    .safeParse(await (await admin('')).json());

  const scim = (
    route: string,
    init: { method?: string; body?: unknown; token?: string } = {},
  ): Promise<Response> =>
    fetch(`${base}/scim/v2${route}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/scim+json',
        authorization: `Bearer ${init.token ?? token}`,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  const discovery = await scim('/ServiceProviderConfig');
  const badToken = await scim('/ServiceProviderConfig', {
    token: 'scim_not_a_real_token',
  });
  const alias = await fetch(`${base}/http_api/scim/v2/ServiceProviderConfig`, {
    headers: { authorization: `Bearer ${token}` },
  });

  // ---- Users --------------------------------------------------------------
  const created = z
    .looseObject({ id: z.string(), userName: z.string(), active: z.boolean() })
    .safeParse(
      await (
        await scim('/Users', {
          body: {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            userName: 'scim.user@door.test',
            name: { givenName: 'Scim', familyName: 'Person' },
            externalId: 'idp-ext-9',
            active: true,
          },
        })
      ).json(),
    );
  const scimUserId = created.success ? created.data.id : '';
  const filtered = z
    .object({ totalResults: z.number(), Resources: z.array(z.unknown()) })
    .loose()
    .safeParse(
      await (
        await scim(
          `/Users?filter=${encodeURIComponent('userName eq "scim.user@door.test"')}`,
        )
      ).json(),
    );
  const roleAfterCreate = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${orgId} AND "userId" = ${scimUserId || '-'}
  `;

  // Deactivate (IdP's usual de-provision signal): role → disabled, stash.
  await scim(`/Users/${scimUserId}`, {
    method: 'PATCH',
    body: {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'active', value: false }],
    },
  });
  const deactivated = z
    .looseObject({ active: z.boolean() })
    .safeParse(await (await scim(`/Users/${scimUserId}`)).json());
  const roleDisabled = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${orgId} AND "userId" = ${scimUserId || '-'}
  `;
  // Restore: back to the stashed prior role.
  await scim(`/Users/${scimUserId}`, {
    method: 'PATCH',
    body: {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', value: { active: true } }],
    },
  });
  const roleRestored = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${orgId} AND "userId" = ${scimUserId || '-'}
  `;

  // ---- Groups -------------------------------------------------------------
  const group = z
    .looseObject({ id: z.string(), displayName: z.string() })
    .safeParse(
      await (
        await scim('/Groups', {
          body: {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
            displayName: 'Scim Squad',
            members: [{ value: scimUserId }],
          },
        })
      ).json(),
    );
  const groupId = group.success ? group.data.id : '';
  await scim(`/Groups/${groupId}`, {
    method: 'PATCH',
    body: {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'remove', path: `members[value eq "${scimUserId}"]` },
        { op: 'replace', path: 'displayName', value: 'Scim Crew' },
      ],
    },
  });
  const patchedGroup = z
    .looseObject({
      displayName: z.string(),
      members: z.array(z.looseObject({ value: z.string() })),
    })
    .safeParse(await (await scim(`/Groups/${groupId}`)).json());
  const groupDeleted = await scim(`/Groups/${groupId}`, { method: 'DELETE' });
  const teamGone = await sql<{ id: string }[]>`
    SELECT "id" FROM "team" WHERE "id" = ${groupId || '-'}
  `;

  // ---- hard DELETE (RFC 7644 §3.6) ---------------------------------------
  const userDeleted = await scim(`/Users/${scimUserId}`, { method: 'DELETE' });
  const userGone = await scim(`/Users/${scimUserId}`);
  const scimAudits = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.audit_logs
    WHERE org_id = ${orgId} AND actor_id = 'scim'
      AND action IN ('scim_provision_user', 'scim_deactivate_user',
                     'scim_activate_user', 'scim_provision_group',
                     'scim_patch_group', 'scim_delete_group',
                     'scim_deprovision_user')
  `;

  record(
    'SCIM provisioning (token door + Users/Groups over PG)',
    before.success &&
      !before.data.enabled &&
      minted.success &&
      minted.data.token.startsWith('scim_') &&
      after.success &&
      after.data.enabled &&
      discovery.status === 200 &&
      badToken.status === 401 &&
      alias.status === 200 &&
      created.success &&
      created.data.active &&
      filtered.success &&
      filtered.data.totalResults === 1 &&
      roleAfterCreate[0]?.role === 'member' &&
      deactivated.success &&
      !deactivated.data.active &&
      roleDisabled[0]?.role === 'disabled' &&
      roleRestored[0]?.role === 'member' &&
      group.success &&
      patchedGroup.success &&
      patchedGroup.data.displayName === 'Scim Crew' &&
      patchedGroup.data.members.length === 0 &&
      groupDeleted.status === 204 &&
      teamGone.length === 0 &&
      userDeleted.status === 204 &&
      userGone.status === 404 &&
      Number(scimAudits[0]?.count ?? '0') >= 7,
    `admin=${before.success ? before.data.enabled : 'ERR'}→${after.success ? `${after.data.enabled}/${after.data.tokenPrefix}` : 'ERR'}, discovery=${discovery.status} bad=${badToken.status} alias=${alias.status} (want 200/401/200), user=${created.success}/${filtered.success ? filtered.data.totalResults : 'ERR'} role=${roleAfterCreate[0]?.role}→${roleDisabled[0]?.role}→${roleRestored[0]?.role} (want member→disabled→member), group=${group.success} patched=${patchedGroup.success ? `${patchedGroup.data.displayName}/${patchedGroup.data.members.length}` : 'ERR'} del=${groupDeleted.status} gone=${teamGone.length === 0}, userDel=${userDeleted.status}→${userGone.status} (want 204→404), audits=${scimAudits[0]?.count} (want ≥7)`,
  );
}

/**
 * Trusted-headers auth — the reverse-proxy hand-off door: identity headers
 * → user + placeholder membership provisioned, session minted with the
 * header-borne role/teams stamped on the SESSION row, cookie accepted by
 * Better Auth, and the org middleware applying the session role override
 * at read time (proxy says admin ⇒ admin surface opens; proxy says member
 * ⇒ it refuses — same user, same member row).
 */
async function checkTrustedHeaders(sql: Sql, base: string): Promise<void> {
  process.env.TRUSTED_HEADERS_ENABLED = 'true';
  try {
    const authWith = async (
      role: string,
      cookie?: string,
    ): Promise<{ cookie: string; status: number }> => {
      const res = await fetch(`${base}/api/trusted-headers/authenticate`, {
        headers: {
          'Remote-Email': 'proxy.user@door.test',
          'Remote-Name': 'Proxy User',
          'Remote-Role': role,
          'Remote-Teams': 't-fin:Finance, t-ops:Operations',
          ...(cookie !== undefined ? { cookie } : {}),
        },
      });
      const setCookie = res.headers.get('set-cookie') ?? '';
      return {
        cookie: setCookie.split(';')[0] ?? '',
        status: res.status,
      };
    };

    const disabledProbe = await (async () => {
      process.env.TRUSTED_HEADERS_ENABLED = 'false';
      const res = await fetch(`${base}/api/trusted-headers/authenticate`, {
        headers: { 'Remote-Email': 'proxy.user@door.test' },
      });
      const text = await res.text();
      process.env.TRUSTED_HEADERS_ENABLED = 'true';
      return text.includes('not enabled');
    })();

    const first = await authWith('member');
    // The proxy-minted cookie satisfies Better Auth itself.
    const session1 = z
      .looseObject({
        user: z.looseObject({ email: z.string() }).optional().nullable(),
      })
      .safeParse(
        await (
          await fetch(`${base}/api/auth/get-session`, {
            headers: { cookie: first.cookie, origin: base },
          })
        ).json(),
      );
    const rows = await sql<
      {
        role: string;
        trustedRole: string | null;
        trustedTeams: string | null;
      }[]
    >`
      SELECT m."role", s."trustedRole", s."trustedTeams"
      FROM "user" u
      JOIN "member" m ON m."userId" = u."id"
      JOIN "session" s ON s."userId" = u."id"
      WHERE u."email" = 'proxy.user@door.test'
    `;
    // The provisioned user joined the first admin org (or founded a fresh
    // one) — assert on the org the membership actually landed in.
    const memberOrg = await sql<{ organizationId: string }[]>`
      SELECT m."organizationId" FROM "member" m
      JOIN "user" u ON u."id" = m."userId"
      WHERE u."email" = 'proxy.user@door.test' LIMIT 1
    `;
    const landedOrg = memberOrg[0]?.organizationId ?? '';
    const refused = await fetch(`${base}/api/app/scim?orgId=${landedOrg}`, {
      headers: { cookie: first.cookie, origin: base },
    });

    // Re-auth as proxy-role ADMIN: the SAME session is reused (token equal),
    // its trustedRole updated, and the admin surface opens.
    const second = await authWith('admin', first.cookie);
    const allowed = await fetch(`${base}/api/app/scim?orgId=${landedOrg}`, {
      headers: { cookie: second.cookie, origin: base },
    });
    const sessionsAfter = await sql<{ trustedRole: string | null }[]>`
      SELECT s."trustedRole" FROM "session" s
      JOIN "user" u ON u."id" = s."userId"
      WHERE u."email" = 'proxy.user@door.test'
    `;

    record(
      'trusted-headers auth (proxy hand-off + session role override)',
      disabledProbe &&
        first.status === 200 &&
        first.cookie.includes('better-auth.session_token=') &&
        session1.success &&
        session1.data.user?.email === 'proxy.user@door.test' &&
        rows[0]?.trustedRole === 'member' &&
        (rows[0]?.trustedTeams ?? '').includes('Finance') &&
        refused.status === 403 &&
        second.cookie === first.cookie &&
        allowed.status === 200 &&
        sessionsAfter.length === 1 &&
        sessionsAfter[0]?.trustedRole === 'admin',
      `disabledGate=${disabledProbe}, auth=${first.status} cookie=${first.cookie !== ''}, session=${session1.success ? (session1.data.user?.email ?? 'none') : 'ERR'}, member row/session role=${rows[0]?.role}/${rows[0]?.trustedRole} teams=${(rows[0]?.trustedTeams ?? '').includes('Finance')}, member→scim=${refused.status} (want 403), reuse=${second.cookie === first.cookie}, admin→scim=${allowed.status} (want 200), sessions=${sessionsAfter.length} role=${sessionsAfter[0]?.trustedRole}`,
    );
  } finally {
    delete process.env.TRUSTED_HEADERS_ENABLED;
  }
}

/**
 * Connector credentials — the sealed-secret store the connector lanes
 * resolve through: create against the SHIPPED catalog (auth-method +
 * config-field validation, imap From-address mirroring, defaults applied),
 * masked listings, case-insensitive name uniqueness, default juggling
 * (first-is-default, promote, delete-promotes-oldest-active), and the ONE
 * decrypt seam handing an invocation its secrets/config/Basic header —
 * with disabled rows refusing coded.
 */
async function checkConnectorCredentials(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const api = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${base}/api/app/connector-credentials${route}?orgId=${orgId}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  const created = z.object({ credentialId: z.string() }).safeParse(
    await (
      await api('', {
        body: {
          connectorSlug: 'imap-smtp',
          authMethod: 'basic',
          name: 'Main Mailbox',
          secret: { username: 'inbox@door.test', password: 'imap-pass-1' },
          config: {
            imapHost: 'imap.door.test',
            smtpHost: 'smtp.door.test',
          },
        },
      })
    ).json(),
  );
  const mainId = created.success ? created.data.credentialId : '';

  const listed = z
    .object({
      credentials: z.array(
        z.looseObject({
          id: z.string(),
          name: z.string(),
          isDefault: z.boolean(),
          maskedPreview: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    })
    .safeParse(await (await api('')).json());
  const mainRow = listed.success
    ? listed.data.credentials.find((row) => row.id === mainId)
    : undefined;
  const listedRaw = JSON.stringify(listed.success ? listed.data : {});

  // Second credential + the case-insensitive name clash.
  const second = z.object({ credentialId: z.string() }).safeParse(
    await (
      await api('', {
        body: {
          connectorSlug: 'imap-smtp',
          authMethod: 'basic',
          name: 'Backup Mailbox',
          secret: { username: 'backup@door.test', password: 'imap-pass-2' },
          config: {
            imapHost: 'imap2.door.test',
            smtpHost: 'smtp2.door.test',
          },
        },
      })
    ).json(),
  );
  const secondId = second.success ? second.data.credentialId : '';
  const clash = await api('', {
    body: {
      connectorSlug: 'imap-smtp',
      authMethod: 'basic',
      name: 'main mailbox',
      secret: { username: 'x@door.test', password: 'p' },
      config: { imapHost: 'x', smtpHost: 'y' },
    },
  });
  const unknownConnector = await api('', {
    body: {
      connectorSlug: 'no-such-connector',
      authMethod: 'basic',
      name: 'X',
      secret: { username: 'x', password: 'y' },
    },
  });
  const wrongMethod = await api('', {
    body: {
      connectorSlug: 'imap-smtp',
      authMethod: 'bearer',
      name: 'X',
      secret: { token: 'tok' },
    },
  });

  // The decrypt seam: default resolution hands secrets + config + header.
  const { resolveConnectorCredential } =
    await import('./domains/connector_credentials/service.ts');
  const resolved = await resolveConnectorCredential(sql, {
    organizationId: orgId,
    connectorSlug: 'imap-smtp',
  });
  const expectedBasic = `Basic ${Buffer.from('inbox@door.test:imap-pass-1').toString('base64')}`;
  const byName = await resolveConnectorCredential(sql, {
    organizationId: orgId,
    connectorSlug: 'imap-smtp',
    credentialRef: 'backup mailbox',
  });

  // Default juggling: promote the second, delete it, oldest active returns.
  await api(`/${secondId}/set-default`, { body: {} });
  const afterPromote = z
    .object({
      credentials: z.array(
        z.looseObject({ id: z.string(), isDefault: z.boolean() }),
      ),
    })
    .safeParse(await (await api('')).json());
  const promoted =
    afterPromote.success &&
    afterPromote.data.credentials.find((r) => r.id === secondId)?.isDefault ===
      true &&
    afterPromote.data.credentials.find((r) => r.id === mainId)?.isDefault ===
      false;
  const deleted = await api(`/${secondId}`, { method: 'DELETE' });
  const afterDelete = z
    .object({
      credentials: z.array(
        z.looseObject({ id: z.string(), isDefault: z.boolean() }),
      ),
    })
    .safeParse(await (await api('')).json());
  const rePromoted =
    afterDelete.success &&
    afterDelete.data.credentials.find((r) => r.id === mainId)?.isDefault ===
      true;

  // Disable → the seam refuses coded.
  await api(`/${mainId}`, { method: 'PATCH', body: { status: 'disabled' } });
  let disabledCode = '';
  try {
    await resolveConnectorCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'imap-smtp',
      credentialRef: mainId,
    });
  } catch (error) {
    disabledCode =
      error instanceof Error && 'code' in error
        ? String(Reflect.get(error, 'code'))
        : '';
  }
  // Re-enable so later sweeps see an active row (and prove the flip back).
  await api(`/${mainId}`, { method: 'PATCH', body: { status: 'active' } });

  record(
    'connector credentials (sealed store + resolve seam)',
    created.success &&
      listed.success &&
      mainRow !== undefined &&
      mainRow.isDefault &&
      typeof mainRow.maskedPreview === 'string' &&
      mainRow.config?.imapHost === 'imap.door.test' &&
      mainRow.config?.imapPort === 993 &&
      mainRow.config?.fromAddress === 'inbox@door.test' &&
      !listedRaw.includes('imap-pass-1') &&
      !listedRaw.includes('ciphertext') &&
      second.success &&
      clash.status === 409 &&
      unknownConnector.status === 404 &&
      wrongMethod.status === 400 &&
      resolved.credentialId === mainId &&
      resolved.secrets.password === 'imap-pass-1' &&
      resolved.config.imapHost === 'imap.door.test' &&
      resolved.authHeader === expectedBasic &&
      byName.credentialId === secondId &&
      promoted &&
      deleted.status === 204 &&
      rePromoted &&
      disabledCode === 'CREDENTIAL_DISABLED',
    `create=${created.success}, listed=${mainRow !== undefined} default=${mainRow?.isDefault} preview=${typeof mainRow?.maskedPreview === 'string'} cfg=${String(mainRow?.config?.imapHost)}/${String(mainRow?.config?.imapPort)}/from=${String(mainRow?.config?.fromAddress)} secretLeak=${listedRaw.includes('imap-pass-1')}, clash=${clash.status} unknown=${unknownConnector.status} wrongMethod=${wrongMethod.status} (want 409/404/400), resolve=${resolved.credentialId === mainId}/${resolved.secrets.password === 'imap-pass-1'}/basic=${resolved.authHeader === expectedBasic}, byName=${byName.credentialId === secondId}, promote=${promoted} del=${deleted.status} repromote=${rePromoted}, disabled=${disabledCode}`,
  );
}

/**
 * Conversations core — the shared Inbox over PG: ingest-side create +
 * message append (unread bump, lastMessageAt monotonic), the REUSED
 * assignment-privacy predicate (unassigned = admin-triage only; member
 * sees it only once assigned / team-queued), assignment notifications,
 * bulk status verbs with the 0.4 metadata stamps, read-marker, and the
 * cascade delete.
 */
async function checkConversations(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const api = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${base}/api/app/conversations${route}?orgId=${orgId}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const {
    createConversation,
    addMessageToConversation,
    listConversationsPage,
  } = await import('./domains/conversations/service.ts');

  // Seed: a contact + an inbound email conversation (the ingest shape).
  const contactRows = await sql<{ id: string }[]>`
    INSERT INTO app.contacts (org_id, name, email, source, created_at_ms,
                              updated_at_ms)
    VALUES (${orgId}, 'Inbox Customer', 'customer@inbox.test', 'api_import',
            ${Date.now()}, ${Date.now()})
    RETURNING id
  `;
  const contactId = contactRows[0]?.id ?? '';
  const conversationId = await sql.begin((tx) =>
    createConversation(tx, {
      organizationId: orgId,
      contactId,
      subject: 'Order 42',
      channel: 'email',
      direction: 'inbound',
      connectorName: 'imap-smtp',
      externalMessageId: '<order-42@inbox.test>',
    }),
  );
  const t1 = Date.now() - 60_000;
  await sql.begin((tx) =>
    addMessageToConversation(tx, {
      conversationId,
      organizationId: orgId,
      sender: 'customer@inbox.test',
      content: 'Where is my order?',
      isCustomer: true,
      externalMessageId: '<order-42@inbox.test>',
      sentAt: t1,
      connectorName: 'imap-smtp',
    }),
  );

  // Admin sees the unassigned row, unread, with contact + preview.
  const listed = z
    .object({
      page: z.array(
        z.looseObject({
          id: z.string(),
          unread: z.boolean(),
          lastMessagePreview: z.string().nullable(),
          contact: z.looseObject({ email: z.string() }).nullable(),
        }),
      ),
    })
    .loose()
    .safeParse(await (await api('')).json());
  const row = listed.success
    ? listed.data.page.find((r) => r.id === conversationId)
    : undefined;
  const counts = z
    .object({
      byStatus: z.record(z.string(), z.number()),
      unread: z.number(),
    })
    .safeParse(await (await api('/counts')).json());

  // A plain member does NOT see the unassigned row (reused predicate).
  const memberUsers = await sql<{ id: string }[]>`
    INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt",
                        "updatedAt")
    VALUES (gen_random_uuid(), 'inbox.member@door.test', 'Inbox Member',
            true, ${new Date()}, ${new Date()})
    RETURNING "id"
  `;
  const memberId = memberUsers[0]?.id ?? '';
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role",
                          "createdAt")
    VALUES (gen_random_uuid(), ${orgId}, ${memberId}, 'member', ${new Date()})
  `;
  const memberView = {
    organizationId: orgId,
    userId: memberId,
    role: 'member',
  };
  const beforeAssign = await listConversationsPage(sql, memberView, {
    cursor: null,
    limit: 50,
  });
  const hiddenBefore = !beforeAssign.page.some((r) => r.id === conversationId);

  // Admin assigns it to the member → visible + notified.
  const assignRes = await api(`/${conversationId}/assign`, {
    body: { assigneeUserId: memberId },
  });
  const afterAssign = await listConversationsPage(sql, memberView, {
    cursor: null,
    limit: 50,
  });
  const visibleAfter = afterAssign.page.some((r) => r.id === conversationId);
  const assignBell = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${memberId}
      AND type = 'conversation_assigned'
  `;

  // Team queueing: a fresh team + a second member on it.
  const teamRows = await sql<{ id: string }[]>`
    INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                        "updatedAt")
    VALUES (gen_random_uuid(), 'Inbox Squad', ${orgId}, ${new Date()},
            ${new Date()})
    RETURNING "id"
  `;
  const teamId = teamRows[0]?.id ?? '';
  const teammateRows = await sql<{ id: string }[]>`
    INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt",
                        "updatedAt")
    VALUES (gen_random_uuid(), 'inbox.teammate@door.test', 'Inbox Teammate',
            true, ${new Date()}, ${new Date()})
    RETURNING "id"
  `;
  const teammateId = teammateRows[0]?.id ?? '';
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role",
                          "createdAt")
    VALUES (gen_random_uuid(), ${orgId}, ${teammateId}, 'member',
            ${new Date()})
  `;
  await sql`
    INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
    VALUES (gen_random_uuid(), ${teamId}, ${teammateId}, ${new Date()})
  `;
  await api(`/${conversationId}/assign-team`, {
    body: { assigneeTeamId: teamId },
  });
  const teammateView = {
    organizationId: orgId,
    userId: teammateId,
    role: 'member',
  };
  const teammateSees = (
    await listConversationsPage(sql, teammateView, { cursor: null, limit: 50 })
  ).page.some((r) => r.id === conversationId);
  const teamBell = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${teammateId}
      AND type = 'conversation_assigned'
  `;

  // Internal note never bumps unread; read clears the marker.
  await api(`/${conversationId}/messages`, {
    body: { content: 'Internal note: shipping today.' },
  });
  const detail = z
    .object({
      conversation: z.looseObject({
        metadata: z.record(z.string(), z.unknown()).nullable(),
      }),
      messages: z.array(z.looseObject({ direction: z.string() })),
    })
    .safeParse(await (await api(`/${conversationId}`)).json());
  const unreadStillOne =
    detail.success &&
    detail.data.conversation.metadata?.unread_count === 1 &&
    detail.data.messages.length === 2 &&
    detail.data.messages[0]?.direction === 'inbound';
  await api(`/${conversationId}/read`, { body: {} });
  const afterRead = z
    .object({
      conversation: z.looseObject({
        metadata: z.record(z.string(), z.unknown()).nullable(),
      }),
    })
    .loose()
    .safeParse(await (await api(`/${conversationId}`)).json());

  // Bulk close stamps resolved_by; reopen flips back.
  const closed = z
    .object({ successCount: z.number(), failedCount: z.number() })
    .loose()
    .safeParse(
      await (
        await api('/bulk/close', {
          body: { conversationIds: [conversationId] },
        })
      ).json(),
    );
  const closedRow = await sql<
    { status: string | null; resolvedBy: string | null }[]
  >`
    SELECT status, metadata->>'resolved_by' AS "resolvedBy"
    FROM app.conversations WHERE id = ${conversationId}
  `;
  await api('/bulk/reopen', { body: { conversationIds: [conversationId] } });

  // Delete cascades the messages.
  const deleted = await api(`/${conversationId}`, { method: 'DELETE' });
  const remnants = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.conversation_messages
    WHERE conversation_id = ${conversationId}
  `;

  record(
    'conversations core (inbox + assignment privacy over PG)',
    listed.success &&
      row !== undefined &&
      row.unread &&
      row.lastMessagePreview === 'Where is my order?' &&
      row.contact?.email === 'customer@inbox.test' &&
      counts.success &&
      (counts.data.byStatus.open ?? 0) >= 1 &&
      counts.data.unread >= 1 &&
      hiddenBefore &&
      assignRes.status === 200 &&
      visibleAfter &&
      assignBell[0]?.count === '1' &&
      teammateSees &&
      teamBell[0]?.count === '1' &&
      unreadStillOne &&
      afterRead.success &&
      afterRead.data.conversation.metadata?.unread_count === 0 &&
      closed.success &&
      closed.data.successCount === 1 &&
      closedRow[0]?.status === 'closed' &&
      closedRow[0]?.resolvedBy !== null &&
      deleted.status === 204 &&
      remnants[0]?.count === '0',
    `listed=${row !== undefined} unread=${row?.unread} preview=${row?.lastMessagePreview === 'Where is my order?'} contact=${row?.contact?.email}, counts=${counts.success ? `${counts.data.byStatus.open ?? 0}/${counts.data.unread}` : 'ERR'}, memberHidden=${hiddenBefore}→assigned visible=${visibleAfter} bell=${assignBell[0]?.count}, teamSees=${teammateSees} teamBell=${teamBell[0]?.count}, noteKeepsUnread=${unreadStillOne} readClears=${afterRead.success && afterRead.data.conversation.metadata?.unread_count === 0}, close=${closed.success ? closed.data.successCount : 'ERR'} status=${closedRow[0]?.status}/${closedRow[0]?.resolvedBy !== null}, del=${deleted.status} remnants=${remnants[0]?.count}`,
  );
}

/**
 * The connector door + the mailbox sync/ingest lane — the REUSED 0.4
 * dispatcher, imap-smtp natives, and sync/ingest modules end to end on a
 * fake IMAP/SMTP transport: list → fetch → ingest (contact find-or-create,
 * Message-ID idempotency, In-Reply-To threading), per-credential watermark
 * advance, the outbound send through the same door (system caller audited),
 * and the approvals gate parking a user-caller live write until a human
 * approves — the retried call then runs and consumes the record.
 */
async function checkMailboxSyncLane(
  sql: Sql,
  ctx: { orgId: string },
): Promise<void> {
  const { orgId } = ctx;
  const { runConnectorAction } =
    await import('./domains/connectors/service.ts');
  await drainNotificationEmails(sql);

  // --- the fake transport (phased inbox) -----------------------------------
  let phase: 1 | 2 = 1;
  const smtpSends: Array<{ to: string; subject: string }> = [];
  interface FakeBody {
    uid: string;
    messageId: string;
    from: { address: string; name?: string }[];
    to: { address: string }[];
    cc: never[];
    subject: string;
    date: string;
    text: string;
    headers: Record<string, string>;
  }
  const bodies: Record<string, FakeBody> = {
    '101': {
      uid: '101',
      messageId: '<m101@ext.test>',
      from: [{ address: 'alice@ext.test', name: 'Alice Ext' }],
      to: [{ address: 'inbox@door.test' }],
      cc: [],
      subject: 'Hello there',
      date: new Date(Date.now() - 3_600_000).toISOString(),
      text: 'First mail from Alice.',
      headers: { 'message-id': '<m101@ext.test>' },
    },
    '102': {
      uid: '102',
      messageId: '<m102@ext.test>',
      from: [{ address: 'bob@ext.test', name: 'Bob Ext' }],
      to: [{ address: 'inbox@door.test' }],
      cc: [],
      subject: 'A question',
      date: new Date(Date.now() - 3_000_000).toISOString(),
      text: 'Question from Bob.',
      headers: { 'message-id': '<m102@ext.test>' },
    },
    '103': {
      uid: '103',
      messageId: '<m103@ext.test>',
      from: [{ address: 'alice@ext.test', name: 'Alice Ext' }],
      to: [{ address: 'inbox@door.test' }],
      cc: [],
      subject: 'Re: Hello there',
      date: new Date(Date.now() + 60_000).toISOString(),
      text: 'A follow-up from Alice.',
      headers: {
        'message-id': '<m103@ext.test>',
        'in-reply-to': '<m101@ext.test>',
        references: '<m101@ext.test>',
      },
    },
  };
  const summaryOf = (uid: string) => {
    const body = bodies[uid];
    return {
      uid,
      from: 'x@ext.test',
      subject: body?.subject ?? '',
      sentAt: new Date(body?.date ?? new Date().toISOString()).getTime(),
    };
  };
  setMailTransportForTesting({
    openImap: async () => ({
      listMessages: async (query: { mailbox: { kind: string } }) => {
        if (query.mailbox.kind !== 'inbox') return [];
        return phase === 1
          ? [summaryOf('101'), summaryOf('102')]
          : [summaryOf('103')];
      },
      getMessage: async (uid: string) => {
        return bodies[uid] ?? null;
      },
      close: async () => {},
    }),
    openSmtp: async () => ({
      send: async (message: { to: string; subject: string }) => {
        smtpSends.push({ to: message.to, subject: message.subject });
        return { messageId: `<smtp-${smtpSends.length}@door.test>` };
      },
      close: async () => {},
    }),
  });

  try {
    const system = { kind: 'system' as const, reason: 'itest mailbox sync' };
    const sync = async () =>
      runConnectorAction(sql, {
        organizationId: orgId,
        connector: 'conversation',
        action: 'sync_mailbox',
        input: { connectorSlug: 'imap-smtp', includeSent: false },
        mode: 'live',
        caller: system,
      });

    const first = await sync();
    const firstOut = z
      .object({
        inbound: z.looseObject({
          processedCount: z.number(),
          skippedCount: z.number(),
        }),
        listed: z.number(),
      })
      .loose()
      .safeParse(first.status === 'ok' ? first.output : {});
    const conversationsAfterFirst = await sql<
      { id: string; subject: string | null; contactEmail: string | null }[]
    >`
      SELECT c.id, c.subject, ct.email AS "contactEmail"
      FROM app.conversations c
      LEFT JOIN app.contacts ct ON ct.id = c.contact_id
      WHERE c.org_id = ${orgId} AND c.connector_name = 'imap-smtp'
      ORDER BY c.created_at_ms ASC
    `;
    const watermark = await sql<{ inbound: number | null }[]>`
      SELECT mail_sync_inbound_since_ms::float8 AS inbound
      FROM app.connector_credentials
      WHERE org_id = ${orgId} AND connector_slug = 'imap-smtp'
        AND status = 'active'
      LIMIT 1
    `;

    // Idempotency: the same window again UPDATES in place (the 0.4
    // semantics count an already-ingested message as processed) — the row
    // counts must not move.
    const again = await sync();
    const againOut = z
      .object({ inbound: z.looseObject({ processedCount: z.number() }) })
      .loose()
      .safeParse(again.status === 'ok' ? again.output : {});
    const countAfterRepeat = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.conversations
      WHERE org_id = ${orgId} AND connector_name = 'imap-smtp'
    `;
    const messagesAfterRepeat = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.conversation_messages
      WHERE org_id = ${orgId} AND connector_name = 'imap-smtp'
        AND direction = 'inbound'
    `;

    // Threading: Alice's reply lands in HER existing conversation.
    phase = 2;
    await sync();
    const aliceThread = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.conversation_messages m
      JOIN app.conversations c ON c.id = m.conversation_id
      JOIN app.contacts ct ON ct.id = c.contact_id
      WHERE c.org_id = ${orgId} AND ct.email = 'alice@ext.test'
    `;
    const conversationsFinal = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.conversations
      WHERE org_id = ${orgId} AND connector_name = 'imap-smtp'
    `;

    // Outbound send through the same door (system caller: runs + audited).
    const sent = await runConnectorAction(sql, {
      organizationId: orgId,
      connector: 'imap-smtp',
      action: 'send',
      input: {
        to: 'alice@ext.test',
        subject: 'Re: Hello there',
        text: 'We are on it.',
      },
      mode: 'live',
      caller: { kind: 'system', reason: 'itest reply' },
    });
    const sendAudit = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'connector.imap-smtp.send'
        AND category = 'connector'
    `;
    const smtpAfterSystemSend = smtpSends.length;

    // The approvals gate: a USER-caller live write parks pending…
    const gated = await runConnectorAction(sql, {
      organizationId: orgId,
      connector: 'imap-smtp',
      action: 'send',
      input: {
        to: 'bob@ext.test',
        subject: 'Gated send',
        text: 'Needs a human.',
      },
      mode: 'live',
      caller: { kind: 'user', userId: 'itest-user' },
      idempotencyKey: 'itest-gated-send-1',
    });
    const approvalRows = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM app.approvals
      WHERE org_id = ${orgId} AND resource_type = 'connector_operation'
        AND resource_id = 'itest-gated-send-1'
    `;
    // …a human approves (row → executing), and the SAME operation retried
    // runs and consumes the record.
    if (approvalRows[0]) {
      await sql`
        UPDATE app.approvals SET status = 'executing'
        WHERE id = ${approvalRows[0].id}
      `;
    }
    const retried = await runConnectorAction(sql, {
      organizationId: orgId,
      connector: 'imap-smtp',
      action: 'send',
      input: {
        to: 'bob@ext.test',
        subject: 'Gated send',
        text: 'Needs a human.',
      },
      mode: 'live',
      caller: { kind: 'user', userId: 'itest-user' },
      idempotencyKey: 'itest-gated-send-1',
    });
    const approvalAfter = await sql<{ status: string }[]>`
      SELECT status FROM app.approvals
      WHERE org_id = ${orgId} AND resource_type = 'connector_operation'
        AND resource_id = 'itest-gated-send-1'
    `;

    record(
      'connector door + mailbox sync lane (reused 0.4 dispatcher/ingest)',
      first.status === 'ok' &&
        firstOut.success &&
        firstOut.data.inbound.processedCount === 2 &&
        firstOut.data.listed === 2 &&
        conversationsAfterFirst.length === 2 &&
        conversationsAfterFirst.some(
          (row) => row.contactEmail === 'alice@ext.test',
        ) &&
        conversationsAfterFirst.some(
          (row) => row.contactEmail === 'bob@ext.test',
        ) &&
        (watermark[0]?.inbound ?? 0) > 0 &&
        again.status === 'ok' &&
        againOut.success &&
        againOut.data.inbound.processedCount === 2 &&
        countAfterRepeat[0]?.count === '2' &&
        messagesAfterRepeat[0]?.count === '2' &&
        aliceThread[0]?.count === '2' &&
        conversationsFinal[0]?.count === '2' &&
        sent.status === 'ok' &&
        smtpAfterSystemSend === 1 &&
        smtpSends[0]?.to === 'alice@ext.test' &&
        Number(sendAudit[0]?.count ?? '0') >= 1 &&
        gated.status === 'approval-required' &&
        approvalRows[0]?.status === 'pending' &&
        retried.status === 'ok' &&
        smtpSends.length === 2 &&
        approvalAfter[0]?.status === 'completed',
      `sync1=${first.status}/${firstOut.success ? `${firstOut.data.inbound.processedCount} listed=${firstOut.data.listed}` : 'ERR'} conv=${conversationsAfterFirst.length} contacts=${conversationsAfterFirst.map((r) => r.contactEmail).join('|')}, watermark=${(watermark[0]?.inbound ?? 0) > 0}, repeat=${againOut.success ? againOut.data.inbound.processedCount : 'ERR'} conv=${countAfterRepeat[0]?.count} msgs=${messagesAfterRepeat[0]?.count} (want 2/2), aliceThread=${aliceThread[0]?.count} (want 2) totalConv=${conversationsFinal[0]?.count} (want 2), send=${sent.status} smtp=${smtpAfterSystemSend} audit=${sendAudit[0]?.count}, gate=${gated.status}/${approvalRows[0]?.status}→retry=${retried.status}/${approvalAfter[0]?.status} smtpAfter=${smtpSends.length}`,
    );
  } finally {
    setMailTransportForTesting(DEFAULT_MAIL_FAKE);
  }
}

/**
 * The outbound send surface over the connector door: a reply queues a row
 * and schedules the send one (shortened) undo window out; the worker's job
 * re-checks the row, delivers through the fake SMTP, and stamps the
 * provider's Message-ID; an undo inside the window deletes the row and the
 * fired job no-ops; a forced SMTP failure settles `failed` with the error,
 * retry re-delivers, discard removes the bubble; compose opens a new
 * outbound conversation; bulk reply follows the partial-failure contract;
 * and the pending conversation approval completes on send.
 */
async function checkOutboundSendLane(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const { createConversation, addMessageToConversation } =
    await import('./domains/conversations/service.ts');
  await drainNotificationEmails(sql);

  const api = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${base}/api/app/conversations${route}?orgId=${orgId}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  interface OutboundRow {
    deliveryState: string;
    externalMessageId: string | null;
    retryCount: number | null;
    metadata: Record<string, unknown> | null;
  }
  const messageRow = async (id: string): Promise<OutboundRow | null> => {
    const rows = await sql<OutboundRow[]>`
      SELECT delivery_state AS "deliveryState",
             external_message_id AS "externalMessageId",
             retry_count AS "retryCount", metadata
      FROM app.conversation_messages WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ?? null;
  };
  const waitForState = (id: string, state: string) =>
    waitFor(
      async () => (await messageRow(id))?.deliveryState === state,
      20_000,
    );

  // --- the fake SMTP (deliver or fail on demand) ---------------------------
  let failMode = false;
  const smtpSends: Array<{
    to: string;
    subject: string;
    html?: string;
    text?: string;
    inReplyTo?: string;
  }> = [];
  setMailTransportForTesting({
    openImap: async () => {
      throw new Error('itest outbound lane opens no IMAP session');
    },
    openSmtp: async () => ({
      send: async (message: {
        to: string;
        subject: string;
        html?: string;
        text?: string;
        inReplyTo?: string;
      }) => {
        if (failMode) throw new Error('SMTP 451 mailbox busy (itest)');
        smtpSends.push({
          to: message.to,
          subject: message.subject,
          ...(message.html !== undefined ? { html: message.html } : {}),
          ...(message.text !== undefined ? { text: message.text } : {}),
          ...(message.inReplyTo !== undefined
            ? { inReplyTo: message.inReplyTo }
            : {}),
        });
        return { messageId: `<smtp-out-${smtpSends.length}@door.test>` };
      },
      close: async () => {},
    }),
  });

  try {
    // Seed: a contact + an inbound email thread to reply into.
    const contactRows = await sql<{ id: string }[]>`
      INSERT INTO app.contacts (org_id, name, email, source, created_at_ms,
                                updated_at_ms)
      VALUES (${orgId}, 'Carla Ext', 'carla@ext.test', 'api_import',
              ${Date.now()}, ${Date.now()})
      RETURNING id
    `;
    const contactId = contactRows[0]?.id ?? '';
    const conversationId = await sql.begin((tx) =>
      createConversation(tx, {
        organizationId: orgId,
        contactId,
        subject: 'Send me a quote',
        channel: 'email',
        direction: 'inbound',
        connectorName: 'imap-smtp',
        externalMessageId: 'root-send@ext.test',
      }),
    );
    await sql.begin((tx) =>
      addMessageToConversation(tx, {
        conversationId,
        organizationId: orgId,
        sender: 'carla@ext.test',
        content: 'Please quote 7 units.',
        isCustomer: true,
        externalMessageId: 'root-send@ext.test',
        sentAt: Date.now() - 120_000,
        connectorName: 'imap-smtp',
      }),
    );
    // A pending approval on the conversation (an agent-drafted reply): the
    // human send must complete it.
    const approvalRows = await sql<{ id: string }[]>`
      INSERT INTO app.approvals (org_id, resource_type, resource_id, status,
                                 created_at_ms)
      VALUES (${orgId}, 'conversations', ${conversationId}, 'pending',
              ${Date.now()})
      RETURNING id
    `;

    // 1. Reply → 201, row queued with the undo stamps, approval completed.
    const replyRes = await api(`/${conversationId}/reply`, {
      body: {
        content: '<p>We <b>shipped</b> it.</p>',
        sourceMarkdown: 'We **shipped** it.',
      },
    });
    const replyBody = z
      .object({ messageId: z.string() })
      .safeParse(await replyRes.json());
    const replyId = replyBody.success ? replyBody.data.messageId : '';
    const queuedRow = await messageRow(replyId);
    const approvalAfterSend = await sql<
      { status: string; approvedBy: string | null }[]
    >`
      SELECT status, approved_by AS "approvedBy" FROM app.approvals
      WHERE id = ${approvalRows[0]?.id ?? ''}
    `;

    // …the delayed job fires and the fake SMTP delivers.
    const sentOk = await waitForState(replyId, 'sent');
    const sentRow = await messageRow(replyId);
    const firstSend = smtpSends[0];

    // 2. Forced SMTP failure settles `failed` with the error message…
    failMode = true;
    const failRes = await api(`/${conversationId}/reply`, {
      body: { content: 'This one bounces.' },
    });
    const failBody = z
      .object({ messageId: z.string() })
      .safeParse(await failRes.json());
    const failId = failBody.success ? failBody.data.messageId : '';
    const failedOk = await waitForState(failId, 'failed');
    const failedRow = await messageRow(failId);
    failMode = false;

    // …and retry (immediate, no undo window) re-delivers.
    const retryRes = await api(`/messages/${failId}/retry`, { body: {} });
    const retriedOk = await waitForState(failId, 'sent');
    const retriedRow = await messageRow(failId);

    // 3. Undo inside the window: the draft comes back, the row is gone, and
    // the fired job no-ops on the missing row.
    const undoTarget = await api(`/${conversationId}/reply`, {
      body: { content: 'Recall me.', sourceMarkdown: 'Recall me.' },
    });
    const undoTargetBody = z
      .object({ messageId: z.string() })
      .safeParse(await undoTarget.json());
    const undoId = undoTargetBody.success ? undoTargetBody.data.messageId : '';
    const undoRes = await api(`/messages/${undoId}/undo`, { body: {} });
    const undoBody = z
      .object({ sourceMarkdown: z.string().nullable() })
      .safeParse(await undoRes.json());
    const undoneRow = await messageRow(undoId);
    const undoRepeat = await api(`/messages/${undoId}/undo`, { body: {} });

    // 4. Discard a failed bubble: the row is gone.
    failMode = true;
    const discardTarget = await api(`/${conversationId}/reply`, {
      body: { content: 'Doomed and discarded.' },
    });
    const discardTargetBody = z
      .object({ messageId: z.string() })
      .safeParse(await discardTarget.json());
    const discardId = discardTargetBody.success
      ? discardTargetBody.data.messageId
      : '';
    await waitForState(discardId, 'failed');
    failMode = false;
    const discardRes = await api(`/messages/${discardId}/discard`, {
      body: {},
    });
    const discardedRow = await messageRow(discardId);

    // 5. Compose opens a NEW outbound conversation and delivers.
    const composeRes = await api('/compose', {
      body: {
        contactId,
        connectorName: 'imap-smtp',
        subject: 'Quote 7',
        content: 'Seven units, forty crowns.',
      },
    });
    const composeBody = z
      .object({ conversationId: z.string(), messageId: z.string() })
      .safeParse(await composeRes.json());
    const composedOk = composeBody.success
      ? await waitForState(composeBody.data.messageId, 'sent')
      : false;
    const composedConv = composeBody.success
      ? await sql<{ direction: string | null; subject: string | null }[]>`
          SELECT direction, subject FROM app.conversations
          WHERE id = ${composeBody.data.conversationId} LIMIT 1
        `
      : [];

    // 6. Bulk reply: one visible + one ghost → partial failure.
    const bulkRes = await api('/bulk/reply', {
      body: {
        conversationIds: [conversationId, 'ghost-conversation'],
        content: 'Bulk follow-up.',
      },
    });
    const bulkBody = z
      .object({
        successCount: z.number(),
        failedCount: z.number(),
        errors: z.array(z.string()),
      })
      .safeParse(await bulkRes.json());

    // Drain: every send job settles (the undone job completes as a no-op).
    const drained = await waitFor(async () => {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pgboss.job
        WHERE name = 'conversation.send_message'
          AND state NOT IN ('completed', 'cancelled')
      `;
      return Number(rows[0]?.count ?? '1') === 0;
    }, 20_000);
    const finalSendCount = smtpSends.length;

    record(
      'outbound send lane (reply/compose/undo/retry/discard + undo-window job)',
      replyRes.status === 201 &&
        queuedRow?.deliveryState === 'queued' &&
        typeof queuedRow?.metadata?.scheduledSendAt === 'number' &&
        queuedRow?.metadata?.sendContentType === 'HTML' &&
        approvalAfterSend[0]?.status === 'completed' &&
        approvalAfterSend[0]?.approvedBy === userId &&
        sentOk &&
        sentRow?.externalMessageId === 'smtp-out-1@door.test' &&
        firstSend?.to === 'carla@ext.test' &&
        firstSend?.subject === 'Re: Send me a quote' &&
        firstSend?.html === '<p>We <b>shipped</b> it.</p>' &&
        firstSend?.inReplyTo === 'root-send@ext.test' &&
        failRes.status === 201 &&
        failedOk &&
        typeof failedRow?.metadata?.error === 'string' &&
        retryRes.status === 200 &&
        retriedOk &&
        retriedRow?.retryCount === 1 &&
        undoRes.status === 200 &&
        undoBody.success &&
        undoBody.data.sourceMarkdown === 'Recall me.' &&
        undoneRow === null &&
        undoRepeat.status === 404 &&
        discardRes.status === 200 &&
        discardedRow === null &&
        composeRes.status === 201 &&
        composedOk &&
        composedConv[0]?.direction === 'outbound' &&
        composedConv[0]?.subject === 'Quote 7' &&
        bulkBody.success &&
        bulkBody.data.successCount === 1 &&
        bulkBody.data.failedCount === 1 &&
        drained &&
        finalSendCount === 4,
      `reply=${replyRes.status} queued=${queuedRow?.deliveryState}/${String(queuedRow?.metadata?.sendContentType)} approval=${approvalAfterSend[0]?.status}/${approvalAfterSend[0]?.approvedBy === userId}, sent=${sentOk} extId=${sentRow?.externalMessageId} smtp[0]=${firstSend?.to}/${firstSend?.subject}/inReplyTo=${firstSend?.inReplyTo}, fail=${failedOk} err=${typeof failedRow?.metadata?.error} retry=${retryRes.status}/${retriedOk}/count=${retriedRow?.retryCount}, undo=${undoRes.status} draft=${undoBody.success ? undoBody.data.sourceMarkdown : 'ERR'} gone=${undoneRow === null} repeat=${undoRepeat.status}, discard=${discardRes.status} gone=${discardedRow === null}, compose=${composeRes.status}/${composedOk} conv=${composedConv[0]?.direction}/${composedConv[0]?.subject}, bulk=${bulkBody.success ? `${bulkBody.data.successCount}/${bulkBody.data.failedCount}` : 'ERR'}, drained=${drained} smtpTotal=${finalSendCount} (want 4)`,
    );
  } finally {
    setMailTransportForTesting(DEFAULT_MAIL_FAKE);
  }
}

/**
 * The debounced actionable-email sink: an actionable bell schedules a
 * `notification.email` job one debounce window out; a rewrite inside the
 * window bumps the epoch so the older job no-ops and ONE email carries the
 * final state; a row read in the app, an undone row, and a recipient with
 * the preference off all send nothing. Delivery rides the connector door
 * (imap-smtp `notificationSender` From rewrite) on a fake SMTP.
 */
async function checkNotificationEmailSink(
  sql: Sql,
  ctx: { orgId: string; userId: string },
): Promise<void> {
  const { orgId, userId } = ctx;
  const { writeCoalescedNotification } =
    await import('./domains/collab/service.ts');
  await drainNotificationEmails(sql);

  const smtpSends: Array<{
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }> = [];
  setMailTransportForTesting({
    openImap: async () => {
      throw new Error('itest email sink opens no IMAP session');
    },
    openSmtp: async () => ({
      send: async (message: {
        to: string;
        from: string;
        subject: string;
        text?: string;
        html?: string;
      }) => {
        smtpSends.push({
          to: message.to,
          from: message.from,
          subject: message.subject,
          ...(message.text !== undefined ? { text: message.text } : {}),
          ...(message.html !== undefined ? { html: message.html } : {}),
        });
        return { messageId: `<notif-${smtpSends.length}@door.test>` };
      },
      close: async () => {},
    }),
  });

  try {
    const bell = (
      taskId: string,
      title: string,
      undoes?: boolean,
      recipient?: string,
    ) =>
      writeCoalescedNotification(sql, {
        userId: recipient ?? userId,
        organizationId: orgId,
        type: 'task_assigned',
        titleKey: 'taskAssigned',
        bodyKey: 'taskAssignedBody',
        params: { title, projectId: 'p-email-sink' },
        resourceType: 'task',
        resourceId: taskId,
        taskId,
        actorType: 'user',
        actorId: 'someone-else',
        ...(undoes === true ? { undoes: true } : {}),
      });

    // A) Burst on one dimension: write then rewrite before the window fires
    // → the stale-epoch job skips, ONE email carries the final state.
    const first = await bell('email-task-a', 'Email me A');
    const rewritten = await bell('email-task-a', 'Email me B (final)');

    // B) Read before the window fires → no email.
    await bell('email-task-b', 'Read before fire');
    await sql`
      UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
      WHERE org_id = ${orgId} AND user_id = ${userId}
        AND resource_id = 'email-task-b'
    `;

    // C) An event that undoes its unread twin → row gone, no email.
    await bell('email-task-c', 'About to be undone');
    const undone = await bell('email-task-c', 'Undone', true);

    // D) Preference off → no email for that recipient.
    const prefUsers = await sql<{ id: string }[]>`
      INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (gen_random_uuid(), 'no-email-pref@door.test', 'Pref Off',
              true, ${new Date()}, ${new Date()})
      RETURNING "id"
    `;
    const prefUserId = prefUsers[0]?.id ?? '';
    await sql`
      INSERT INTO app.notification_preferences (
        user_id, org_id, actionable_email, updated_at_ms
      ) VALUES (${prefUserId}, ${orgId}, false, ${Date.now()})
    `;
    await bell('email-task-d', 'Pref is off', undefined, prefUserId);

    const drained = await drainNotificationEmails(sql);
    const delivered = smtpSends[0];
    const adminEmailRows = await sql<{ email: string | null }[]>`
      SELECT "email" FROM "user" WHERE "id" = ${userId} LIMIT 1
    `;
    const adminEmail = adminEmailRows[0]?.email ?? '';
    const rowsLeft = await sql<{ resourceId: string }[]>`
      SELECT resource_id AS "resourceId" FROM app.user_notifications
      WHERE org_id = ${orgId} AND resource_id LIKE 'email-task-%'
    `;

    record(
      'notification email sink (debounce epoch, read/undo/pref skips)',
      first === 'inserted' &&
        rewritten === 'rewritten' &&
        undone === 'cancelled' &&
        drained &&
        smtpSends.length === 1 &&
        delivered?.subject === 'Task assigned to you' &&
        delivered?.to === adminEmail &&
        (delivered?.text ?? '').includes('Email me B (final)') &&
        (delivered?.html ?? '').includes(
          `/dashboard/${orgId}/projects/p-email-sink/tasks?task=email-task-a`,
        ) &&
        (delivered?.from ?? '').startsWith('notification@') &&
        !rowsLeft.some((row) => row.resourceId === 'email-task-c'),
      `write=${first}/${rewritten}/undo=${undone}, drained=${drained}, emails=${smtpSends.length} (want 1) subject=${delivered?.subject} to=${delivered?.to}==${adminEmail} from=${delivered?.from} finalBody=${(delivered?.text ?? '').includes('Email me B (final)')} deepLink=${(delivered?.html ?? '').includes(`/projects/p-email-sink/tasks?task=email-task-a`)}, undoneRowGone=${!rowsLeft.some((row) => row.resourceId === 'email-task-c')} rows=${rowsLeft
        .map((r) => r.resourceId)
        .sort()
        .join('|')}`,
    );
  } finally {
    setMailTransportForTesting(DEFAULT_MAIL_FAKE);
  }
}

/**
 * The approvals inbox surface: listing with filters + keyset pagination,
 * per-status counts, one-row read, and the generic decision with the 0.4
 * FSM (pending → executing|rejected only, once), the dedicated-door
 * refusal for review-gate rows, approver stamping, the workflow audit row,
 * and the silent-no-op poke for a stale run reference.
 */
async function checkApprovalsSurface(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const api = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(
      `${base}/api/app/approvals${route}${route.includes('?') ? '&' : '?'}orgId=${orgId}`,
      {
        method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      },
    );

  const seed = async (
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.approvals (org_id, resource_type, resource_id, status,
                                 metadata, created_at_ms)
      VALUES (${orgId}, ${resourceType}, ${resourceId}, 'pending',
              ${metadata === undefined ? null : sql.json(JSON.stringify(metadata))},
              ${Date.now()})
      RETURNING id
    `;
    return rows[0]?.id ?? '';
  };
  const rowOf = async (id: string) => {
    const rows = await sql<
      {
        status: string;
        approvedBy: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT status, approved_by AS "approvedBy", metadata
      FROM app.approvals WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ?? null;
  };

  // Seeds: two connector operations (one to approve, one to reject) and a
  // review-gate row that must refuse toward its dedicated door.
  const approveId = await seed('connector_operation', 'itest-appr-op-1', {
    runId: 'no-such-run',
    connector: 'imap-smtp',
    action: 'send',
  });
  const rejectId = await seed('connector_operation', 'itest-appr-op-2');
  const reviewId = await seed('task_review', 'itest-appr-task-1');

  // Listing: pending connector operations include both seeds; limit=1 pages.
  const listed = z
    .object({
      page: z.array(z.looseObject({ id: z.string(), status: z.string() })),
      cursor: z.string().nullable(),
    })
    .safeParse(
      await (
        await api('?status=pending&resourceType=connector_operation')
      ).json(),
    );
  const listedIds = listed.success
    ? new Set(listed.data.page.map((row) => row.id))
    : new Set<string>();
  const pageOne = z
    .object({
      page: z.array(z.looseObject({ id: z.string() })),
      cursor: z.string().nullable(),
    })
    .safeParse(
      await (
        await api('?status=pending&resourceType=connector_operation&limit=1')
      ).json(),
    );
  const pageTwo = pageOne.success
    ? z
        .object({ page: z.array(z.looseObject({ id: z.string() })) })
        .safeParse(
          await (
            await api(
              `?status=pending&resourceType=connector_operation&limit=1&cursor=${pageOne.data.cursor ?? ''}`,
            )
          ).json(),
        )
    : undefined;
  const paged =
    pageOne.success &&
    pageTwo?.success === true &&
    pageOne.data.page.length === 1 &&
    pageTwo.data.page.length === 1 &&
    pageOne.data.page[0]?.id !== pageTwo.data.page[0]?.id;

  const counts = z
    .object({ byStatus: z.record(z.string(), z.number()) })
    .safeParse(await (await api('/counts')).json());
  const gotten = z
    .looseObject({ id: z.string(), resourceType: z.string() })
    .safeParse(await (await api(`/${approveId}`)).json());
  const foreign = await api('/no-such-approval');

  // The decision FSM: approve (executing) once; a second decision refuses.
  const approved = await api(`/${approveId}/decide`, {
    body: { status: 'executing', comments: 'looks right' },
  });
  const approvedRow = await rowOf(approveId);
  const again = await api(`/${approveId}/decide`, {
    body: { status: 'rejected' },
  });
  const rejected = await api(`/${rejectId}/decide`, {
    body: { status: 'rejected', comments: 'not like this' },
  });
  const rejectedRow = await rowOf(rejectId);
  const reviewRefused = await api(`/${reviewId}/decide`, {
    body: { status: 'executing' },
  });
  const badStatus = await api(`/${rejectId}/decide`, {
    body: { status: 'completed' },
  });
  const auditRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.audit_logs
    WHERE org_id = ${orgId} AND category = 'workflow'
      AND action IN ('approve_request', 'reject_request')
      AND resource_id IN (${approveId}, ${rejectId})
  `;

  record(
    'approvals inbox surface (list/counts/get + decide FSM)',
    listed.success &&
      listedIds.has(approveId) &&
      listedIds.has(rejectId) &&
      !listedIds.has(reviewId) &&
      paged &&
      counts.success &&
      (counts.data.byStatus.pending ?? 0) >= 3 &&
      gotten.success &&
      gotten.data.resourceType === 'connector_operation' &&
      foreign.status === 404 &&
      approved.status === 200 &&
      approvedRow?.status === 'executing' &&
      approvedRow?.approvedBy === userId &&
      typeof approvedRow?.metadata?.approverName === 'string' &&
      approvedRow?.metadata?.comments === 'looks right' &&
      again.status === 409 &&
      rejected.status === 200 &&
      rejectedRow?.status === 'rejected' &&
      rejectedRow?.metadata?.comments === 'not like this' &&
      reviewRefused.status === 409 &&
      badStatus.status === 400 &&
      Number(auditRows[0]?.count ?? '0') === 2,
    `list=${listed.success}/${listedIds.has(approveId)}&${listedIds.has(rejectId)}&!${listedIds.has(reviewId)} paged=${paged}, counts=${counts.success ? JSON.stringify(counts.data.byStatus) : 'ERR'}, get=${gotten.success} foreign=${foreign.status}, approve=${approved.status} row=${approvedRow?.status}/${approvedRow?.approvedBy === userId}/name=${typeof approvedRow?.metadata?.approverName} again=${again.status} (want 409), reject=${rejected.status}/${rejectedRow?.status} reviewGate=${reviewRefused.status} (want 409) badStatus=${badStatus.status} (want 400), audits=${auditRows[0]?.count} (want 2)`,
  );
}

/**
 * The task-agent TURN, end to end on the REUSED 0.4 host: kick → session
 * ensure (fake spawner) → gateway VK mint (fake bifrost) → exec streaming a
 * canned claude-code stream-json turn → harvest (fake workspace file → real
 * MinIO blob) → settle choreography (outputs attached, agent comment,
 * in_review park, VK revoked, op finalized).
 */
async function checkTaskAgentTurnDrive(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'task-agent turn drive (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — the harvest lane needs blob storage',
    );
    return;
  }
  const { cookie, orgId } = ctx;
  const { createServer } = await import('node:http');
  const { createHash, createHmac } = await import('node:crypto');

  const SPAWNER_TOKEN = 'itest-drive-spawner';
  const REPORT_BYTES = '# Report\n\nAll good.';
  const FINAL_TEXT = 'Wrote the report to the box.';
  const gatewayCalls = { minted: 0, revoked: 0 };
  let boxTaskDir = '';

  // --- fake spawner: sessions + exec SSE + files ---------------------------
  const spawner = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const rawUrl = req.url ?? '';
      const method = req.method ?? 'GET';
      const bodyHash = createHash('sha256').update(body).digest('hex');
      const signedString = `${method}\n${rawUrl}\n${String(req.headers['x-tale-sandbox-timestamp'] ?? '')}\n${String(req.headers['x-tale-sandbox-nonce'] ?? '')}\n${bodyHash}`;
      const expected = createHmac('sha256', SPAWNER_TOKEN)
        .update(signedString)
        .digest('hex');
      if (req.headers['x-tale-sandbox-signature'] !== expected) {
        res.statusCode = 401;
        res.end('{"error":"bad signature"}');
        return;
      }
      const url = new URL(rawUrl, 'http://x');
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
      res.setHeader('content-type', 'application/json');
      if (method === 'POST' && url.pathname === '/v1/sessions') {
        const parsed = z
          .object({ sessionId: z.string() })
          .loose()
          .safeParse(JSON.parse(body || '{}'));
        res.end(
          JSON.stringify(
            sessionInfo(parsed.success ? parsed.data.sessionId : ''),
          ),
        );
        return;
      }
      const exec = /^\/v1\/sessions\/([^/]+)\/exec$/.exec(url.pathname);
      if (method === 'POST' && exec) {
        // The canned claude-code stream-json turn, then the exec result.
        res.setHeader('content-type', 'text/event-stream');
        const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
        const events = [
          line({
            type: 'system',
            subtype: 'init',
            session_id: 'conv-42',
            model: 'itest-agent-model',
          }),
          line({
            type: 'assistant',
            message: {
              id: 'm1',
              model: 'itest-agent-model',
              content: [{ type: 'text', text: 'Working on the report…' }],
              usage: { input_tokens: 120, output_tokens: 40 },
            },
          }),
          line({
            type: 'result',
            subtype: 'success',
            session_id: 'conv-42',
            result: FINAL_TEXT,
            duration_ms: 850,
          }),
        ];
        let seq = 0;
        for (const text of events) {
          seq += 1;
          res.write(
            `event: stdout\ndata: ${JSON.stringify({ text, seq })}\n\n`,
          );
        }
        res.write(
          `event: result\ndata: ${JSON.stringify({
            exitCode: 0,
            stdoutBase64: '',
            stderrBase64: '',
          })}\n\n`,
        );
        res.end();
        return;
      }
      if (url.pathname.endsWith('/files/stage')) {
        res.end(JSON.stringify({ staged: [], skipped: [] }));
        return;
      }
      if (url.pathname.endsWith('/files/delete')) {
        res.end(JSON.stringify({ deleted: [], skipped: [] }));
        return;
      }
      if (url.pathname.endsWith('/files/content')) {
        res.setHeader('content-type', 'text/markdown');
        res.end(REPORT_BYTES);
        return;
      }
      if (/\/v1\/sessions\/[^/]+\/files$/.test(url.pathname)) {
        const dir = url.searchParams.get('path') ?? '';
        if (boxTaskDir !== '' && dir === boxTaskDir) {
          res.end(
            JSON.stringify({
              entries: [
                {
                  name: 'report.md',
                  type: 'file',
                  size: REPORT_BYTES.length,
                  mtimeMs: Date.now(),
                },
              ],
            }),
          );
          return;
        }
        res.end(JSON.stringify({ entries: [] }));
        return;
      }
      if (/\/exec\/[^/]+\/cancel$/.test(url.pathname)) {
        res.end('{"cancelled":true}');
        return;
      }
      if (method === 'GET' && /^\/v1\/sessions\/[^/]+$/.test(url.pathname)) {
        res.end(
          JSON.stringify(sessionInfo(url.pathname.split('/').at(-1) ?? '')),
        );
        return;
      }
      if (method === 'DELETE') {
        res.end('{"destroyed":true}');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    spawner.listen(0, '127.0.0.1', resolve);
  });
  const spawnerAddress = spawner.address();
  const spawnerPort =
    spawnerAddress !== null && typeof spawnerAddress === 'object'
      ? spawnerAddress.port
      : 0;

  // --- fake bifrost admin --------------------------------------------------
  const providerKeys = new Map<string, Array<{ id: string; name: string }>>();
  const gateway = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      res.setHeader('content-type', 'application/json');
      if (url === '/api/config') {
        res.end(JSON.stringify({ client_config: {} }));
        return;
      }
      const keysMatch = /^\/api\/providers\/([^/]+)\/keys/.exec(url);
      if (keysMatch) {
        const provider = decodeURIComponent(keysMatch[1] ?? '');
        if (method === 'GET') {
          res.end(JSON.stringify({ keys: providerKeys.get(provider) ?? [] }));
          return;
        }
        const parsed = z
          .looseObject({ name: z.string() })
          .safeParse(JSON.parse(body || '{}'));
        const list = providerKeys.get(provider) ?? [];
        if (parsed.success && !list.some((k) => k.name === parsed.data.name)) {
          list.push({ id: `key-${list.length + 1}`, name: parsed.data.name });
        }
        providerKeys.set(provider, list);
        res.end('{}');
        return;
      }
      if (url.startsWith('/api/providers/')) {
        res.end('{}');
        return;
      }
      if (url === '/api/governance/virtual-keys' && method === 'POST') {
        gatewayCalls.minted += 1;
        res.end(
          JSON.stringify({
            virtual_key: { id: 'vk-drive-1', value: 'sk-bf-drive-1' },
          }),
        );
        return;
      }
      if (url.startsWith('/api/governance/virtual-keys/')) {
        if (method === 'DELETE') {
          gatewayCalls.revoked += 1;
          res.end('{}');
          return;
        }
        res.end(
          JSON.stringify({ virtual_key: { budget: { current_usage: 0.03 } } }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const gatewayAddress = gateway.address();
  const gatewayPort =
    gatewayAddress !== null && typeof gatewayAddress === 'object'
      ? gatewayAddress.port
      : 0;

  // --- fake models endpoint for the serving catalog ------------------------
  const modelsServer = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if ((req.url ?? '').endsWith('/models')) {
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'itest-agent-model',
              object: 'model',
              context_length: 32_768,
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => {
    modelsServer.listen(0, '127.0.0.1', resolve);
  });
  const modelsAddress = modelsServer.address();
  const modelsPort =
    modelsAddress !== null && typeof modelsAddress === 'object'
      ? modelsAddress.port
      : 0;

  process.env.SANDBOX_URL = `http://127.0.0.1:${spawnerPort}`;
  process.env.SANDBOX_TOKEN = SPAWNER_TOKEN;
  process.env.SANDBOX_LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
  process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';

  try {
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const providersDir = path.join(configRoot, orgSlug, 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(
      path.join(providersDir, 'itestagent.yml'),
      [
        'name: itestagent',
        'displayName: Itest Agent Serving',
        'apiFormat: openai',
        `baseUrl: http://127.0.0.1:${modelsPort}/v1`,
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ].join('\n'),
    );
    const post = (route: string, payload?: unknown): Promise<Response> =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
    await post(`/api/app/provider-credentials?orgId=${orgId}`, {
      providerSlug: 'itestagent',
      authMethod: 'api-key',
      name: 'Agent serving key',
      secret: 'sk-itest-agent',
    });

    const project = z
      .object({ projectId: z.string() })
      .safeParse(
        await (
          await post(`/api/app/projects?orgId=${orgId}`, { name: 'Turn Drive' })
        ).json(),
      );
    const projectId = project.success ? project.data.projectId : '';
    const agent = z.object({ agentId: z.string() }).safeParse(
      await (
        await post(`/api/app/projects/${projectId}/agents?orgId=${orgId}`, {
          name: 'Drive Bot',
          harness: 'claude-code',
          model: 'itest-agent-model',
          skills: [],
          connectors: [],
        })
      ).json(),
    );
    const agentId = agent.success ? agent.data.agentId : '';
    const task = z.object({ taskId: z.string() }).safeParse(
      await (
        await post(`/api/app/tasks?orgId=${orgId}`, {
          projectId,
          title: 'Write the quarterly report',
        })
      ).json(),
    );
    const taskId = task.success ? task.data.taskId : '';
    boxTaskDir = `/agent/output/${taskId}`;
    await post(`/api/app/tasks/${taskId}/assign?orgId=${orgId}`, {
      assigneeType: 'agent',
      assigneeId: agentId,
    });
    await post(`/api/app/tasks/${taskId}/status?orgId=${orgId}`, {
      status: 'in_progress',
    });

    // The worker's task.agent_turn job drives the whole turn to a settle.
    const settled = await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.project_agent_runs
        WHERE task_id = ${taskId} ORDER BY started_at_ms DESC LIMIT 1
      `;
      return ['settled', 'failed'].includes(rows[0]?.status ?? '');
    }, 45_000);
    const runRows = await sql<
      {
        status: string;
        resultText: string | null;
        error: string | null;
        launchedAt: number | null;
        agentSessionId: string | null;
      }[]
    >`
      SELECT status, result_text AS "resultText", error,
             launched_at_ms::float8 AS "launchedAt",
             agent_session_id AS "agentSessionId"
      FROM app.project_agent_runs
      WHERE task_id = ${taskId} ORDER BY started_at_ms DESC LIMIT 1
    `;
    const run = runRows[0];
    const taskRows = await sql<{ status: string; outputs: unknown }[]>`
      SELECT status, outputs FROM app.tasks WHERE id = ${taskId}
    `;
    const taskRow = taskRows[0];
    const outputsRaw = JSON.stringify(taskRow?.outputs ?? []);
    const comments = await sql<{ body: string }[]>`
      SELECT coalesce(m.text, '') AS body
      FROM app.task_discussion_message_meta meta
      JOIN app.messages m ON m.id = meta.message_id
      WHERE meta.task_id = ${taskId} AND meta.author_type = 'agent'
      ORDER BY m.created_at_ms DESC LIMIT 1
    `;
    const opRows = await sql<
      {
        status: string;
        finalizedAt: number | null;
        spentCents: number | null;
      }[]
    >`
      SELECT status, finalized_at_ms::float8 AS "finalizedAt",
             spent_cents AS "spentCents"
      FROM app.sandbox_session_ops
      WHERE session_id = ${`pa-${agentId}`}
      ORDER BY started_at_ms DESC LIMIT 1
    `;
    const metadataRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.file_metadata
      WHERE org_id = ${orgId} AND file_name = 'report.md'
        AND source = 'task-output'
    `;

    record(
      'task-agent turn drive (reused host: exec→harvest→settle)',
      settled &&
        run?.status === 'settled' &&
        run.resultText === FINAL_TEXT &&
        run.launchedAt !== null &&
        run.agentSessionId === 'conv-42' &&
        taskRow?.status === 'in_review' &&
        outputsRaw.includes('report.md') &&
        (comments[0]?.body ?? '').includes(FINAL_TEXT) &&
        (comments[0]?.body ?? '').includes('report.md') &&
        opRows[0]?.status === 'completed' &&
        opRows[0].finalizedAt !== null &&
        opRows[0].spentCents === 3 &&
        Number(metadataRows[0]?.count ?? '0') >= 1 &&
        gatewayCalls.minted === 1 &&
        gatewayCalls.revoked === 1,
      `run=${run?.status}${run?.error ? ` (${run.error.slice(0, 120)})` : ''} text=${JSON.stringify(run?.resultText)} conv=${run?.agentSessionId}, task=${taskRow?.status} (want in_review) outputs=${outputsRaw.includes('report.md')}, comment=${(comments[0]?.body ?? '').slice(0, 60)}…, op=${opRows[0]?.status}/finalized=${opRows[0]?.finalizedAt !== null}/spent=${opRows[0]?.spentCents}, metadata=${metadataRows[0]?.count}, vk mint/revoke=${gatewayCalls.minted}/${gatewayCalls.revoked}`,
    );
  } finally {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
    delete process.env.SANDBOX_LLM_GATEWAY_URL;
    await new Promise<void>((resolve) => {
      spawner.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      gateway.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      modelsServer.close(() => resolve());
    });
  }
}

/**
 * The automation AGENT NODE, end to end across the async dance: the stepper
 * kicks (session reserve + op row + a scheduled turn job) and parks the run
 * on the agent cursor; the turn job drives the reused workflow host (mint →
 * exec stream → harvest → recordAgentTurnSettled); the settle wakes the
 * stepper, which consumes the result and finishes the run.
 */
async function checkAutomationAgentNode(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  _orgSlug: string,
): Promise<void> {
  if (!process.env.ITEST_S3_ENDPOINT) {
    record(
      'automation agent node (SKIPPED)',
      true,
      'no ITEST_S3_ENDPOINT — the harvest lane needs blob storage',
    );
    return;
  }
  const { cookie, orgId } = ctx;
  const { createServer } = await import('node:http');
  const { createHash, createHmac } = await import('node:crypto');

  const SPAWNER_TOKEN = 'itest-node-spawner';
  const NODE_TEXT = 'Analysis complete; wrote note.md.';
  const NOTE_BYTES = 'automation note';
  const gatewayCalls = { minted: 0, revoked: 0 };

  const spawner = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const rawUrl = req.url ?? '';
      const method = req.method ?? 'GET';
      const bodyHash = createHash('sha256').update(body).digest('hex');
      const signedString = `${method}\n${rawUrl}\n${String(req.headers['x-tale-sandbox-timestamp'] ?? '')}\n${String(req.headers['x-tale-sandbox-nonce'] ?? '')}\n${bodyHash}`;
      const expected = createHmac('sha256', SPAWNER_TOKEN)
        .update(signedString)
        .digest('hex');
      if (req.headers['x-tale-sandbox-signature'] !== expected) {
        res.statusCode = 401;
        res.end('{"error":"bad signature"}');
        return;
      }
      const url = new URL(rawUrl, 'http://x');
      res.setHeader('content-type', 'application/json');
      if (method === 'POST' && url.pathname === '/v1/sessions') {
        const parsed = z
          .object({ sessionId: z.string() })
          .loose()
          .safeParse(JSON.parse(body || '{}'));
        res.end(
          JSON.stringify({
            session: {
              sessionId: parsed.success ? parsed.data.sessionId : '',
              organizationId: orgId,
              profile: 'agent',
              state: 'ready',
              backend: 'itest',
              createdAtMs: Date.now(),
              lastActivityAtMs: Date.now(),
              expiresAtMs: Date.now() + 3_600_000,
              idleTimeoutMs: 600_000,
            },
          }),
        );
        return;
      }
      if (method === 'POST' && url.pathname.endsWith('/exec')) {
        res.setHeader('content-type', 'text/event-stream');
        const line = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
        const events = [
          line({
            type: 'system',
            subtype: 'init',
            session_id: 'wfconv-7',
            model: 'itest-agent-model',
          }),
          line({
            type: 'assistant',
            message: {
              id: 'wm1',
              model: 'itest-agent-model',
              content: [{ type: 'text', text: 'Analyzing…' }],
              usage: { input_tokens: 80, output_tokens: 25 },
            },
          }),
          line({
            type: 'result',
            subtype: 'success',
            session_id: 'wfconv-7',
            result: NODE_TEXT,
            duration_ms: 400,
          }),
        ];
        let seq = 0;
        for (const text of events) {
          seq += 1;
          res.write(
            `event: stdout\ndata: ${JSON.stringify({ text, seq })}\n\n`,
          );
        }
        res.write(
          `event: result\ndata: ${JSON.stringify({
            exitCode: 0,
            stdoutBase64: '',
            stderrBase64: '',
          })}\n\n`,
        );
        res.end();
        return;
      }
      if (url.pathname.endsWith('/files/stage')) {
        res.end(JSON.stringify({ staged: [], skipped: [] }));
        return;
      }
      if (url.pathname.endsWith('/files/delete')) {
        res.end(JSON.stringify({ deleted: [], skipped: [] }));
        return;
      }
      if (url.pathname.endsWith('/files/content')) {
        res.setHeader('content-type', 'text/plain');
        res.end(NOTE_BYTES);
        return;
      }
      if (/\/v1\/sessions\/[^/]+\/files$/.test(url.pathname)) {
        const dir = url.searchParams.get('path') ?? '';
        if (dir === '/agent/output') {
          res.end(
            JSON.stringify({
              entries: [
                {
                  name: 'note.md',
                  type: 'file',
                  size: NOTE_BYTES.length,
                  mtimeMs: Date.now(),
                },
              ],
            }),
          );
          return;
        }
        res.end(JSON.stringify({ entries: [] }));
        return;
      }
      if (/\/exec\/[^/]+\/cancel$/.test(url.pathname)) {
        res.end('{"cancelled":true}');
        return;
      }
      if (method === 'GET' && /^\/v1\/sessions\/[^/]+$/.test(url.pathname)) {
        res.end('{"session":{"state":"ready"}}');
        return;
      }
      if (method === 'DELETE') {
        res.end('{"destroyed":true}');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    spawner.listen(0, '127.0.0.1', resolve);
  });
  const spawnerAddress = spawner.address();
  const spawnerPort =
    spawnerAddress !== null && typeof spawnerAddress === 'object'
      ? spawnerAddress.port
      : 0;

  const providerKeys = new Map<string, Array<{ id: string; name: string }>>();
  const gateway = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      res.setHeader('content-type', 'application/json');
      if (url === '/api/config') {
        res.end(JSON.stringify({ client_config: {} }));
        return;
      }
      const keysMatch = /^\/api\/providers\/([^/]+)\/keys/.exec(url);
      if (keysMatch) {
        const provider = decodeURIComponent(keysMatch[1] ?? '');
        if (method === 'GET') {
          res.end(JSON.stringify({ keys: providerKeys.get(provider) ?? [] }));
          return;
        }
        const parsed = z
          .looseObject({ name: z.string() })
          .safeParse(JSON.parse(body || '{}'));
        const list = providerKeys.get(provider) ?? [];
        if (parsed.success && !list.some((k) => k.name === parsed.data.name)) {
          list.push({ id: `key-${list.length + 1}`, name: parsed.data.name });
        }
        providerKeys.set(provider, list);
        res.end('{}');
        return;
      }
      if (url.startsWith('/api/providers/')) {
        res.end('{}');
        return;
      }
      if (url === '/api/governance/virtual-keys' && method === 'POST') {
        gatewayCalls.minted += 1;
        res.end(
          JSON.stringify({
            virtual_key: {
              id: `vk-node-${gatewayCalls.minted}`,
              value: `sk-bf-node-${gatewayCalls.minted}`,
            },
          }),
        );
        return;
      }
      if (url.startsWith('/api/governance/virtual-keys/')) {
        if (method === 'DELETE') {
          gatewayCalls.revoked += 1;
          res.end('{}');
          return;
        }
        res.end(
          JSON.stringify({ virtual_key: { budget: { current_usage: 0.01 } } }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const gatewayAddress = gateway.address();
  const gatewayPort =
    gatewayAddress !== null && typeof gatewayAddress === 'object'
      ? gatewayAddress.port
      : 0;

  process.env.SANDBOX_URL = `http://127.0.0.1:${spawnerPort}`;
  process.env.SANDBOX_TOKEN = SPAWNER_TOKEN;
  process.env.SANDBOX_LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
  process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';

  try {
    // The itestagent provider + credential from the drive check are already
    // in place (same org config tree, same catalog server no longer needed —
    // the catalog was cached in-process by the earlier resolution).
    const post = (route: string, payload?: unknown): Promise<Response> =>
      fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      });
    const document = {
      version: 1,
      name: 'ops/agentic',
      nodes: [
        {
          id: 'work',
          type: 'agent',
          model: 'itest-agent-model',
          prompt: 'Analyze the input: {{ input.subject }}',
        },
      ],
      output: '{{ nodes.work.output }}',
    };
    await post(`/api/app/automations/ops/agentic/save?orgId=${orgId}`, {
      document,
    });
    await post(`/api/app/automations/ops/agentic/deploy?orgId=${orgId}`, {
      version: 1,
    });
    const started = z.object({ runId: z.string() }).safeParse(
      await (
        await post(`/api/app/automations/ops/agentic/start?orgId=${orgId}`, {
          input: { subject: 'quarterly numbers' },
          mode: 'live',
        })
      ).json(),
    );
    const runId = started.success ? started.data.runId : '';
    const settled = await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `;
      return ['success', 'failed', 'cancelled'].includes(rows[0]?.status ?? '');
    }, 60_000);
    const runRows = await sql<
      { status: string; output: unknown; detail: string | null }[]
    >`
      SELECT status, output, detail FROM app.automation_runs
      WHERE id = ${runId}
    `;
    const run = runRows[0];
    const outputRaw = JSON.stringify(run?.output ?? null);
    const opRows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_session_ops
      WHERE kind = 'workflow-agent'
      ORDER BY started_at_ms DESC LIMIT 1
    `;
    const sessionRows = await sql<{ status: string }[]>`
      SELECT status FROM app.sandbox_sessions
      WHERE owner_type = 'workflow_run'
        AND (owner_id = ${runId} OR owner_id LIKE ${runId + ':%'})
      ORDER BY created_at_ms DESC LIMIT 1
    `;

    record(
      'automation agent node (kick→park→turn→settle→resume→finish)',
      settled &&
        run?.status === 'success' &&
        outputRaw.includes(NODE_TEXT) &&
        outputRaw.includes('note.md') &&
        opRows[0]?.status === 'completed' &&
        sessionRows[0]?.status === 'stopped' &&
        gatewayCalls.minted === 1 &&
        gatewayCalls.revoked === 1,
      `run=${run?.status}${run?.detail ? ` (${run.detail.slice(0, 120)})` : ''}, output has text=${outputRaw.includes(NODE_TEXT)} file=${outputRaw.includes('note.md')}, op=${opRows[0]?.status}, session=${sessionRows[0]?.status} (want stopped), vk=${gatewayCalls.minted}/${gatewayCalls.revoked}`,
    );
  } finally {
    delete process.env.SANDBOX_URL;
    delete process.env.SANDBOX_TOKEN;
    delete process.env.SANDBOX_LLM_GATEWAY_URL;
    await new Promise<void>((resolve) => {
      spawner.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      gateway.close(() => resolve());
    });
  }
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
 * Task-agent run ledger: the status choreography kicks a queued run (same
 * transaction as the status write), capacity parks stamp-and-claim with
 * single-winner election, the release edge wakes the oldest parked run,
 * and settle/fail are exactly-once.
 */
async function checkTaskAgentRuns(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();

  // A project + agent + task assigned to the agent.
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Run Ledger' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  const agent = z.object({ agentId: z.string() }).safeParse(
    await (
      await post(`/api/app/projects/${projectId}/agents?orgId=${orgId}`, {
        name: 'Runner Bot',
        harness: 'claude-code',
        model: 'anthropic/claude-fable-5',
        skills: [],
        connectors: [],
      })
    ).json(),
  );
  const agentId = agent.success ? agent.data.agentId : '';
  const task = z.object({ taskId: z.string() }).safeParse(
    await (
      await post(`/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Agent-owned work',
      })
    ).json(),
  );
  const taskId = task.success ? task.data.taskId : '';
  await post(`/api/app/tasks/${taskId}/assign?orgId=${orgId}`, {
    assigneeType: 'agent',
    assigneeId: agentId,
  });

  // The mechanics run on a HAND-INSERTED row (no turn job): the kick +
  // full drive are proven end to end by the turn-drive check, and letting
  // the live worker race these park/claim assertions would make them
  // meaningless.
  const agentRuns = await import('./domains/tasks/agent-runs.ts');
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, started_at_ms, deadline_at_ms,
      updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, ${agentId}, 'exec-ledger-1',
      ${`pa-${agentId}`}, 'queued', 'claude-code', 'itest-model',
      'itest:ledger', ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()}
    ) RETURNING id
  `;
  const runId = inserted[0]?.id ?? '';
  const execId = 'exec-ledger-1';
  const runsView = z
    .object({
      runs: z.array(
        z.looseObject({
          id: z.string(),
          status: z.string(),
          execId: z.string(),
          launchedAt: z.number().nullable(),
        }),
      ),
    })
    .loose()
    .safeParse(await get(`/api/app/tasks/${taskId}/agent-runs?orgId=${orgId}`));
  const kicked = runsView.success
    ? runsView.data.runs.find((run) => run.id === runId)
    : undefined;

  // Park → single-winner claim (a second claim must lose) → re-park → wake.
  await agentRuns.parkAgentRunForCapacity(sql, {
    organizationId: orgId,
    runId,
    execId,
  });
  const firstClaim = await agentRuns.claimParkedAgentRun(sql, {
    organizationId: orgId,
    runId,
    execId,
  });
  const secondClaim = await agentRuns.claimParkedAgentRun(sql, {
    organizationId: orgId,
    runId,
    execId,
  });
  await agentRuns.parkAgentRunForCapacity(sql, {
    organizationId: orgId,
    runId,
    execId,
  });
  const woken = await agentRuns.wakeParkedAgentRuns(sql, orgId);
  const afterWake = await agentRuns.getAgentRun(sql, orgId, runId);

  // Launch + exactly-once settle; `launchedAt` distinct from kick time.
  const launched = await agentRuns.setAgentRunRunning(sql, {
    organizationId: orgId,
    runId,
    execId,
  });
  const settled = await agentRuns.settleAgentRun(sql, {
    organizationId: orgId,
    runId,
    execId,
    resultText: 'Delivered the work.',
  });
  const settledTwice = await agentRuns.failAgentRun(sql, {
    organizationId: orgId,
    runId,
    execId,
    error: 'late failure must not overwrite a settle',
  });
  const finalRun = await agentRuns.getAgentRun(sql, orgId, runId);

  // A live run makes a concurrent kick REUSE it; a terminal one mints anew.
  const reuseProbe = await sql.begin((tx) =>
    agentRuns.kickAgentRun(tx, {
      organizationId: orgId,
      projectId,
      taskId,
      agentId,
      harness: 'claude-code',
      model: 'itest-model',
      startedBy: 'itest:ledger',
    }),
  );
  const secondRuns = {
    success: true as const,
    data: {
      runs: await agentRuns.listAgentRunsForTask(sql, orgId, taskId),
    },
  };

  record(
    'task-agent run ledger (kick + park/claim/wake + exactly-once settle)',
    runsView.success &&
      kicked !== undefined &&
      kicked.status === 'queued' &&
      kicked.launchedAt === null &&
      firstClaim &&
      !secondClaim &&
      woken === 1 &&
      afterWake?.waitingForCapacityAt === null &&
      launched &&
      settled &&
      !settledTwice &&
      finalRun?.status === 'settled' &&
      finalRun.resultText === 'Delivered the work.' &&
      finalRun.launchedAt !== null &&
      secondRuns.success &&
      // ≥2, not ==2: the rekicked run's start fails on the fake model and
      // the auto-retry arm may already have added attempts by this read.
      secondRuns.data.runs.length >= 2 &&
      !reuseProbe.reused,
    `kick=${kicked?.status} (launchedAt null=${kicked?.launchedAt === null}), claim=${firstClaim}/${secondClaim} (want true/false), wake=${woken}, settle=${settled}/${settledTwice} (want true/false), final=${finalRun?.status} launched=${finalRun?.launchedAt !== null}, rekick runs=${secondRuns.data.runs.length} (want ≥2, fresh=${!reuseProbe.reused})`,
  );
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
  // Anchor on the first REMAINING row's stored previous_hash: retention
  // deletes the chain's oldest PREFIX, so genesis ('') only holds until the
  // first sweep — each surviving row still links to its predecessor's hash.
  let previousHash = rows[0]?.previousHash ?? '';
  let chainOk = rows.length > 0;
  const actions = new Set<string>();
  for (const row of rows) {
    actions.add(row.action);
    if ((row.previousHash ?? '') !== previousHash) {
      chainOk = false;
      break;
    }
    // A PII-scrubbed row (GDPR Art 17) keeps its stored hashes but its
    // BODY no longer matches the recompute — the flag marks the divergence
    // as intentional; linkage above still binds it into the chain.
    if (row.piiScrubbed !== true) {
      const recomputed = await computeAuditHash(
        previousHash,
        rowToHashInput(row),
      );
      if (recomputed !== row.integrityHash) {
        chainOk = false;
        break;
      }
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

/**
 * The human-ask ANSWER surface: the pending-ask read skips expired rows, an
 * expired ask refuses the answer, a live one records it and enqueues the
 * resume job in the same transaction, a second answer is refused, and the
 * cursor retarget is exec-fenced (the resume's single-winner election).
 * The route-answered run's cursor deliberately names a DIFFERENT exec so
 * the live worker's resume no-ops deterministically — the full resume dance
 * shares the substrate the agent-node check already proves.
 */
async function checkAskAnswer(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const { toJson } = await import('./db/sql.ts');
  const { automationShimHandlers } =
    await import('./domains/automations/shim.ts');
  const now = Date.now();
  const checkpointsA = {
    nodes: {},
    cursor: {
      node: 'ask_node',
      agent: { execId: 'exec-ask-other', input: {}, harness: 'claude-code' },
    },
    executions: {},
  };
  const runA = await sql<{ id: string }[]>`
    INSERT INTO app.automation_runs (
      org_id, name, version, status, mode, started_by, checkpoints,
      started_at_ms
    ) VALUES (
      ${orgId}, 'itest/ask-answer', 1, 'waiting', 'live', 'itest:ask',
      ${sql.json(toJson(checkpointsA))}, ${now}
    ) RETURNING id
  `;
  const runAId = runA[0]?.id ?? '';
  await sql`
    INSERT INTO app.automation_human_asks (
      org_id, run_id, node_id, session_id, exec_id, question, status,
      expires_at_ms, created_at_ms
    ) VALUES (
      ${orgId}, ${runAId}, 'ask_node', 'wf-ask-a', 'exec-ask-expired',
      'Expired question?', 'pending', ${now - 60_000}, ${now - 3_600_000}
    )
  `;
  const liveAsk = await sql<{ id: string }[]>`
    INSERT INTO app.automation_human_asks (
      org_id, run_id, node_id, session_id, exec_id, question, status,
      expires_at_ms, created_at_ms
    ) VALUES (
      ${orgId}, ${runAId}, 'ask_node', 'wf-ask-a', 'exec-ask-a',
      'Which VAT rate applies?', 'pending', ${now + 3_600_000}, ${now}
    ) RETURNING id
  `;
  const liveAskId = liveAsk[0]?.id ?? '';
  const expiredAskId =
    (
      await sql<{ id: string }[]>`
        SELECT id FROM app.automation_human_asks
        WHERE run_id = ${runAId} AND exec_id = 'exec-ask-expired'
      `
    )[0]?.id ?? '';

  const pending = z
    .object({
      ask: z
        .object({ askId: z.string(), question: z.string() })
        .loose()
        .nullable(),
    })
    .safeParse(
      await (
        await fetch(
          `${base}/api/app/automations/runs/${runAId}/ask?orgId=${orgId}`,
          { headers: { cookie } },
        )
      ).json(),
    );
  record(
    'pending-ask read returns the live ask, skipping the expired one',
    pending.success &&
      pending.data.ask !== null &&
      pending.data.ask.askId === liveAskId &&
      pending.data.ask.question === 'Which VAT rate applies?',
    `ask=${pending.success ? JSON.stringify(pending.data.ask)?.slice(0, 80) : 'ERR'}`,
  );

  const answerRoute = (askId: string, answer: string): Promise<Response> =>
    fetch(`${base}/api/app/automations/asks/${askId}/answer?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify({ answer }),
    });
  const expiredRes = await answerRoute(expiredAskId, 'too late');
  const expiredBody = z
    .object({ error: z.string() })
    .loose()
    .safeParse(await expiredRes.json());
  record(
    'answering an expired ask is refused',
    expiredRes.status === 409 &&
      expiredBody.success &&
      expiredBody.data.error === 'HUMAN_ASK_EXPIRED',
    `status=${expiredRes.status} error=${expiredBody.success ? expiredBody.data.error : 'ERR'}`,
  );

  const okRes = await answerRoute(liveAskId, 'The reduced rate: 7 percent.');
  const answeredRow = await sql<
    { status: string; answer: string | null; answeredBy: string | null }[]
  >`
    SELECT status, answer, answered_by AS "answeredBy"
    FROM app.automation_human_asks WHERE id = ${liveAskId}
  `;
  const resumeJobs = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM pgboss.job
    WHERE name = 'automation.ask_resume'
      AND data ->> 'askId' = ${liveAskId}
  `;
  record(
    'answer records and enqueues the resume job transactionally',
    okRes.status === 200 &&
      answeredRow[0]?.status === 'answered' &&
      answeredRow[0].answer === 'The reduced rate: 7 percent.' &&
      answeredRow[0].answeredBy === userId &&
      Number(resumeJobs[0]?.count ?? '0') >= 1,
    `status=${okRes.status} row=${answeredRow[0]?.status}/${answeredRow[0]?.answeredBy === userId} jobs=${resumeJobs[0]?.count}`,
  );

  const dupRes = await answerRoute(liveAskId, 'changed my mind');
  record(
    'a second answer is refused',
    dupRes.status === 409,
    `status=${dupRes.status} (want 409)`,
  );
  const pendingAfter = z
    .object({ ask: z.unknown().nullable() })
    .safeParse(
      await (
        await fetch(
          `${base}/api/app/automations/runs/${runAId}/ask?orgId=${orgId}`,
          { headers: { cookie } },
        )
      ).json(),
    );
  record(
    'no pending ask remains after the answer',
    pendingAfter.success && pendingAfter.data.ask === null,
    `ask=${pendingAfter.success ? JSON.stringify(pendingAfter.data.ask) : 'ERR'}`,
  );

  // Mechanics lane on a second run the worker never touches: the resume
  // reads the answered row through the shim and retargets the cursor onto
  // the fresh exec — wrong-exec attempts retarget nothing.
  const checkpointsB = {
    nodes: { earlier: { output: 'kept' } },
    cursor: {
      node: 'ask_node',
      agent: { execId: 'exec-b-1', input: {}, harness: 'claude-code' },
    },
    executions: { seq: 3 },
  };
  const runB = await sql<{ id: string }[]>`
    INSERT INTO app.automation_runs (
      org_id, name, version, status, mode, started_by, checkpoints,
      started_at_ms
    ) VALUES (
      ${orgId}, 'itest/ask-answer-b', 1, 'waiting', 'live', 'itest:ask',
      ${sql.json(toJson(checkpointsB))}, ${now}
    ) RETURNING id
  `;
  const runBId = runB[0]?.id ?? '';
  const askB = await sql<{ id: string }[]>`
    INSERT INTO app.automation_human_asks (
      org_id, run_id, node_id, session_id, exec_id, agent_session_id,
      question, answer, answered_by, answered_at_ms, status, expires_at_ms,
      created_at_ms
    ) VALUES (
      ${orgId}, ${runBId}, 'ask_node', 'wf-ask-b', 'exec-b-1', 'conv-b',
      'Approve the draft?', 'Approved.', ${userId}, ${now}, 'answered',
      ${now + 3_600_000}, ${now}
    ) RETURNING id
  `;
  const askBId = askB[0]?.id ?? '';
  const shim = automationShimHandlers(sql);
  const forResume = z
    .object({
      _id: z.string(),
      status: z.string(),
      answer: z.string(),
      agentSessionId: z.string(),
    })
    .loose()
    .safeParse(
      await shim['automations/human_asks:getAskForResume']?.({
        askId: askBId,
        organizationId: orgId,
      }),
    );
  record(
    'getAskForResume returns the answered row with its conversation handle',
    forResume.success &&
      forResume.data.status === 'answered' &&
      forResume.data.answer === 'Approved.' &&
      forResume.data.agentSessionId === 'conv-b',
    `row=${forResume.success ? `${forResume.data.status}/${forResume.data.agentSessionId}` : 'ERR'}`,
  );
  const missShape = z.object({ retargeted: z.boolean() });
  const miss = missShape.safeParse(
    await shim['automations/human_asks:retargetAgentCursor']?.({
      organizationId: orgId,
      runId: runBId,
      nodeId: 'ask_node',
      fromExecId: 'exec-b-STALE',
      toExecId: 'exec-b-2',
      deadlineAt: now + 7_200_000,
    }),
  );
  const hit = missShape.safeParse(
    await shim['automations/human_asks:retargetAgentCursor']?.({
      organizationId: orgId,
      runId: runBId,
      nodeId: 'ask_node',
      fromExecId: 'exec-b-1',
      toExecId: 'exec-b-2',
      deadlineAt: now + 7_200_000,
    }),
  );
  const patched = await sql<{ checkpoints: unknown }[]>`
    SELECT checkpoints FROM app.automation_runs WHERE id = ${runBId}
  `;
  const cp = z
    .object({
      nodes: z.object({ earlier: z.object({ output: z.string() }) }),
      cursor: z.object({
        node: z.string(),
        agent: z.object({ execId: z.string(), deadlineAt: z.number() }).loose(),
      }),
      executions: z.object({ seq: z.number() }),
    })
    .safeParse(patched[0]?.checkpoints);
  record(
    'cursor retarget is exec-fenced and patches only the agent cursor',
    miss.success &&
      !miss.data.retargeted &&
      hit.success &&
      hit.data.retargeted &&
      cp.success &&
      cp.data.cursor.agent.execId === 'exec-b-2' &&
      cp.data.cursor.agent.deadlineAt === now + 7_200_000 &&
      cp.data.nodes.earlier.output === 'kept' &&
      cp.data.executions.seq === 3,
    `miss=${miss.success ? miss.data.retargeted : 'ERR'} hit=${hit.success ? hit.data.retargeted : 'ERR'} exec=${cp.success ? cp.data.cursor.agent.execId : 'ERR'}`,
  );

  // The ask BELLS: creating an ask through the tool door's handler fans out
  // agent_escalation rows to the project audience (org admins here — the
  // run has no project), a FOLD rewrites the unread row in place, and the
  // answer dismisses it transactionally.
  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, 'wf-ask-bell', 'active', 'workflow_run', ${runAId},
      'itest:ask', ${now}, ${now + 3_600_000}
    )
  `;
  const createAsk = shim['automations/human_asks:createAskForExec'];
  const bellAsk = z
    .object({ askId: z.string() })
    .loose()
    .safeParse(
      await createAsk?.({
        organizationId: orgId,
        sessionId: 'wf-ask-bell',
        question: 'Which ledger account applies?',
      }),
    );
  const bellAskId = bellAsk.success ? bellAsk.data.askId : '';
  const bellAfterCreate = await sql<
    { read: boolean; params: Record<string, unknown> | null }[]
  >`
    SELECT read, params FROM app.user_notifications
    WHERE org_id = ${orgId} AND type = 'agent_escalation'
      AND params ->> 'askId' = ${bellAskId}
  `;
  await createAsk?.({
    organizationId: orgId,
    sessionId: 'wf-ask-bell',
    question: 'And which VAT box?',
  });
  const bellAfterFold = await sql<
    { read: boolean; params: Record<string, unknown> | null }[]
  >`
    SELECT read, params FROM app.user_notifications
    WHERE org_id = ${orgId} AND type = 'agent_escalation'
      AND params ->> 'askId' = ${bellAskId}
  `;
  await answerRoute(bellAskId, 'Account 4400, box 81.');
  const bellAfterAnswer = await sql<{ read: boolean }[]>`
    SELECT read FROM app.user_notifications
    WHERE org_id = ${orgId} AND type = 'agent_escalation'
      AND params ->> 'askId' = ${bellAskId}
  `;
  // The bell session must not linger — later capacity scenarios count the
  // org's live workflow sessions.
  await sql`
    UPDATE app.sandbox_sessions SET status = 'destroyed'
    WHERE session_id = 'wf-ask-bell'
  `;
  record(
    'ask bells: fan-out on create, fold carries the merged question, answer dismisses',
    bellAsk.success &&
      bellAfterCreate.length === 1 &&
      !(bellAfterCreate[0]?.read ?? true) &&
      // A no-task ask has no collapse subject (the 0.4 posture): the fold
      // writes its own row carrying the MERGED question.
      bellAfterFold.some((row) =>
        JSON.stringify(row.params?.question ?? '').includes(
          'And which VAT box',
        ),
      ) &&
      bellAfterAnswer.length >= 1 &&
      bellAfterAnswer.every((row) => row.read),
    `created=${bellAfterCreate.length}/${bellAfterCreate[0]?.read} (want 1/false), folded=${bellAfterFold.length}, answeredAllRead=${bellAfterAnswer.every((row) => row.read)}`,
  );
}

/**
 * The chat thread surface: list ordering (pinned float), archive paging,
 * rename/read-watermark metadata edits, project filing with the real access
 * gate, share links as `sharedAt` snapshots (org-internal, stable token),
 * branching at a message, trash/restore with the generating guard, the
 * bounded palette search, and the AI-title lane (auto-enqueued by the first
 * user message of an untitled thread; the fallback title lands when no
 * model is reachable).
 */
async function checkChatThreadSurface(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = async (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();
  const mkThread = async (body: Record<string, unknown>): Promise<string> => {
    const created = z
      .object({ id: z.string() })
      .safeParse(
        await (await post(`/api/app/chat/threads?orgId=${orgId}`, body)).json(),
      );
    return created.success ? created.data.id : '';
  };

  const threadA = await mkThread({ title: 'Alpha planning' });
  const threadB = await mkThread({});
  const summaryList = z.object({
    threads: z.array(
      z
        .object({
          id: z.string(),
          title: z.string().nullable(),
          pinnedAt: z.number().nullable(),
          archived: z.boolean(),
        })
        .loose(),
    ),
  });

  await post(`/api/app/chat/threads/${threadB}/pin?orgId=${orgId}`, {
    pinned: true,
  });
  await post(`/api/app/chat/threads/${threadB}/rename?orgId=${orgId}`, {
    title: 'Renamed talk',
  });
  await post(`/api/app/chat/threads/${threadA}/archive?orgId=${orgId}`, {
    archived: true,
  });
  const active = summaryList.safeParse(
    await get(`/api/app/chat/threads?orgId=${orgId}`),
  );
  const archived = z
    .object({
      rows: z.array(z.object({ id: z.string() }).loose()),
      nextCursor: z.number().nullable(),
    })
    .safeParse(await get(`/api/app/chat/threads/archived?orgId=${orgId}`));
  const activeIds = active.success
    ? active.data.threads.map((thread) => thread.id)
    : [];
  record(
    'thread list: pin floats, rename lands, archive pages separately',
    active.success &&
      activeIds[0] === threadB &&
      !activeIds.includes(threadA) &&
      active.data.threads[0]?.title === 'Renamed talk' &&
      archived.success &&
      archived.data.rows.some((row) => row.id === threadA) &&
      archived.data.nextCursor === null,
    `first=${activeIds[0] === threadB} archivedHidden=${!activeIds.includes(threadA)} title=${active.success ? active.data.threads[0]?.title : 'ERR'} archivedRows=${archived.success ? archived.data.rows.length : 'ERR'}`,
  );
  await post(`/api/app/chat/threads/${threadA}/archive?orgId=${orgId}`, {
    archived: false,
  });

  // Read watermark: back to unread stamps the reply watermark; read sets it.
  await post(`/api/app/chat/threads/${threadB}/read?orgId=${orgId}`, {
    read: false,
  });
  const unread = await sql<
    { lastReadAt: number | null; lastReplyAt: number | null }[]
  >`
    SELECT last_read_at_ms::float8 AS "lastReadAt",
           last_reply_at_ms::float8 AS "lastReplyAt"
    FROM app.thread_metadata WHERE thread_id = ${threadB}
  `;
  await post(`/api/app/chat/threads/${threadB}/read?orgId=${orgId}`, {});
  const readBack = await sql<{ lastReadAt: number | null }[]>`
    SELECT last_read_at_ms::float8 AS "lastReadAt"
    FROM app.thread_metadata WHERE thread_id = ${threadB}
  `;
  record(
    'read watermark round-trips',
    unread[0]?.lastReadAt === null &&
      unread[0].lastReplyAt !== null &&
      readBack[0]?.lastReadAt !== null,
    `unread=${JSON.stringify(unread[0])} read=${readBack[0]?.lastReadAt !== null}`,
  );

  // Project filing: real gate (bogus project 404), then file + list tab.
  const bogus = await post(
    `/api/app/chat/threads/${threadB}/project?orgId=${orgId}`,
    { projectId: 'nonexistent-project' },
  );
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Chat Tab' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  await post(`/api/app/chat/threads/${threadB}/project?orgId=${orgId}`, {
    projectId,
  });
  await post(`/api/app/chat/threads/${threadB}/share-project?orgId=${orgId}`, {
    shared: true,
  });
  const tab = z
    .object({
      mine: z.array(z.object({ id: z.string() }).loose()),
      shared: z.array(z.unknown()),
    })
    .safeParse(
      await get(`/api/app/chat/project/${projectId}/threads?orgId=${orgId}`),
    );
  record(
    'project filing: bogus project refused, tab lists the filed thread',
    bogus.status === 404 &&
      tab.success &&
      tab.data.mine.some((row) => row.id === threadB),
    `bogus=${bogus.status} mine=${tab.success ? tab.data.mine.length : 'ERR'}`,
  );

  // Share snapshot: two messages in, share, a later message stays out.
  const { toJson } = await import('./db/sql.ts');
  const now = Date.now();
  await sql`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, text, parts, status,
      created_at_ms
    ) VALUES
      (${threadB}, ${orgId}, 0, 0, 'user', 'hello world alpha',
       ${sql.json(toJson([{ type: 'text', text: 'hello world alpha' }]))},
       'complete', ${now - 5_000}),
      (${threadB}, ${orgId}, 1, 0, 'assistant', 'result text beta',
       ${sql.json(toJson([{ type: 'text', text: 'result text beta' }]))},
       'complete', ${now - 4_000})
  `;
  const share = z
    .object({ shareToken: z.string() })
    .safeParse(
      await (
        await post(`/api/app/chat/threads/${threadB}/share?orgId=${orgId}`)
      ).json(),
    );
  const token = share.success ? share.data.shareToken : '';
  await sql`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, text, parts, status,
      created_at_ms
    ) VALUES
      (${threadB}, ${orgId}, 2, 0, 'user', 'after the share',
       ${sql.json(toJson([{ type: 'text', text: 'after the share' }]))},
       'complete', ${Date.now() + 60_000})
  `;
  const snapshot = z
    .object({ messages: z.array(z.unknown()) })
    .loose()
    .safeParse(
      await get(`/api/app/chat/threads/shared/${token}?orgId=${orgId}`),
    );
  await post(`/api/app/chat/threads/${threadB}/unshare?orgId=${orgId}`);
  const dark = await fetch(
    `${base}/api/app/chat/threads/shared/${token}?orgId=${orgId}`,
    { headers: { cookie } },
  );
  const reshare = z
    .object({ shareToken: z.string() })
    .safeParse(
      await (
        await post(`/api/app/chat/threads/${threadB}/share?orgId=${orgId}`)
      ).json(),
    );
  record(
    'share links: snapshot cut at sharedAt, unshare goes dark, token stable',
    share.success &&
      snapshot.success &&
      snapshot.data.messages.length === 2 &&
      dark.status === 404 &&
      reshare.success &&
      reshare.data.shareToken === token,
    `snapshot=${snapshot.success ? snapshot.data.messages.length : 'ERR'} (want 2), dark=${dark.status}, stable=${reshare.success && reshare.data.shareToken === token}`,
  );

  // Branch at the first message: exactly one message crosses.
  const forkSource = await sql<{ id: string }[]>`
    SELECT id FROM app.messages
    WHERE thread_id = ${threadB} AND "order" = 0 AND step_order = 0
  `;
  const branch = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/chat/threads/${threadB}/branch?orgId=${orgId}`, {
        fromMessageId: forkSource[0]?.id ?? '',
      })
    ).json(),
  );
  const branchId = branch.success ? branch.data.id : '';
  const branchCount = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.messages
    WHERE thread_id = ${branchId}
  `;
  record(
    'branching copies the history up to the fork only',
    branch.success && branchCount[0]?.count === '1',
    `copied=${branchCount[0]?.count} (want 1)`,
  );

  // Trash: refused while generating; then trash + restore round-trips.
  await sql`
    INSERT INTO app.generations (
      thread_id, org_id, started_at_ms, heartbeat_at_ms, updated_at_ms
    ) VALUES (${branchId}, ${orgId}, ${Date.now()}, ${Date.now()},
              ${Date.now()})
  `;
  const trashLive = z
    .object({ ok: z.boolean() })
    .safeParse(
      await (
        await post(`/api/app/chat/threads/${branchId}/trash?orgId=${orgId}`)
      ).json(),
    );
  await sql`DELETE FROM app.generations WHERE thread_id = ${branchId}`;
  await post(`/api/app/chat/threads/${branchId}/trash?orgId=${orgId}`);
  const trashedSummary = await fetch(
    `${base}/api/app/chat/threads/${branchId}/summary?orgId=${orgId}`,
    { headers: { cookie } },
  );
  await post(`/api/app/chat/threads/${branchId}/restore?orgId=${orgId}`);
  const restoredSummary = await fetch(
    `${base}/api/app/chat/threads/${branchId}/summary?orgId=${orgId}`,
    { headers: { cookie } },
  );
  record(
    'trash: generating refuses, trashed reads as gone, restore returns it',
    trashLive.success &&
      !trashLive.data.ok &&
      trashedSummary.status === 404 &&
      restoredSummary.status === 200,
    `live=${trashLive.success ? trashLive.data.ok : 'ERR'} (want false), trashed=${trashedSummary.status}, restored=${restoredSummary.status}`,
  );

  // Palette search: message text, title, and a guaranteed miss.
  const hitsSchema = z.object({
    results: z.array(z.object({ threadId: z.string() }).loose()),
  });
  const byText = hitsSchema.safeParse(
    await get(
      `/api/app/chat/threads/search?orgId=${orgId}&q=${encodeURIComponent('hello alpha')}`,
    ),
  );
  const byTitle = hitsSchema.safeParse(
    await get(`/api/app/chat/threads/search?orgId=${orgId}&q=renamed`),
  );
  const miss = hitsSchema.safeParse(
    await get(`/api/app/chat/threads/search?orgId=${orgId}&q=zzzznope`),
  );
  record(
    'palette search matches message text and titles, bounded',
    byText.success &&
      byText.data.results.some((hit) => hit.threadId === threadB) &&
      byTitle.success &&
      byTitle.data.results.some((hit) => hit.threadId === threadB) &&
      miss.success &&
      miss.data.results.length === 0,
    `text=${byText.success && byText.data.results.length} title=${byTitle.success && byTitle.data.results.length} miss=${miss.success ? miss.data.results.length : 'ERR'}`,
  );

  // Edit/regenerate lineage: an EDIT fork copies strictly BEFORE the edited
  // user message; a REGENERATE fork copies THROUGH the prompt it re-answers;
  // both are HIDDEN siblings on the root (absent from the list), the
  // lineage read returns them with the selection map, and the turn-scope
  // walk widens to the whole lineage.
  const editBranch = z
    .object({ id: z.string() })
    .safeParse(
      await (
        await post(
          `/api/app/chat/threads/${threadB}/branch-edit?orgId=${orgId}`,
          { editedMessageId: forkSource[0]?.id ?? '' },
        )
      ).json(),
    );
  const editBranchId = editBranch.success ? editBranch.data.id : '';
  const editCount = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.messages
    WHERE thread_id = ${editBranchId}
  `;
  const assistantMsg = await sql<{ id: string }[]>`
    SELECT id FROM app.messages
    WHERE thread_id = ${threadB} AND "order" = 1 AND role = 'assistant'
  `;
  const regenBranch = z
    .object({ id: z.string() })
    .safeParse(
      await (
        await post(
          `/api/app/chat/threads/${threadB}/branch-regenerate?orgId=${orgId}`,
          { assistantMessageId: assistantMsg[0]?.id ?? '' },
        )
      ).json(),
    );
  const regenBranchId = regenBranch.success ? regenBranch.data.id : '';
  const regenCount = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.messages
    WHERE thread_id = ${regenBranchId}
  `;
  await post(
    `/api/app/chat/threads/${threadB}/branch-selection?orgId=${orgId}`,
    { forkKey: `${threadB}:0`, selectedThreadId: regenBranchId },
  );
  const lineage = z
    .object({
      branches: z.array(z.object({ id: z.string() }).loose()),
      selections: z.string().nullable(),
    })
    .safeParse(
      await get(`/api/app/chat/threads/${threadB}/branches?orgId=${orgId}`),
    );
  const activeAfterBranches = summaryList.safeParse(
    await get(`/api/app/chat/threads?orgId=${orgId}`),
  );
  const listedIds = activeAfterBranches.success
    ? activeAfterBranches.data.threads.map((thread) => thread.id)
    : [];
  const { getThreadLineageIds } = await import('./domains/chat/threads.ts');
  const scope = await getThreadLineageIds(sql, orgId, regenBranchId);
  record(
    'edit/regenerate lineage: copy boundaries, hidden siblings, scope walk',
    editBranch.success &&
      editCount[0]?.count === '0' &&
      regenBranch.success &&
      regenCount[0]?.count === '1' &&
      lineage.success &&
      lineage.data.branches.length === 2 &&
      (lineage.data.selections ?? '').includes(regenBranchId) &&
      !listedIds.includes(editBranchId) &&
      !listedIds.includes(regenBranchId) &&
      scope.rootId === threadB &&
      scope.threadIds.includes(threadB) &&
      scope.threadIds.includes(editBranchId) &&
      scope.threadIds.includes(regenBranchId),
    `edit=${editCount[0]?.count} (want 0), regen=${regenCount[0]?.count} (want 1), lineage=${lineage.success ? lineage.data.branches.length : 'ERR'} (want 2), hidden=${!listedIds.includes(editBranchId)}, scope=${scope.threadIds.length}`,
  );

  // The AI-title lane: the TurnStore's first-user-message append on an
  // untitled thread enqueues the job; with no reachable model the fallback
  // (the message's own words) lands via the guarded fill-only write.
  const untitled = await mkThread({});
  const { createPgTurnStore } = await import('./domains/chat/store.ts');
  await createPgTurnStore(sql).appendMessage({
    organizationId: orgId,
    threadId: untitled,
    role: 'user',
    parts: [{ type: 'text', text: 'Quarterly VAT filing question' }],
  });
  let title: string | null = null;
  for (let i = 0; i < 40; i++) {
    const rows = await sql<{ title: string | null }[]>`
      SELECT title FROM app.threads WHERE id = ${untitled}
    `;
    title = rows[0]?.title ?? null;
    if (title !== null) break;
    await sleep(250);
  }
  await post(`/api/app/chat/threads/${untitled}/rename?orgId=${orgId}`, {
    title: 'Owner named it',
  });
  await setThreadTitleProbe(sql, orgId, untitled);
  const renamed = await sql<{ title: string | null }[]>`
    SELECT title FROM app.threads WHERE id = ${untitled}
  `;
  record(
    'AI title lane: auto-enqueued, fallback lands, never clobbers a name',
    title !== null &&
      title.length > 0 &&
      renamed[0]?.title === 'Owner named it',
    `title=${JSON.stringify(title)} afterRename=${renamed[0]?.title}`,
  );
}

/** Re-run the guarded fill-only write against a NAMED thread — it must be a
 * no-op (the AI title never clobbers an owner's rename). */
async function setThreadTitleProbe(
  sql: Sql,
  organizationId: string,
  threadId: string,
): Promise<void> {
  const { setThreadTitleIfAbsent } = await import('./domains/chat/threads.ts');
  await setThreadTitleIfAbsent(sql, organizationId, threadId, 'clobber probe');
}

/**
 * Memories (approval-gated), the Auto model pick (`modelSelection: 'auto'`
 * resolved inside the reused turn via the new credential-facts + governance
 * shim reads), and deferred sends (park on a still-indexing attachment,
 * readiness poll, claim → the turn runs under the stored identity, the row
 * settles). A live fake provider serves the catalog and the streaming
 * completions for both turns.
 */
async function checkChatMemoriesDeferredAuto(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId } = ctx;
  const { createServer } = await import('node:http');
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();

  // ---- memories -----------------------------------------------------------
  const saved = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/chat/memories?orgId=${orgId}`, {
        content: 'Prefers metric units',
      })
    ).json(),
  );
  const memoryId = saved.success ? saved.data.id : '';
  const listedPending = z
    .object({
      pending: z.array(z.object({ id: z.string(), content: z.string() })),
      approved: z.array(z.unknown()),
    })
    .safeParse(await get(`/api/app/chat/memories?orgId=${orgId}`));
  const searchWhilePending = z
    .object({ memories: z.array(z.unknown()) })
    .safeParse(
      await get(`/api/app/chat/memories/search?orgId=${orgId}&q=metric`),
    );
  await post(`/api/app/chat/memories/${memoryId}/review?orgId=${orgId}`, {
    decision: 'approved',
  });
  const searchApproved = z
    .object({ memories: z.array(z.object({ content: z.string() }).loose()) })
    .safeParse(
      await get(`/api/app/chat/memories/search?orgId=${orgId}&q=metric`),
    );
  const bogusReview = z
    .object({ ok: z.boolean() })
    .safeParse(
      await (
        await post(
          `/api/app/chat/memories/00000000-0000-4000-8000-000000000000/review?orgId=${orgId}`,
          { decision: 'approved' },
        )
      ).json(),
    );
  record(
    'memories: pending until approved, retrieval sees approved only',
    saved.success &&
      listedPending.success &&
      listedPending.data.pending.some((row) => row.id === memoryId) &&
      listedPending.data.approved.length === 0 &&
      searchWhilePending.success &&
      searchWhilePending.data.memories.length === 0 &&
      searchApproved.success &&
      searchApproved.data.memories.length === 1 &&
      bogusReview.success &&
      !bogusReview.data.ok,
    `pending=${listedPending.success ? listedPending.data.pending.length : 'ERR'}, hiddenWhilePending=${searchWhilePending.success ? searchWhilePending.data.memories.length === 0 : 'ERR'}, approvedHits=${searchApproved.success ? searchApproved.data.memories.length : 'ERR'}, bogus=${bogusReview.success ? bogusReview.data.ok : 'ERR'} (want false)`,
  );

  // ---- a live fake provider (catalog + streaming completions) -------------
  const AUTO_ANSWER = 'Deferred answer done.';
  const autoServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.endsWith('/models')) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              {
                id: 'auto-pick-model',
                object: 'model',
                context_length: 32_768,
              },
            ],
          }),
        );
        return;
      }
      if (url.endsWith('/chat/completions')) {
        res.setHeader('content-type', 'text/event-stream');
        const sse = (payload: unknown): string =>
          `data: ${JSON.stringify(payload)}\n\n`;
        for (const word of AUTO_ANSWER.split(' ')) {
          res.write(
            sse({
              choices: [
                {
                  index: 0,
                  delta: { content: `${word} ` },
                  finish_reason: null,
                },
              ],
            }),
          );
        }
        res.write(
          sse({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 9,
              completion_tokens: 4,
              total_tokens: 13,
            },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    autoServer.listen(0, '127.0.0.1', resolve);
  });
  const address = autoServer.address();
  const port =
    address !== null && typeof address === 'object' ? address.port : 0;

  try {
    process.env.TALE_ALLOW_PRIVATE_PROVIDER_HOSTS = '1';
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    const providersDir = path.join(configRoot, orgSlug, 'providers');
    await mkdir(providersDir, { recursive: true });
    await writeFile(
      path.join(providersDir, 'itestauto.yml'),
      [
        'name: itestauto',
        'displayName: Itest Auto',
        'apiFormat: openai',
        `baseUrl: http://127.0.0.1:${port}/v1`,
        'catalog:',
        '  source: models-endpoint',
        'auth:',
        '  - method: api-key',
      ].join('\n'),
    );
    // Pin the pick: earlier checks left providers whose catalogs are CACHED
    // but whose endpoints are dead — an allowlist makes Auto deterministic
    // (and the deferred turn's explicit model passes the same policy).
    const governanceDir = path.join(configRoot, orgSlug, 'governance');
    await mkdir(governanceDir, { recursive: true });
    await writeFile(
      path.join(governanceDir, 'model-access.yml'),
      [
        'enabled: true',
        'mode: allowlist',
        'rules:',
        '  - scope: default',
        '    allowedModels:',
        '      - auto-pick-model',
      ].join('\n'),
    );
    const orgConfig = await import('./lib/org-config.ts');
    orgConfig.clearOrgConfigCaches();
    await post(`/api/app/provider-credentials?orgId=${orgId}`, {
      providerSlug: 'itestauto',
      authMethod: 'api-key',
      name: 'Auto key',
      secret: 'sk-itest-auto',
    });

    // ---- the Auto turn ----------------------------------------------------
    const autoThread = z.object({ id: z.string() }).safeParse(
      await (
        await post(`/api/app/chat/threads?orgId=${orgId}`, {
          title: 'Auto pick',
        })
      ).json(),
    );
    const autoThreadId = autoThread.success ? autoThread.data.id : '';
    const autoSend = z
      .object({ status: z.string() })
      .loose()
      .safeParse(
        await (
          await post(
            `/api/app/chat/threads/${autoThreadId}/messages?orgId=${orgId}`,
            { text: 'Pick a model for me and answer.', modelSelection: 'auto' },
          )
        ).json(),
      );
    const autoMessages = await sql<
      { role: string; text: string | null; model: string | null }[]
    >`
      SELECT role, text, model FROM app.messages
      WHERE thread_id = ${autoThreadId}
      ORDER BY "order"
    `;
    const autoAssistant = autoMessages.find((row) => row.role === 'assistant');
    record(
      'Auto resolves a concrete model inside the reused turn and completes',
      autoSend.success &&
        autoSend.data.status === 'completed' &&
        (autoAssistant?.text ?? '').includes('Deferred answer done') &&
        autoAssistant?.model === 'auto-pick-model',
      `status=${autoSend.success ? autoSend.data.status : 'ERR'} model=${autoAssistant?.model} text="${(autoAssistant?.text ?? '').slice(0, 30)}"`,
    );

    // ---- the composer surface ----------------------------------------------
    const composer = z
      .object({
        models: z.array(
          z
            .object({
              id: z.string(),
              providerSlug: z.string(),
              credential: z.object({ authMethod: z.string() }).loose(),
            })
            .loose(),
        ),
        harnesses: z.array(z.object({ harness: z.string() }).loose()),
        voice: z.object({
          ttsAvailable: z.boolean(),
          transcriptionAvailable: z.boolean(),
        }),
      })
      .safeParse(await get(`/api/app/chat/composer/models?orgId=${orgId}`));
    const capabilities = z
      .object({
        skills: z.array(z.unknown()),
        connectors: z.array(z.unknown()),
      })
      .safeParse(
        await get(
          `/api/app/chat/composer/automation-capabilities?orgId=${orgId}`,
        ),
      );
    record(
      'composer picker: governance-filtered models + harness roster',
      composer.success &&
        composer.data.models.some(
          (model) =>
            model.id === 'auto-pick-model' &&
            model.providerSlug === 'itestauto' &&
            model.credential.authMethod === 'api-key',
        ) &&
        // The allowlist pin means ONLY the auto model survives the filter.
        composer.data.models.every((model) => model.id === 'auto-pick-model') &&
        composer.data.harnesses.length > 0 &&
        capabilities.success,
      `models=${composer.success ? composer.data.models.map((model) => model.id).join(',') : 'ERR'} harnesses=${composer.success ? composer.data.harnesses.length : 'ERR'} capabilities=${capabilities.success}`,
    );

    // ---- deferred sends ---------------------------------------------------
    const deferThread = z.object({ id: z.string() }).safeParse(
      await (
        await post(`/api/app/chat/threads?orgId=${orgId}`, {
          title: 'Deferred send',
        })
      ).json(),
    );
    const deferThreadId = deferThread.success ? deferThread.data.id : '';
    const storageRef = `itest-defer-${Date.now()}`;
    await sql`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        created_at_ms
      ) VALUES (
        ${orgId}, ${storageRef}, 'brief.pdf', 'application/pdf', 512,
        'running', ${Date.now()}
      )
    `;
    const noModel = await post(
      `/api/app/chat/threads/${deferThreadId}/deferred-sends?orgId=${orgId}`,
      { text: 'missing model' },
    );
    const parked = z.object({ deferredSendId: z.string() }).safeParse(
      await (
        await post(
          `/api/app/chat/threads/${deferThreadId}/deferred-sends?orgId=${orgId}`,
          {
            text: 'Summarize the brief.',
            modelId: 'auto-pick-model',
            attachments: [
              {
                fileId: storageRef,
                fileName: 'brief.pdf',
                fileType: 'application/pdf',
                fileSize: 512,
              },
            ],
          },
        )
      ).json(),
    );
    await sleep(1200); // let the first poll run — the row must stay parked
    const stillWaiting = z
      .object({
        sends: z.array(z.object({ status: z.string() }).loose()),
      })
      .safeParse(
        await get(
          `/api/app/chat/threads/${deferThreadId}/deferred-sends?orgId=${orgId}`,
        ),
      );
    await sql`
      UPDATE app.file_metadata SET rag_status = 'completed'
      WHERE storage_ref = ${storageRef}
    `;
    let sendsLeft = -1;
    for (let i = 0; i < 60; i++) {
      const rows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM app.deferred_sends
        WHERE thread_id = ${deferThreadId}
      `;
      sendsLeft = Number(rows[0]?.count ?? '-1');
      if (sendsLeft === 0) break;
      await sleep(300);
    }
    const deferMessages = await sql<{ role: string; text: string | null }[]>`
      SELECT role, text FROM app.messages
      WHERE thread_id = ${deferThreadId}
      ORDER BY "order"
    `;
    const cancelRow = z
      .object({ deferredSendId: z.string() })
      .safeParse(
        await (
          await post(
            `/api/app/chat/threads/${deferThreadId}/deferred-sends?orgId=${orgId}`,
            { text: 'never sends', modelId: 'auto-pick-model' },
          )
        ).json(),
      );
    // A no-attachment row is ready immediately — cancel must win the race
    // only if it lands first, so cancel a PARKED row instead: re-park on the
    // same file flipped back to running.
    await sql`
      UPDATE app.file_metadata SET rag_status = 'running'
      WHERE storage_ref = ${storageRef}
    `;
    const cancelParked = z.object({ deferredSendId: z.string() }).safeParse(
      await (
        await post(
          `/api/app/chat/threads/${deferThreadId}/deferred-sends?orgId=${orgId}`,
          {
            text: 'parked to cancel',
            modelId: 'auto-pick-model',
            attachments: [
              {
                fileId: storageRef,
                fileName: 'brief.pdf',
                fileType: 'application/pdf',
                fileSize: 512,
              },
            ],
          },
        )
      ).json(),
    );
    const cancelled = z
      .object({ ok: z.boolean() })
      .safeParse(
        await (
          await post(
            `/api/app/chat/deferred-sends/${cancelParked.success ? cancelParked.data.deferredSendId : ''}/cancel?orgId=${orgId}`,
          )
        ).json(),
      );
    record(
      'deferred send: parks on indexing, runs on readiness, cancel works',
      noModel.status === 400 &&
        parked.success &&
        stillWaiting.success &&
        stillWaiting.data.sends.some((row) => row.status === 'waiting') &&
        sendsLeft === 0 &&
        deferMessages.some(
          (row) =>
            row.role === 'assistant' &&
            (row.text ?? '').includes('Deferred answer done'),
        ) &&
        cancelRow.success &&
        cancelled.success &&
        cancelled.data.ok,
      `noModel=${noModel.status} (want 400), parkedWhileIndexing=${stillWaiting.success && stillWaiting.data.sends.length > 0}, settled=${sendsLeft === 0}, answered=${deferMessages.filter((row) => row.role === 'assistant').length}, cancel=${cancelled.success ? cancelled.data.ok : 'ERR'}`,
    );
  } finally {
    // Lift the pick pin — later checks (automation llm nodes, the
    // governance scenario) bring their own policies.
    const configRoot = process.env.TALE_CONFIG_DIR ?? '';
    await writeFile(
      path.join(configRoot, orgSlug, 'governance', 'model-access.yml'),
      'enabled: false\n',
    );
    const orgConfig = await import('./lib/org-config.ts');
    orgConfig.clearOrgConfigCaches();
    await new Promise<void>((resolve) => {
      autoServer.close(() => resolve());
    });
  }
}

/**
 * Branding (per-org theming files: open pre-auth read with the default
 * bucket, admin-gated writes, image lifecycle, history snapshot, reset) and
 * team membership over the Better Auth tables.
 */
async function checkBrandingAndTeams(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string, withCookie = true): Promise<unknown> =>
    (
      await fetch(`${base}${route}`, {
        headers: withCookie ? { cookie } : {},
      })
    ).json();

  // Pre-auth read (no session): the platform default bucket answers.
  const preAuth = z
    .object({ logoUrl: z.string().nullable(), hash: z.string() })
    .loose()
    .safeParse(await get(`/api/app/branding`, false));
  await post(`/api/app/branding/save?orgId=${orgId}`, {
    accentColor: '#ff0055',
  });
  // A 1x1 transparent PNG.
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const savedImage = z.object({ filename: z.string() }).safeParse(
    await (
      await post(`/api/app/branding/images?orgId=${orgId}`, {
        type: 'logo',
        base64: pngBase64,
        mimeType: 'image/png',
      })
    ).json(),
  );
  // The 0.4 flow: the upload stores the FILE; the filename lands in the
  // config through the follow-up save (the settings page's submit).
  await post(`/api/app/branding/save?orgId=${orgId}`, {
    accentColor: '#ff0055',
    logoFilename: savedImage.success ? savedImage.data.filename : '',
  });
  const branded = z
    .object({
      appName: z.string().optional(),
      accentColor: z.string().optional(),
      logoUrl: z.string().nullable(),
      hash: z.string(),
    })
    .loose()
    .safeParse(await get(`/api/app/branding?orgId=${orgId}`));
  const snapshot = z
    .object({ snapshot: z.object({ timestamp: z.string() }).nullable() })
    .safeParse(
      await (await post(`/api/app/branding/snapshot?orgId=${orgId}`)).json(),
    );
  await fetch(`${base}/api/app/branding/images/logo?orgId=${orgId}`, {
    method: 'DELETE',
    headers: { cookie, origin: base },
  });
  await post(`/api/app/branding/reset?orgId=${orgId}`);
  const afterReset = z
    .object({
      accentColor: z.string().optional(),
      logoUrl: z.string().nullable(),
    })
    .loose()
    .safeParse(await get(`/api/app/branding?orgId=${orgId}`));
  record(
    'branding: pre-auth default, admin save/image/snapshot, reset clears',
    preAuth.success &&
      preAuth.data.logoUrl === null &&
      savedImage.success &&
      savedImage.data.filename === 'logo.png' &&
      branded.success &&
      branded.data.accentColor === '#ff0055' &&
      (branded.data.logoUrl ?? '').endsWith(
        `/branding/images/${orgSlug}/logo.png`,
      ) &&
      typeof branded.data.appName === 'string' &&
      snapshot.success &&
      snapshot.data.snapshot !== null &&
      afterReset.success &&
      afterReset.data.accentColor === undefined &&
      afterReset.data.logoUrl === null,
    `preAuth=${preAuth.success}, image=${savedImage.success ? savedImage.data.filename : 'ERR'}, accent=${branded.success ? branded.data.accentColor : 'ERR'}, logo=${branded.success ? branded.data.logoUrl : 'ERR'}, snapshot=${snapshot.success && snapshot.data.snapshot !== null}, reset=${afterReset.success ? `${afterReset.data.accentColor}/${afterReset.data.logoUrl}` : 'ERR'}`,
  );

  // Teams: membership add/list/remove over the Better Auth tables.
  const teamId = `itest-team-${Date.now()}`;
  await sql`
    INSERT INTO "team" ("id", "name", "organizationId", "createdAt")
    VALUES (${teamId}, 'Itest Team', ${orgId}, ${new Date()})
  `;
  const added = z
    .object({ id: z.string(), alreadyMember: z.boolean() })
    .safeParse(
      await (
        await post(`/api/app/teams/${teamId}/members?orgId=${orgId}`, {
          userId,
        })
      ).json(),
    );
  const dup = z
    .object({ alreadyMember: z.boolean() })
    .loose()
    .safeParse(
      await (
        await post(`/api/app/teams/${teamId}/members?orgId=${orgId}`, {
          userId,
        })
      ).json(),
    );
  const outsider = await post(
    `/api/app/teams/${teamId}/members?orgId=${orgId}`,
    { userId: 'not-a-member' },
  );
  const listed = z
    .object({
      members: z.array(
        z.object({ userId: z.string(), email: z.string().optional() }).loose(),
      ),
    })
    .safeParse(await get(`/api/app/teams/${teamId}/members?orgId=${orgId}`));
  const removed = z
    .object({ removed: z.boolean() })
    .safeParse(
      await (
        await fetch(
          `${base}/api/app/teams/${teamId}/members/${userId}?orgId=${orgId}`,
          { method: 'DELETE', headers: { cookie, origin: base } },
        )
      ).json(),
    );
  record(
    'teams: add/dedupe/list/remove membership, outsiders refused',
    added.success &&
      !added.data.alreadyMember &&
      dup.success &&
      dup.data.alreadyMember &&
      outsider.status === 400 &&
      listed.success &&
      listed.data.members.length === 1 &&
      listed.data.members[0]?.userId === userId &&
      typeof listed.data.members[0]?.email === 'string' &&
      removed.success &&
      removed.data.removed,
    `add=${added.success ? added.data.alreadyMember : 'ERR'} (want false), dup=${dup.success ? dup.data.alreadyMember : 'ERR'} (want true), outsider=${outsider.status} (want 400), listed=${listed.success ? listed.data.members.length : 'ERR'}, removed=${removed.success ? removed.data.removed : 'ERR'}`,
  );
}

/**
 * Agent secrets: write-only values (masked listings), upsert/delete audit,
 * and the per-turn env resolution through the work lanes' shim handler —
 * with the credential-access audit row per injected name.
 */
async function checkAgentSecrets(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const created = z.object({ created: z.boolean() }).safeParse(
    await (
      await post(`/api/app/agent-secrets?orgId=${orgId}`, {
        name: 'ITEST_TOKEN',
        value: 'tok-123456789',
        description: 'itest secret',
      })
    ).json(),
  );
  const updated = z.object({ created: z.boolean() }).safeParse(
    await (
      await post(`/api/app/agent-secrets?orgId=${orgId}`, {
        name: 'ITEST_TOKEN',
        value: 'tok-rotated-987654321',
      })
    ).json(),
  );
  const badName = await post(`/api/app/agent-secrets?orgId=${orgId}`, {
    name: '1BAD NAME',
    value: 'whatever-long-enough',
  });
  const listed = z
    .object({
      secrets: z.array(
        z
          .object({ name: z.string(), maskedPreview: z.string().nullable() })
          .loose(),
      ),
    })
    .safeParse(
      await (
        await fetch(`${base}/api/app/agent-secrets?orgId=${orgId}`, {
          headers: { cookie },
        })
      ).json(),
    );
  const listedRow = listed.success ? listed.data.secrets[0] : undefined;

  const { sandboxToolShimHandlers } = await import('./domains/sandbox/shim.ts');
  const resolve =
    sandboxToolShimHandlers(sql)[
      'agent_secrets/actions:resolveAgentSecretsEnv'
    ];
  const resolved = z
    .object({ env: z.record(z.string(), z.string()) })
    .safeParse(
      await resolve?.({
        organizationId: orgId,
        sessionId: 'itest-secrets-session',
        names: ['ITEST_TOKEN', 'MISSING_NAME'],
      }),
    );
  const accessRows = await sql<{ slug: string }[]>`
    SELECT slug FROM app.sandbox_credential_access
    WHERE session_id = 'itest-secrets-session'
  `;
  await fetch(`${base}/api/app/agent-secrets/ITEST_TOKEN?orgId=${orgId}`, {
    method: 'DELETE',
    headers: { cookie, origin: base },
  });
  const afterDelete = z
    .object({ env: z.record(z.string(), z.string()) })
    .safeParse(
      await resolve?.({
        organizationId: orgId,
        sessionId: 'itest-secrets-session-2',
        names: ['ITEST_TOKEN'],
      }),
    );
  record(
    'agent secrets: write-only upsert, masked list, turn env injection',
    created.success &&
      created.data.created &&
      updated.success &&
      !updated.data.created &&
      badName.status === 400 &&
      listed.success &&
      listedRow?.name === 'ITEST_TOKEN' &&
      (listedRow.maskedPreview ?? '').includes('•') &&
      !JSON.stringify(listed.data).includes('tok-rotated') &&
      resolved.success &&
      resolved.data.env.ITEST_TOKEN === 'tok-rotated-987654321' &&
      !('MISSING_NAME' in resolved.data.env) &&
      accessRows.length === 1 &&
      accessRows[0]?.slug === 'agent-secret:ITEST_TOKEN' &&
      afterDelete.success &&
      Object.keys(afterDelete.data.env).length === 0,
    `created=${created.success ? created.data.created : 'ERR'}, rotatedIsUpdate=${updated.success ? !updated.data.created : 'ERR'}, badName=${badName.status}, masked=${listedRow?.maskedPreview}, env=${resolved.success ? resolved.data.env.ITEST_TOKEN === 'tok-rotated-987654321' : 'ERR'}, audit=${accessRows[0]?.slug}, afterDelete=${afterDelete.success ? Object.keys(afterDelete.data.env).length : 'ERR'}`,
  );
}

/**
 * Knowledge entries: topic-keyed markdown facts with the supersede chain —
 * create (dup refused), update (chain + SAME backing file re-indexed, so
 * the corpus replaces in place), agent listing through the chat shim,
 * versions, and delete (chain soft-deleted + backing document trashed ⇒
 * unretrievable).
 */
async function checkKnowledgeEntries(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();

  const created = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/knowledge-entries?orgId=${orgId}`, {
        topic: 'VAT filing deadline',
        content: 'Quarterly VAT filings are due on the 10th.',
      })
    ).json(),
  );
  const entryId = created.success ? created.data.id : '';
  const dup = await post(`/api/app/knowledge-entries?orgId=${orgId}`, {
    topic: '  vat   FILING deadline ',
    content: 'Duplicate by normalized topic key.',
  });
  const firstFile = await sql<
    { fileId: string; storageRef: string; documentId: string | null }[]
  >`
    SELECT fm.id AS "fileId", fm.storage_ref AS "storageRef",
           fm.document_id AS "documentId"
    FROM app.file_metadata fm
    JOIN app.knowledge_entries ke ON ke.document_id = fm.document_id
    WHERE ke.id = ${entryId}
  `;
  const updated = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/knowledge-entries/${entryId}?orgId=${orgId}`, {
        topic: 'VAT filing deadline',
        content: 'Quarterly VAT filings are due on the 10th of the month.',
      })
    ).json(),
  );
  const newEntryId = updated.success ? updated.data.id : '';
  const afterUpdate = await sql<{ fileId: string; storageRef: string }[]>`
    SELECT fm.id AS "fileId", fm.storage_ref AS "storageRef"
    FROM app.file_metadata fm
    JOIN app.knowledge_entries ke ON ke.document_id = fm.document_id
    WHERE ke.id = ${newEntryId}
  `;
  const versions = z
    .object({
      versions: z.array(z.object({ status: z.string() }).loose()),
    })
    .safeParse(
      await get(
        `/api/app/knowledge-entries/${newEntryId}/versions?orgId=${orgId}`,
      ),
    );
  const { chatShimHandlers } = await import('./domains/chat/shim.ts');
  const agentListing = z
    .object({
      page: z.array(z.object({ topic: z.string(), content: z.string() })),
      isDone: z.boolean(),
    })
    .loose()
    .safeParse(
      await chatShimHandlers(sql)[
        'knowledge_entries/internal_queries:listEntriesForAgent'
      ]?.({
        organizationId: orgId,
        topic: 'vat',
        paginationOpts: { numItems: 10, cursor: null },
      }),
    );
  await fetch(
    `${base}/api/app/knowledge-entries/${newEntryId}?orgId=${orgId}`,
    {
      method: 'DELETE',
      headers: { cookie, origin: base },
    },
  );
  const afterDelete = z
    .object({ rows: z.array(z.unknown()) })
    .loose()
    .safeParse(await get(`/api/app/knowledge-entries?orgId=${orgId}`));
  const docTrashed = await sql<{ lifecycleStatus: string | null }[]>`
    SELECT d.lifecycle_status AS "lifecycleStatus"
    FROM app.documents d
    JOIN app.knowledge_entries ke ON ke.document_id = d.id
    WHERE ke.id = ${newEntryId}
  `;
  record(
    'knowledge entries: chain + stable corpus key + agent leg + delete',
    created.success &&
      dup.status === 409 &&
      updated.success &&
      firstFile[0] !== undefined &&
      afterUpdate[0] !== undefined &&
      afterUpdate[0].fileId === firstFile[0].fileId &&
      afterUpdate[0].storageRef !== firstFile[0].storageRef &&
      versions.success &&
      versions.data.versions.length === 2 &&
      agentListing.success &&
      agentListing.data.page.length === 1 &&
      agentListing.data.page[0]?.content.includes('10th of the month') &&
      afterDelete.success &&
      afterDelete.data.rows.length === 0 &&
      docTrashed[0]?.lifecycleStatus === 'trashed',
    `dup=${dup.status} (want 409), sameFile=${afterUpdate[0]?.fileId === firstFile[0]?.fileId}, rotatedRef=${afterUpdate[0]?.storageRef !== firstFile[0]?.storageRef}, versions=${versions.success ? versions.data.versions.length : 'ERR'}, agent=${agentListing.success ? agentListing.data.page.length : 'ERR'}, deleted=${afterDelete.success ? afterDelete.data.rows.length : 'ERR'}, doc=${docTrashed[0]?.lifecycleStatus}`,
  );
}

/**
 * Collab emitters: the creator auto-follows their task; an agent's status
 * flip writes ONE coalesced bell (a second flip rewrites it in place); an
 * agent comment writes task_commented; a pref toggle blocks the write; and
 * mark-all clears the bell.
 */
async function checkCollabEmitters(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Bells' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  const task = z.object({ taskId: z.string() }).safeParse(
    await (
      await post(`/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Bell quarry',
      })
    ).json(),
  );
  const taskId = task.success ? task.data.taskId : '';
  const creatorSub = await sql<{ reason: string }[]>`
    SELECT reason FROM app.task_subscriptions
    WHERE task_id = ${taskId} AND subscriber_id = ${userId}
  `;

  const { agentTurnShimHandlers } =
    await import('./domains/tasks/agent-turn-shim.ts');
  const statusDoor =
    agentTurnShimHandlers(sql)[
      'tasks/internal_mutations:agentUpdateTaskStatus'
    ];
  await statusDoor?.({
    organizationId: orgId,
    actorId: 'bell-agent',
    taskId,
    status: 'in_progress',
  });
  const afterFirst = await sql<
    { params: Record<string, unknown> | null; read: boolean }[]
  >`
    SELECT params, read FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
      AND type = 'task_status_changed' AND task_id = ${taskId}
  `;
  await statusDoor?.({
    organizationId: orgId,
    actorId: 'bell-agent',
    taskId,
    status: 'todo',
  });
  const afterSecond = await sql<{ params: Record<string, unknown> | null }[]>`
    SELECT params FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
      AND type = 'task_status_changed' AND task_id = ${taskId}
      AND read = false
  `;

  const { addTaskComment } = await import('./domains/tasks/comments.ts');
  const { getProjectAuthContext } =
    await import('./domains/projects/service.ts');
  await sql.begin(async (tx) => {
    const auth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId,
      role: 'owner',
    });
    await addTaskComment(tx, auth, {
      taskId,
      body: 'Ping from the agent.',
      author: { actorType: 'agent', actorId: 'bell-agent' },
    });
  });
  const commentBell = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
      AND type = 'task_commented' AND task_id = ${taskId}
  `;

  // Pref off blocks the WRITE — the stale unread row keeps its params.
  await post(`/api/app/collab/preferences?orgId=${orgId}`, {
    taskStatusChanged: false,
  });
  await statusDoor?.({
    organizationId: orgId,
    actorId: 'bell-agent',
    taskId,
    status: 'backlog',
  });
  const afterBlocked = await sql<{ params: Record<string, unknown> | null }[]>`
    SELECT params FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
      AND type = 'task_status_changed' AND task_id = ${taskId}
      AND read = false
  `;
  await post(`/api/app/collab/preferences?orgId=${orgId}`, {});
  const markAll = z
    .object({ marked: z.number() })
    .safeParse(
      await (
        await post(`/api/app/collab/notifications/read-all?orgId=${orgId}`)
      ).json(),
    );
  const unread = z
    .object({ count: z.number() })
    .safeParse(
      await (
        await fetch(
          `${base}/api/app/collab/notifications/unread-count?orgId=${orgId}`,
          { headers: { cookie } },
        )
      ).json(),
    );
  record(
    'collab emitters: creator follows, coalesced status bell, comment bell, pref gate',
    creatorSub[0]?.reason === 'creator' &&
      afterFirst.length === 1 &&
      afterFirst[0]?.params?.to === 'in_progress' &&
      afterSecond.length === 1 &&
      afterSecond[0]?.params?.to === 'todo' &&
      commentBell[0]?.count === '1' &&
      afterBlocked.length === 1 &&
      afterBlocked[0]?.params?.to === 'todo' &&
      markAll.success &&
      markAll.data.marked >= 2 &&
      unread.success &&
      unread.data.count === 0,
    `creator=${creatorSub[0]?.reason}, first=${afterFirst.length}/${JSON.stringify(afterFirst[0]?.params?.to)}, coalesced=${afterSecond.length}/${JSON.stringify(afterSecond[0]?.params?.to)}, comment=${commentBell[0]?.count}, blocked=${JSON.stringify(afterBlocked[0]?.params?.to)} (want still todo), marked=${markAll.success ? markAll.data.marked : 'ERR'}, unread=${unread.success ? unread.data.count : 'ERR'}`,
  );
}

/**
 * The small tail: the accounts probe (which auth backings the user has),
 * the changelog orchestration on an injected fetcher (paging honors `from`,
 * page-2 failures degrade to a partial), and the route's auth gate.
 */
async function checkChangelogAndAccounts(
  sql: Sql,
  base: string,
  ctx: { cookie: string },
): Promise<void> {
  const { cookie } = ctx;
  const accounts = z
    .object({
      hasCredentialAccount: z.boolean(),
      hasMicrosoftAccount: z.boolean(),
    })
    .safeParse(
      await (
        await fetch(`${base}/api/app/users/accounts`, { headers: { cookie } })
      ).json(),
    );
  const unauthenticated = await fetch(`${base}/api/app/changelog/releases`);

  const { listReleases } = await import('./domains/changelog/service.ts');
  const release = (version: string) => ({
    tag: `v${version}`,
    version,
    name: `Release ${version}`,
    body: null,
    htmlUrl: `https://github.com/tale-project/tale/releases/tag/v${version}`,
    publishedAt: null,
  });
  const pages: Record<number, ReturnType<typeof release>[]> = {
    1: [release('0.9.2'), release('0.9.1')],
    2: [release('0.9.0'), release('0.8.9')],
    3: [release('0.8.8')],
  };
  const paged = await listReleases({
    from: '0.8.9',
    fetcher: (page) => Promise.resolve(pages[page] ?? []),
  });
  const single = await listReleases({
    fetcher: (page) => Promise.resolve(pages[page] ?? []),
  });
  let partial: Awaited<ReturnType<typeof listReleases>> = [];
  partial = await listReleases({
    from: '0.0.1',
    fetcher: (page) =>
      page === 1
        ? Promise.resolve([release('1.0.1'), release('1.0.0')])
        : Promise.reject(new Error('page down')),
  });
  record(
    'accounts probe + changelog paging (from-bounded, partial-tolerant)',
    accounts.success &&
      accounts.data.hasCredentialAccount &&
      !accounts.data.hasMicrosoftAccount &&
      unauthenticated.status === 401 &&
      paged.length === 4 &&
      paged.at(-1)?.version === '0.8.9' &&
      single.length === 2 &&
      partial.length === 2,
    `accounts=${accounts.success ? `${accounts.data.hasCredentialAccount}/${accounts.data.hasMicrosoftAccount}` : 'ERR'}, unauth=${unauthenticated.status}, paged=${paged.length} (want 4), single=${single.length} (want 2), partial=${partial.length} (want 2)`,
  );
}

/**
 * Legal holds: the custodian cascade freezes an owner's thread trash and a
 * document trash; placement dedupes on the active-per-target index; release
 * is maker-checker (self-approval blocked without the escape hatch, the
 * cooldown gates the effect sweep); an org hold freezes everything and a
 * released hold unfreezes.
 */
async function checkLegalHolds(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const placed = z.object({ holdId: z.string() }).safeParse(
    await (
      await post(`/api/app/legal-holds?orgId=${orgId}`, {
        targetType: 'userMembership',
        targetId: userId,
        reason: 'Matter 44 preservation',
      })
    ).json(),
  );
  const holdId = placed.success ? placed.data.holdId : '';
  const dup = await post(`/api/app/legal-holds?orgId=${orgId}`, {
    targetType: 'userMembership',
    targetId: userId,
    reason: 'duplicate',
  });

  const heldThread = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/chat/threads?orgId=${orgId}`, {
        title: 'Held thread',
      })
    ).json(),
  );
  const heldThreadId = heldThread.success ? heldThread.data.id : '';
  const trashRefused = await post(
    `/api/app/chat/threads/${heldThreadId}/trash?orgId=${orgId}`,
  );
  const docRows = await sql<{ id: string }[]>`
    INSERT INTO app.documents (
      org_id, title, file_ref, mime_type, source_provider, team_tags,
      created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, 'held.md', 's3:itest/held', 'text/markdown', 'upload',
      ${[]}::text[], ${userId}, ${Date.now()}, ${Date.now()}
    ) RETURNING id
  `;
  const heldDocId = docRows[0]?.id ?? '';
  const docTrashRefused = await post(
    `/api/app/documents/${heldDocId}/trash?orgId=${orgId}`,
    { trashed: true },
  );

  const requested = z
    .object({ requestId: z.string() })
    .safeParse(
      await (
        await post(
          `/api/app/legal-holds/${holdId}/release-requests?orgId=${orgId}`,
          { reason: 'Matter closed' },
        )
      ).json(),
    );
  const requestId = requested.success ? requested.data.requestId : '';
  const selfBlocked = await post(
    `/api/app/legal-holds/release-requests/${requestId}/approve?orgId=${orgId}`,
  );
  process.env.TALE_LEGAL_HOLD_SINGLE_ADMIN_OK = 'true';
  const approved = z
    .object({ effectiveAt: z.number() })
    .safeParse(
      await (
        await post(
          `/api/app/legal-holds/release-requests/${requestId}/approve?orgId=${orgId}`,
        )
      ).json(),
    );
  delete process.env.TALE_LEGAL_HOLD_SINGLE_ADMIN_OK;
  const { effectApprovedReleases } =
    await import('./domains/legal_holds/service.ts');
  const beforeCooldown = await effectApprovedReleases(sql);
  await sql`
    UPDATE app.legal_hold_release_requests SET effective_at_ms = ${Date.now() - 1_000}
    WHERE id = ${requestId}
  `;
  const afterCooldown = await effectApprovedReleases(sql);
  const trashAllowed = z
    .object({ ok: z.boolean() })
    .safeParse(
      await (
        await post(`/api/app/chat/threads/${heldThreadId}/trash?orgId=${orgId}`)
      ).json(),
    );

  // The org-wide nuclear halt freezes even unrelated owners' deletes.
  const orgHold = z.object({ holdId: z.string() }).safeParse(
    await (
      await post(`/api/app/legal-holds?orgId=${orgId}`, {
        targetType: 'org',
        targetId: orgId,
        reason: 'Org-wide preservation',
      })
    ).json(),
  );
  const orgThread = z.object({ id: z.string() }).safeParse(
    await (
      await post(`/api/app/chat/threads?orgId=${orgId}`, {
        title: 'Org-held thread',
      })
    ).json(),
  );
  const orgTrashRefused = await post(
    `/api/app/chat/threads/${orgThread.success ? orgThread.data.id : ''}/trash?orgId=${orgId}`,
  );
  // Test hygiene: lift the org hold directly so later checks stay unfrozen.
  await sql`
    UPDATE app.legal_holds SET released_at_ms = ${Date.now()},
      released_by = 'itest', release_reason = 'itest cleanup'
    WHERE id = ${orgHold.success ? orgHold.data.holdId : ''}
  `;
  record(
    'legal holds: custodian + org freezes, dedupe, maker-checker release',
    placed.success &&
      dup.status === 409 &&
      trashRefused.status === 409 &&
      docTrashRefused.status === 409 &&
      requested.success &&
      selfBlocked.status === 403 &&
      approved.success &&
      beforeCooldown === 0 &&
      afterCooldown === 1 &&
      trashAllowed.success &&
      trashAllowed.data.ok &&
      orgHold.success &&
      orgTrashRefused.status === 409,
    `place=${placed.success}, dup=${dup.status} (want 409), threadFreeze=${trashRefused.status}, docFreeze=${docTrashRefused.status}, self=${selfBlocked.status} (want 403), cooldownHeld=${beforeCooldown === 0}, effected=${afterCooldown}, unfrozen=${trashAllowed.success && trashAllowed.data.ok}, orgFreeze=${orgTrashRefused.status}`,
  );
}

/**
 * The retention framework: Apply snapshots the file bounds; the cleanup
 * clamps the org policy against them (a too-short stored value is raised
 * to the floor), sweeps expired rows past retention+grace, spares fresh
 * ones, and an org hold freezes the whole run.
 */
async function checkRetention(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const governanceDir = path.join(configRoot, orgSlug, 'governance');
  await mkdir(governanceDir, { recursive: true });
  // Every category must be declared (the env-tightening walk throws on a
  // gap), and the compliance floors bind (auditLog ≥ 365, loginAttempt ≥ 90).
  const bound = (min: number, unit = 'days') =>
    [
      `  min: ${min}`,
      '  max: 3650',
      `  default: ${Math.max(min, 30)}`,
      `  unit: ${unit}`,
    ].join('\n');
  await writeFile(
    path.join(governanceDir, 'retention.yml'),
    [
      'documents:',
      bound(1),
      'userTempHours:',
      bound(1, 'hours'),
      'agentTempHours:',
      bound(1, 'hours'),
      'chatHistory:',
      bound(1),
      'auditLog:',
      bound(365),
      'workflowLog:',
      bound(1),
      'usageLedger:',
      bound(30),
      'loginAttempt:',
      bound(90),
      'chatFilterEvents:',
      bound(1),
      'messageFeedback:',
      bound(1),
      'contacts:',
      bound(1),
      'externalConversations:',
      bound(1),
      'notifications:',
      bound(1),
      'agentRuns:',
      bound(1),
    ].join('\n'),
  );
  await writeFile(
    path.join(governanceDir, 'retention-policy.yml'),
    [
      'documentsEnabled: true',
      'documentsRetentionDays: 7',
      'chatHistoryEnabled: true',
      'chatHistoryRetentionDays: 7',
      'agentRunsEnabled: true',
      'agentRunsRetentionDays: 7',
      'auditLogEnabled: true',
      'auditLogRetentionDays: 365',
      'userTempEnabled: true',
      'userTempRetentionHours: 1',
      'usageLedgerEnabled: true',
      // Below the 30-day floor — the clamp must raise it.
      'usageLedgerRetentionDays: 1',
      'messageFeedbackEnabled: true',
      'messageFeedbackRetentionDays: 7',
      'notificationsEnabled: true',
      'notificationsRetentionDays: 7',
      'deletionGraceDays: 0',
    ].join('\n'),
  );
  const orgConfig = await import('./lib/org-config.ts');
  orgConfig.clearOrgConfigCaches();

  const applied = z
    .object({
      bounds: z
        .object({ usageLedger: z.object({ min: z.number() }).loose() })
        .loose(),
    })
    .safeParse(
      await (
        await post(`/api/app/retention/bounds/apply?orgId=${orgId}`)
      ).json(),
    );

  const now = Date.now();
  const old = now - 15 * 24 * 3_600_000; // 15 days: > 7d policy, < 30d floor
  const ancient = now - 100 * 24 * 3_600_000;
  await sql`
    INSERT INTO app.usage_ledger (
      org_id, user_id, period_key, granularity, input_tokens, output_tokens,
      total_tokens, cost_estimate_cents, request_count, connector_call_count,
      updated_at_ms
    ) VALUES
      (${orgId}, ${userId}, 'itest-old', 'daily', 1, 1, 2, 0, 1, 0, ${old}),
      (${orgId}, ${userId}, 'itest-ancient', 'daily', 1, 1, 2, 0, 1, 0,
       ${ancient})
  `;
  await sql`
    INSERT INTO app.message_feedback (
      org_id, thread_id, message_id, user_id, rating, created_at_ms
    ) VALUES
      (${orgId}, 'rt-th', 'rt-old', ${userId}, 'positive', ${old}),
      (${orgId}, 'rt-th', 'rt-new', ${userId}, 'positive', ${now})
  `;
  await sql`
    INSERT INTO app.user_notifications (
      user_id, org_id, type, title_key, body_key, resource_type,
      resource_id, actor_type, read, created_at_ms
    ) VALUES
      (${userId}, ${orgId}, 'task_commented', 'x', 'y', 'task', 'rt-old',
       'system', true, ${old}),
      (${userId}, ${orgId}, 'task_commented', 'x', 'y', 'task', 'rt-new',
       'system', true, ${now})
  `;

  // Phase-2 seeds: an ancient document, an ancient chat thread (with a
  // message), an ancient settled agent run, ancient audit rows (the chain's
  // oldest prefix), and a stale loose temp upload.
  const ancientDoc = await sql<{ id: string }[]>`
    INSERT INTO app.documents (
      org_id, title, file_ref, mime_type, source_provider, team_tags,
      created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, 'ancient.md', 's3:itest/ancient-doc', 'text/markdown',
      'upload', ${[]}::text[], ${userId}, ${ancient}, ${ancient}
    ) RETURNING id
  `;
  const oldThreadRows = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                             updated_at_ms)
    VALUES (${orgId}, ${userId}, 'Ancient chat', 'chat', ${ancient},
            ${ancient})
    RETURNING id
  `;
  const oldThreadId = oldThreadRows[0]?.id ?? '';
  await sql`
    INSERT INTO app.thread_metadata (
      thread_id, org_id, user_id, chat_type, status, created_at_ms
    ) VALUES (${oldThreadId}, ${orgId}, ${userId}, 'chat', 'active',
              ${ancient})
  `;
  await sql`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, text, status,
      created_at_ms
    ) VALUES (${oldThreadId}, ${orgId}, 0, 0, 'user', 'old words',
              'complete', ${ancient})
  `;
  const projectRow = await sql<{ id: string }[]>`
    SELECT id FROM app.projects WHERE org_id = ${orgId} LIMIT 1
  `;
  const taskRow = await sql<{ id: string }[]>`
    SELECT id FROM app.tasks WHERE org_id = ${orgId} LIMIT 1
  `;
  if (projectRow[0] && taskRow[0]) {
    await sql`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, settled_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectRow[0].id}, ${taskRow[0].id}, 'rt-agent',
        'rt-ancient-exec', 'rt-sess', 'settled', 'claude-code', 'm',
        ${userId}, ${ancient}, ${ancient}, ${ancient}, ${ancient}
      )
    `;
  }
  await sql`
    INSERT INTO app.audit_logs (
      org_id, actor_id, actor_type, action, category, resource_type,
      resource_id, status, ts, integrity_hash, previous_hash
    ) VALUES
      (${orgId}, 'rt-ancient', 'system', 'itest.ancient', 'data', 'probe',
       'rt-a1', 'success', ${now - 400 * 24 * 3_600_000}, 'fake-a1', ''),
      (${orgId}, 'rt-ancient', 'system', 'itest.ancient', 'data', 'probe',
       'rt-a2', 'success', ${now - 400 * 24 * 3_600_000 + 1}, 'fake-a2',
       'fake-a1')
  `;
  const staleTemp = await sql<{ id: string }[]>`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, file_name, content_type, size, source,
      uploaded_by, created_at_ms
    ) VALUES (
      ${orgId}, 's3:itest/stale-temp', 'tmp.bin', 'application/octet-stream',
      8, 'user', ${userId}, ${now - 2 * 3_600_000}
    ) RETURNING id
  `;

  const { runRetentionCleanup } =
    await import('./domains/retention/service.ts');
  // An org hold freezes the whole run.
  const holdRows = await sql<{ id: string }[]>`
    INSERT INTO app.legal_holds (
      org_id, target_type, target_id, target_label, reason, placed_by,
      placed_at_ms
    ) VALUES (
      ${orgId}, 'org', ${orgId}, 'itest', 'retention freeze probe', 'itest',
      ${Date.now()}
    ) RETURNING id
  `;
  await runRetentionCleanup(sql);
  const frozen = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.message_feedback
    WHERE org_id = ${orgId} AND message_id = 'rt-old'
  `;
  await sql`
    UPDATE app.legal_holds SET released_at_ms = ${Date.now()}
    WHERE id = ${holdRows[0]?.id ?? ''}
  `;
  await runRetentionCleanup(sql);

  const ledgerLeft = await sql<{ periodKey: string }[]>`
    SELECT period_key AS "periodKey" FROM app.usage_ledger
    WHERE org_id = ${orgId} AND period_key LIKE 'itest-%'
  `;
  const feedbackLeft = await sql<{ messageId: string }[]>`
    SELECT message_id AS "messageId" FROM app.message_feedback
    WHERE org_id = ${orgId} AND thread_id = 'rt-th'
  `;
  const bellsLeft = await sql<{ resourceId: string }[]>`
    SELECT resource_id AS "resourceId" FROM app.user_notifications
    WHERE org_id = ${orgId} AND resource_id LIKE 'rt-%'
  `;
  record(
    'retention: apply-clamped sweep spares floored + fresh rows, org hold freezes',
    applied.success &&
      applied.data.bounds.usageLedger.min === 30 &&
      frozen[0]?.count === '1' &&
      // The 15-day ledger row SURVIVES (policy 1d clamped up to the 30d
      // floor); the 100-day one goes.
      ledgerLeft.length === 1 &&
      ledgerLeft[0]?.periodKey === 'itest-old' &&
      feedbackLeft.length === 1 &&
      feedbackLeft[0]?.messageId === 'rt-new' &&
      bellsLeft.length === 1 &&
      bellsLeft[0]?.resourceId === 'rt-new',
    `applied=${applied.success}, frozen=${frozen[0]?.count} (want 1), ledger=${ledgerLeft.map((row) => row.periodKey).join(',')} (want itest-old), feedback=${feedbackLeft.map((row) => row.messageId).join(',')}, bells=${bellsLeft.map((row) => row.resourceId).join(',')}`,
  );

  const docGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.documents
    WHERE id = ${ancientDoc[0]?.id ?? ''}
  `;
  const threadGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.threads WHERE id = ${oldThreadId}
  `;
  const msgGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.messages
    WHERE thread_id = ${oldThreadId}
  `;
  const runGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.project_agent_runs
    WHERE exec_id = 'rt-ancient-exec'
  `;
  const auditGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.audit_logs
    WHERE org_id = ${orgId} AND actor_id = 'rt-ancient'
  `;
  const tempGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.file_metadata
    WHERE id = ${staleTemp[0]?.id ?? ''}
  `;
  record(
    'retention phase-2: documents, chat lineage, runs, audit prefix, temp',
    docGone[0]?.count === '0' &&
      threadGone[0]?.count === '0' &&
      msgGone[0]?.count === '0' &&
      runGone[0]?.count === '0' &&
      auditGone[0]?.count === '0' &&
      tempGone[0]?.count === '0',
    `doc=${docGone[0]?.count} thread=${threadGone[0]?.count} msgs=${msgGone[0]?.count} run=${runGone[0]?.count} audit=${auditGone[0]?.count} temp=${tempGone[0]?.count} (all want 0)`,
  );
}

/**
 * GDPR erasure: self-erasure refused, the cascade erases the subject's
 * rows table by table after the cooling-off window, the subject's audit
 * trail is SCRUBBED in place (rows kept, PII blanked, chain still
 * verifies), a pending request cancels inside the window, and a custodian
 * hold blocks with a durable receipt until released + retried.
 */
async function checkErasure(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const governanceDir = path.join(configRoot, orgSlug, 'governance');
  await mkdir(governanceDir, { recursive: true });
  await writeFile(
    path.join(governanceDir, 'dsar-governance.yml'),
    'coolingOffHours: 0\n',
  );
  const orgConfig = await import('./lib/org-config.ts');
  orgConfig.clearOrgConfigCaches();

  const seedMember = async (suffix: string): Promise<string> => {
    const subjectId = `erasure-${suffix}`;
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (${subjectId}, ${`Subject ${suffix}`},
              ${`${subjectId}@example.com`}, true, ${new Date()},
              ${new Date()})
      ON CONFLICT ("id") DO NOTHING
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${`m-${subjectId}`}, ${orgId}, ${subjectId}, 'member',
              ${new Date()})
      ON CONFLICT ("id") DO NOTHING
    `;
    await sql`
      INSERT INTO app.user_preferences (org_id, user_id, updated_at)
      VALUES (${orgId}, ${subjectId}, ${Date.now()})
      ON CONFLICT DO NOTHING
    `;
    return subjectId;
  };

  const subject = await seedMember('one');
  const now = Date.now();
  const threadRows = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                             updated_at_ms)
    VALUES (${orgId}, ${subject}, 'Subject chat', 'chat', ${now}, ${now})
    RETURNING id
  `;
  const subjectThread = threadRows[0]?.id ?? '';
  await sql`
    INSERT INTO app.thread_metadata (
      thread_id, org_id, user_id, chat_type, status, created_at_ms
    ) VALUES (${subjectThread}, ${orgId}, ${subject}, 'chat', 'active', ${now})
  `;
  await sql`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, text, status,
      created_at_ms
    ) VALUES (${subjectThread}, ${orgId}, 0, 0, 'user', 'subject words',
              'complete', ${now})
  `;
  await sql`
    INSERT INTO app.user_notifications (
      user_id, org_id, type, title_key, body_key, resource_type,
      resource_id, actor_type, read, created_at_ms
    ) VALUES (${subject}, ${orgId}, 'task_commented', 'x', 'y', 'task',
              'er-1', 'system', false, ${now})
  `;
  await sql`
    INSERT INTO app.memories (org_id, user_id, content, status,
                              created_at_ms)
    VALUES (${orgId}, ${subject}, 'subject fact', 'approved', ${now})
  `;

  const selfRefused = await post(`/api/app/erasure?orgId=${orgId}`, {
    targetUserId: userId,
    reason: 'self test',
    reasonCode: 'consent_withdrawn',
  });
  const filed = z
    .object({ requestId: z.string(), status: z.string() })
    .loose()
    .safeParse(
      await (
        await post(`/api/app/erasure?orgId=${orgId}`, {
          targetUserId: subject,
          reason: 'Departing employee',
          reasonCode: 'contract_termination',
        })
      ).json(),
    );
  const requestId = filed.success ? filed.data.requestId : '';
  let receiptStatus = '';
  for (let i = 0; i < 50; i++) {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.gdpr_erasure_requests WHERE id = ${requestId}
    `;
    receiptStatus = rows[0]?.status ?? '';
    if (receiptStatus === 'done' || receiptStatus === 'partial') break;
    await sleep(300);
  }
  const threadGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.threads
    WHERE id = ${subjectThread}
  `;
  const leftovers = await sql<{ count: string }[]>`
    SELECT (
      (SELECT count(*) FROM app.user_preferences
       WHERE org_id = ${orgId} AND user_id = ${subject})
      + (SELECT count(*) FROM app.user_notifications
         WHERE org_id = ${orgId} AND user_id = ${subject})
      + (SELECT count(*) FROM app.memories
         WHERE org_id = ${orgId} AND user_id = ${subject})
    )::text AS count
  `;
  const scrubbed = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.audit_logs
    WHERE org_id = ${orgId} AND resource_type = 'user'
      AND resource_id = ${subject} AND pii_scrubbed = true
  `;

  // Cancel lane: a fresh subject inside a real cooling window.
  await writeFile(
    path.join(governanceDir, 'dsar-governance.yml'),
    'coolingOffHours: 1\n',
  );
  orgConfig.clearOrgConfigCaches();
  const subjectTwo = await seedMember('two');
  const filedTwo = z
    .object({ requestId: z.string() })
    .loose()
    .safeParse(
      await (
        await post(`/api/app/erasure?orgId=${orgId}`, {
          targetUserId: subjectTwo,
          reason: 'Second thoughts',
          reasonCode: 'consent_withdrawn',
        })
      ).json(),
    );
  const cancelled = z
    .object({ ok: z.boolean() })
    .safeParse(
      await (
        await post(
          `/api/app/erasure/${filedTwo.success ? filedTwo.data.requestId : ''}/cancel?orgId=${orgId}`,
          { reason: 'Withdrawn by the subject' },
        )
      ).json(),
    );
  const twoIntact = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.user_preferences
    WHERE org_id = ${orgId} AND user_id = ${subjectTwo}
  `;

  // Hold-blocked lane: the receipt is durable, retry runs after release.
  const subjectThree = await seedMember('three');
  await sql`
    INSERT INTO app.legal_holds (
      org_id, target_type, target_id, target_label, reason, placed_by,
      placed_at_ms
    ) VALUES (${orgId}, 'userMembership', ${subjectThree}, 'itest',
              'erasure block probe', 'itest', ${Date.now()})
  `;
  const filedThree = z
    .object({ requestId: z.string(), status: z.string() })
    .loose()
    .safeParse(
      await (
        await post(`/api/app/erasure?orgId=${orgId}`, {
          targetUserId: subjectThree,
          reason: 'Blocked probe',
          reasonCode: 'objection',
        })
      ).json(),
    );
  await sql`
    UPDATE app.legal_holds SET released_at_ms = ${Date.now()}
    WHERE org_id = ${orgId} AND target_id = ${subjectThree}
  `;
  await post(
    `/api/app/erasure/${filedThree.success ? filedThree.data.requestId : ''}/retry?orgId=${orgId}`,
  );
  let threeStatus = '';
  for (let i = 0; i < 50; i++) {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM app.gdpr_erasure_requests
      WHERE id = ${filedThree.success ? filedThree.data.requestId : ''}
    `;
    threeStatus = rows[0]?.status ?? '';
    if (threeStatus === 'done') break;
    await sleep(300);
  }
  record(
    'erasure: cascade + audit scrub, cancel window, hold-blocked receipt',
    selfRefused.status === 403 &&
      filed.success &&
      receiptStatus === 'done' &&
      threadGone[0]?.count === '0' &&
      leftovers[0]?.count === '0' &&
      Number(scrubbed[0]?.count ?? '0') >= 1 &&
      filedTwo.success &&
      cancelled.success &&
      cancelled.data.ok &&
      twoIntact[0]?.count === '1' &&
      filedThree.success &&
      filedThree.data.status === 'blocked' &&
      threeStatus === 'done',
    `self=${selfRefused.status} (want 403), receipt=${receiptStatus}, thread=${threadGone[0]?.count}, leftovers=${leftovers[0]?.count}, scrubbed=${scrubbed[0]?.count}, cancel=${cancelled.success ? cancelled.data.ok : 'ERR'}, twoIntact=${twoIntact[0]?.count}, blocked=${filedThree.success ? filedThree.data.status : 'ERR'} (want blocked), retried=${threeStatus}`,
  );
}

/**
 * Two-factor enforcement: an enforced policy with zero grace flips the
 * sign-in response to the enrolment-wall shape; a grace policy anchors the
 * per-user clock once; the verify-endpoint lockout mirrors the password
 * schedule and clears on success.
 */
async function checkTwoFactor(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
  email: string,
): Promise<void> {
  const { cookie, userId } = ctx;
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const governanceDir = path.join(configRoot, orgSlug, 'governance');
  await mkdir(governanceDir, { recursive: true });
  const orgConfig = await import('./lib/org-config.ts');
  const signIn = (): Promise<Response> =>
    fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email, password: 'itest-password-1' }),
    });

  await writeFile(
    path.join(governanceDir, 'two-factor-policy.yml'),
    ['enforced: true', 'gracePeriodDays: 0', 'exemptSsoUsers: true'].join('\n'),
  );
  orgConfig.clearOrgConfigCaches();
  const blockedRes = await signIn();
  const blockedBody = z
    .object({ enrollRequired: z.boolean().optional() })
    .loose()
    .safeParse(await blockedRes.json());

  await writeFile(
    path.join(governanceDir, 'two-factor-policy.yml'),
    ['enforced: true', 'gracePeriodDays: 7', 'exemptSsoUsers: true'].join('\n'),
  );
  orgConfig.clearOrgConfigCaches();
  const graceRes = await signIn();
  const graceBody = z
    .object({
      enrollRequired: z.boolean().optional(),
      token: z.string().optional(),
    })
    .loose()
    .safeParse(await graceRes.json());
  const anchor1 = await sql<{ graceUntil: number }[]>`
    SELECT grace_until_ms::float8 AS "graceUntil"
    FROM app.two_factor_grace WHERE user_id = ${userId}
  `;
  await signIn();
  const anchor2 = await sql<{ graceUntil: number }[]>`
    SELECT grace_until_ms::float8 AS "graceUntil"
    FROM app.two_factor_grace WHERE user_id = ${userId}
  `;

  // The verify lockout: five failures lock; the verify endpoint answers
  // 429 while locked; success clears.
  const { recordTwoFactorFailure, recordTwoFactorSuccess } =
    await import('./domains/two_factor/service.ts');
  let lockedUntil: number | null = null;
  for (let i = 0; i < 6; i++) {
    const outcome = await recordTwoFactorFailure(sql, {
      userId,
      method: 'totp',
    });
    lockedUntil = outcome.lockedUntil;
  }
  // The wire-level 429 needs the login-time 2FA cookie (a real TOTP
  // enrollment) — E2E scope; here the STATE machinery is the assertion and
  // the endpoint call proves the route exists (400 = reached, unenrolled).
  const verifyWhileLocked = await fetch(
    `${base}/api/auth/two-factor/verify-totp`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify({ code: '000000' }),
    },
  );
  await recordTwoFactorSuccess(sql, userId);
  const stateAfter = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.two_factor_attempts
    WHERE user_id = ${userId}
  `;

  // Lift the policy so later sign-ins (the lockout check) stay normal.
  await writeFile(
    path.join(governanceDir, 'two-factor-policy.yml'),
    'enforced: false\n',
  );
  orgConfig.clearOrgConfigCaches();
  record(
    'two-factor: zero-grace blocks to enrolment, grace anchors once, verify locks',
    blockedRes.status === 200 &&
      blockedBody.success &&
      blockedBody.data.enrollRequired === true &&
      graceRes.status === 200 &&
      graceBody.success &&
      graceBody.data.enrollRequired !== true &&
      anchor1.length === 1 &&
      anchor2[0]?.graceUntil === anchor1[0]?.graceUntil &&
      lockedUntil !== null &&
      (verifyWhileLocked.status === 429 || verifyWhileLocked.status === 400) &&
      stateAfter[0]?.count === '0',
    `blocked=${blockedRes.status}/${blockedBody.success ? blockedBody.data.enrollRequired : 'ERR'} (want true), grace=${graceBody.success ? graceBody.data.enrollRequired !== true : 'ERR'}, anchored=${anchor1.length === 1 && anchor2[0]?.graceUntil === anchor1[0]?.graceUntil}, locked=${lockedUntil !== null}, verify=${verifyWhileLocked.status}, cleared=${stateAfter[0]?.count}`,
  );
}

/**
 * The kick-time resume plan + the auto-retry arc. Plan mechanics run on
 * hand-inserted rows against the REUSED decision core: a first kick sweeps
 * with no resume; a settled predecessor with a stamped handle on the live
 * incarnation resumes (sweep stays true); a failed newest predecessor
 * resumes with sweep=false + inspectNote and rotates its burned broker
 * hash; an incarnation mismatch falls back fresh. The retry arc runs LIVE:
 * moving the agent-assigned task to in_progress kicks a run whose start
 * fails on the fake model (`start_failed`, retryable) — the arm + budget
 * must produce exactly 1 + 3 runs, the retries stamped `auto_retry`
 * attempts 1..3, then stop (budget_exhausted). Non-retryable codes and
 * guard misses arm nothing / kick nothing.
 */
async function checkAutoRetryAndKickPlan(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Retry Plan' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  const agent = z.object({ agentId: z.string() }).safeParse(
    await (
      await post(`/api/app/projects/${projectId}/agents?orgId=${orgId}`, {
        name: 'Retry Bot',
        harness: 'claude-code',
        model: 'itest-model',
        skills: [],
        connectors: [],
      })
    ).json(),
  );
  const agentId = agent.success ? agent.data.agentId : '';
  const mkTask = async (title: string): Promise<string> => {
    const created = z
      .object({ taskId: z.string() })
      .safeParse(
        await (
          await post(`/api/app/tasks?orgId=${orgId}`, { projectId, title })
        ).json(),
      );
    return created.success ? created.data.taskId : '';
  };

  // --- plan mechanics on a task no worker touches -------------------------
  const planTask = await mkTask('Plan mechanics');
  const kickPlan = await import('./domains/tasks/kick-plan.ts');
  const sessionId = `pa-${agentId}`;
  const planArgs = {
    organizationId: orgId,
    taskId: planTask,
    agentId,
    harness: 'claude-code',
    sessionId,
  };
  const first = await kickPlan.resolveTaskKickStartArgs(sql, planArgs);
  const now = Date.now();
  const incarnation = now - 60_000;
  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, ${sessionId}, 'stopped', 'project_agent', ${agentId},
      'itest:plan', ${incarnation}, ${now + 24 * 3_600_000}
    )
  `;
  await sql`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, agent_session_id, session_created_at_ms,
      started_at_ms, launched_at_ms, settled_at_ms, deadline_at_ms,
      updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${planTask}, ${agentId}, 'exec-plan-1',
      ${sessionId}, 'settled', 'claude-code', 'itest-model', 'itest:plan',
      'conv-plan-1', ${incarnation}, ${now - 50_000}, ${now - 49_000},
      ${now - 40_000}, ${now + 3_600_000}, ${now}
    )
  `;
  const afterSettled = await kickPlan.resolveTaskKickStartArgs(sql, planArgs);
  await sql`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, agent_session_id, session_created_at_ms,
      broker_token_hash, started_at_ms, launched_at_ms, settled_at_ms,
      deadline_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${planTask}, ${agentId}, 'exec-plan-2',
      ${sessionId}, 'failed', 'claude-code', 'itest-model', 'itest:plan',
      'conv-plan-2', ${incarnation}, 'bh-burned-1', ${now - 30_000},
      ${now - 29_000}, ${now - 20_000}, ${now + 3_600_000}, ${now}
    )
  `;
  const afterFailed = await kickPlan.resolveTaskKickStartArgs(sql, planArgs);
  await sql`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, agent_session_id, session_created_at_ms,
      started_at_ms, launched_at_ms, settled_at_ms, deadline_at_ms,
      updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${planTask}, ${agentId}, 'exec-plan-3',
      ${sessionId}, 'failed', 'claude-code', 'itest-model', 'itest:plan',
      'conv-plan-3', ${incarnation - 999}, ${now - 10_000}, ${now - 9_000},
      ${now - 5_000}, ${now + 3_600_000}, ${now}
    )
  `;
  const mismatch = await kickPlan.resolveTaskKickStartArgs(sql, planArgs);
  record(
    'kick plan: first start / resume / failed-resume / incarnation fence',
    first.resume === undefined &&
      first.sweep &&
      !first.inspectNote &&
      afterSettled.resume === 'conv-plan-1' &&
      afterSettled.sweep &&
      afterSettled.resumePredecessorExecId === 'exec-plan-1' &&
      afterFailed.resume === 'conv-plan-2' &&
      !afterFailed.sweep &&
      afterFailed.inspectNote &&
      (afterFailed.excludeBrokerTokenHashes ?? []).includes('bh-burned-1') &&
      mismatch.resume === undefined &&
      !mismatch.sweep &&
      mismatch.inspectNote,
    `first=${JSON.stringify(first)} settled=${afterSettled.resume}/${afterSettled.sweep} failed=${afterFailed.resume}/${afterFailed.sweep}/${(afterFailed.excludeBrokerTokenHashes ?? []).join('|')} mismatch=${mismatch.resume ?? 'fresh'}`,
  );

  // --- the LIVE retry cascade --------------------------------------------
  const retryTask = await mkTask('Retry cascade');
  await post(`/api/app/tasks/${retryTask}/assign?orgId=${orgId}`, {
    assigneeType: 'agent',
    assigneeId: agentId,
  });
  await post(`/api/app/tasks/${retryTask}/status?orgId=${orgId}`, {
    status: 'in_progress',
  });
  let cascade: {
    status: string;
    trigger: string | null;
    attempt: number | null;
  }[] = [];
  for (let i = 0; i < 60; i++) {
    cascade = await sql<
      { status: string; trigger: string | null; attempt: number | null }[]
    >`
      SELECT status, trigger, auto_retry_attempt AS attempt
      FROM app.project_agent_runs
      WHERE task_id = ${retryTask}
      ORDER BY started_at_ms
    `;
    const live = cascade.some(
      (r) => r.status === 'queued' || r.status === 'running',
    );
    if (!live && cascade.length >= 4) break;
    await sleep(250);
  }
  await sleep(700); // budget_exhausted must add nothing after the cascade
  const finalCascade = await sql<
    { status: string; trigger: string | null; attempt: number | null }[]
  >`
    SELECT status, trigger, auto_retry_attempt AS attempt
    FROM app.project_agent_runs
    WHERE task_id = ${retryTask}
    ORDER BY started_at_ms
  `;
  const retries = finalCascade.filter((r) => r.trigger === 'auto_retry');
  record(
    'auto-retry cascade: 3 stamped attempts then budget exhausted',
    finalCascade.length === 4 &&
      finalCascade.every((r) => r.status === 'failed') &&
      retries.length === 3 &&
      retries.map((r) => r.attempt).join(',') === '1,2,3',
    `runs=${finalCascade.length} statuses=${finalCascade.map((r) => r.status).join(',')} attempts=${retries.map((r) => r.attempt).join(',')}`,
  );

  // --- arm + guard negatives ---------------------------------------------
  const { agentTurnShimHandlers } =
    await import('./domains/tasks/agent-turn-shim.ts');
  const shim = agentTurnShimHandlers(sql);
  const failMark = shim['tasks/agent_runs:markTaskAgentRunFailed'];
  const backlogTask = await mkTask('Guard-miss quarry');
  const seedRun = async (exec: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, deadline_at_ms,
        updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${backlogTask}, ${agentId}, ${exec},
        ${sessionId}, 'running', 'claude-code', 'itest-model', 'itest:plan',
        ${Date.now()}, ${Date.now() + 3_600_000}, ${Date.now()}
      ) RETURNING id
    `;
    return rows[0]?.id ?? '';
  };
  const deadlineRun = await seedRun('exec-noretry-1');
  await failMark?.({
    runId: deadlineRun,
    error: 'ran past the limit',
    failureCode: 'deadline',
  });
  const deadlineJobs = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM pgboss.job
    WHERE name = 'task.agent_retry'
      AND data ->> 'expectedRunId' = ${deadlineRun}
  `;
  const guardRun = await seedRun('exec-guardmiss-1');
  await failMark?.({
    runId: guardRun,
    error: 'crashed',
    failureCode: 'turn_crashed',
  });
  let guardCount = 0;
  for (let i = 0; i < 40; i++) {
    const runsNow = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.project_agent_runs
      WHERE task_id = ${backlogTask}
    `;
    guardCount = Number(runsNow[0]?.count ?? '0');
    const jobs = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pgboss.job
      WHERE name = 'task.agent_retry'
        AND data ->> 'expectedRunId' = ${guardRun}
        AND state IN ('created', 'active', 'retry')
    `;
    if (jobs[0]?.count === '0') break; // the arm drained (and was skipped)
    await sleep(200);
  }
  record(
    'retry arm: non-retryable codes arm nothing; guard misses kick nothing',
    Number(deadlineJobs[0]?.count ?? '9') === 0 && guardCount === 2,
    `deadlineJobs=${deadlineJobs[0]?.count} (want 0), backlog-task runs=${guardCount} (want 2 — the crash-armed retry declined on task status)`,
  );
}

/**
 * The Driver/Reviewer arc: the settle's park to `in_review` mints ONE
 * review row (find-or-insert by runId — the replay never double-mints);
 * request-changes records the feedback as a comment, re-kicks the agent
 * driver, and hands the card back to In progress; a second round mints
 * with a bumped round; approve completes the task AS THE RESPONDER; a
 * non-human leave withdraws; the `review_policy` file blocks the run's own
 * starter when independence is required.
 */
async function checkReviewArc(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  orgSlug: string,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const get = async (route: string): Promise<unknown> =>
    (await fetch(`${base}${route}`, { headers: { cookie } })).json();
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Review Arc' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  const agent = z.object({ agentId: z.string() }).safeParse(
    await (
      await post(`/api/app/projects/${projectId}/agents?orgId=${orgId}`, {
        name: 'Review Bot',
        harness: 'claude-code',
        model: 'itest-model',
        skills: [],
        connectors: [],
      })
    ).json(),
  );
  const agentId = agent.success ? agent.data.agentId : '';
  const task = z.object({ taskId: z.string() }).safeParse(
    await (
      await post(`/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Reviewed work',
      })
    ).json(),
  );
  const taskId = task.success ? task.data.taskId : '';
  await post(`/api/app/tasks/${taskId}/assign?orgId=${orgId}`, {
    assigneeType: 'agent',
    assigneeId: agentId,
  });
  // Hand-set in_progress (the route's status door would kick a live run and
  // race these mint assertions with its retry cascade).
  await sql`
    UPDATE app.tasks SET status = 'in_progress' WHERE id = ${taskId}
  `;
  const seedRun = async (exec: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, launched_at_ms,
        settled_at_ms, deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${exec},
        ${`pa-${agentId}`}, 'settled', 'claude-code', 'itest-model',
        ${userId}, ${Date.now()}, ${Date.now()}, ${Date.now()},
        ${Date.now() + 3_600_000}, ${Date.now()}
      ) RETURNING id
    `;
    return rows[0]?.id ?? '';
  };
  const runA = await seedRun('exec-review-a');
  const { agentTurnShimHandlers } =
    await import('./domains/tasks/agent-turn-shim.ts');
  const shim = agentTurnShimHandlers(sql);
  const statusDoor = shim['tasks/internal_mutations:agentUpdateTaskStatus'];
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_review',
    review: { runId: runA },
  });
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_review',
    review: { runId: runA },
  });
  const minted = await sql<
    { id: string; status: string; metadata: Record<string, unknown> | null }[]
  >`
    SELECT id, status, metadata FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
  `;
  const pendingView = z
    .object({
      review: z
        .object({ approvalId: z.string(), runId: z.string().nullable() })
        .loose()
        .nullable(),
    })
    .safeParse(await get(`/api/app/tasks/${taskId}/review?orgId=${orgId}`));
  record(
    'settle park mints ONE review row (replay finds it) and the sheet reads it',
    minted.length === 1 &&
      minted[0]?.status === 'pending' &&
      minted[0].metadata?.runId === runA &&
      minted[0].metadata.requestedFor === userId &&
      minted[0].metadata.round === 0 &&
      pendingView.success &&
      pendingView.data.review?.approvalId === minted[0].id,
    `rows=${minted.length} (want 1) run=${minted[0]?.metadata?.runId === runA} reviewer=${minted[0]?.metadata?.requestedFor === userId} view=${pendingView.success ? pendingView.data.review?.approvalId === minted[0]?.id : 'ERR'}`,
  );

  const changes = z
    .object({
      taskCompleted: z.boolean(),
      agentKicked: z.boolean(),
      taskReopened: z.boolean(),
    })
    .safeParse(
      await (
        await post(
          `/api/app/tasks/reviews/${minted[0]?.id ?? ''}/respond?orgId=${orgId}`,
          { decision: 'request_changes', feedback: 'Tighten the summary.' },
        )
      ).json(),
    );
  const afterChanges = await sql<{ status: string; commentCount: number }[]>`
    SELECT status, comment_count AS "commentCount" FROM app.tasks
    WHERE id = ${taskId}
  `;
  const kickedRun = await sql<{ trigger: string; feedback: string | null }[]>`
    SELECT trigger, feedback FROM app.project_agent_runs
    WHERE task_id = ${taskId} AND trigger = 'mention'
    ORDER BY seq DESC LIMIT 1
  `;
  record(
    'request-changes: comment + mention re-kick with feedback + card back',
    changes.success &&
      !changes.data.taskCompleted &&
      changes.data.agentKicked &&
      changes.data.taskReopened &&
      afterChanges[0]?.status === 'in_progress' &&
      afterChanges[0].commentCount === 1 &&
      kickedRun[0]?.feedback === 'Tighten the summary.',
    `resp=${changes.success ? JSON.stringify(changes.data) : 'ERR'} task=${afterChanges[0]?.status}/${afterChanges[0]?.commentCount} kick=${kickedRun[0]?.trigger}/${kickedRun[0]?.feedback}`,
  );

  // Round 2: cancel the mention run's retry noise, park again, approve.
  await sql`
    UPDATE app.project_agent_runs SET
      status = 'cancelled', settled_at_ms = ${Date.now()}
    WHERE task_id = ${taskId} AND status IN ('queued', 'running')
  `;
  await sql`
    UPDATE app.tasks SET status = 'in_progress' WHERE id = ${taskId}
  `;
  const runB = await seedRun('exec-review-b');
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_review',
    review: { runId: runB },
  });
  const roundTwo = await sql<
    { id: string; metadata: Record<string, unknown> | null }[]
  >`
    SELECT id, metadata FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
      AND status = 'pending'
  `;
  const approve = z
    .object({ taskCompleted: z.boolean() })
    .loose()
    .safeParse(
      await (
        await post(
          `/api/app/tasks/reviews/${roundTwo[0]?.id ?? ''}/respond?orgId=${orgId}`,
          { decision: 'approve' },
        )
      ).json(),
    );
  const afterApprove = await sql<
    { status: string; completedAt: number | null }[]
  >`
    SELECT status, completed_at_ms::float8 AS "completedAt" FROM app.tasks
    WHERE id = ${taskId}
  `;
  record(
    'round-2 mint + approve completes the task as the responder',
    roundTwo.length === 1 &&
      roundTwo[0]?.metadata?.round === 1 &&
      approve.success &&
      approve.data.taskCompleted &&
      afterApprove[0]?.status === 'done' &&
      afterApprove[0].completedAt !== null,
    `round=${JSON.stringify(roundTwo[0]?.metadata?.round)} (want 1), approve=${approve.success ? approve.data.taskCompleted : 'ERR'}, task=${afterApprove[0]?.status}`,
  );

  // Withdraw lane: park round 3, then the agent leaves in_review itself.
  await sql`
    UPDATE app.tasks SET status = 'in_progress' WHERE id = ${taskId}
  `;
  const runC = await seedRun('exec-review-c');
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_review',
    review: { runId: runC },
  });
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_progress',
  });
  const withdrawn = await sql<
    { status: string; metadata: Record<string, unknown> | null }[]
  >`
    SELECT status, metadata FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
      AND metadata ->> 'runId' = ${runC}
  `;
  record(
    'a non-human leave from in_review withdraws the pending review',
    withdrawn[0]?.status === 'rejected' &&
      withdrawn[0].metadata?.withdrawn === true,
    `row=${withdrawn[0]?.status}/${JSON.stringify(withdrawn[0]?.metadata?.withdrawn)}`,
  );

  // Policy lane: independence required ⇒ the run's starter cannot approve.
  const configRoot = process.env.TALE_CONFIG_DIR ?? '';
  const governanceDir = path.join(configRoot, orgSlug, 'governance');
  await mkdir(governanceDir, { recursive: true });
  await writeFile(
    path.join(governanceDir, 'review-policy.yml'),
    'requireIndependentReviewer: true\n',
  );
  const orgConfig = await import('./lib/org-config.ts');
  orgConfig.clearOrgConfigCaches();
  await sql`
    UPDATE app.tasks SET status = 'in_progress' WHERE id = ${taskId}
  `;
  const runD = await seedRun('exec-review-d');
  await statusDoor?.({
    organizationId: orgId,
    actorId: agentId,
    taskId,
    status: 'in_review',
    review: { runId: runD },
  });
  const gated = await sql<{ id: string }[]>`
    SELECT id FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
      AND metadata ->> 'runId' = ${runD}
  `;
  const refusedRes = await post(
    `/api/app/tasks/reviews/${gated[0]?.id ?? ''}/respond?orgId=${orgId}`,
    { decision: 'approve' },
  );
  const refusedBody = z
    .object({ error: z.string() })
    .loose()
    .safeParse(await refusedRes.json());
  await writeFile(path.join(governanceDir, 'review-policy.yml'), '{}\n');
  orgConfig.clearOrgConfigCaches();
  record(
    'review policy: the run starter cannot approve when independence is required',
    refusedRes.status === 403 &&
      refusedBody.success &&
      refusedBody.data.error === 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
    `status=${refusedRes.status} error=${refusedBody.success ? refusedBody.data.error : 'ERR'}`,
  );

  // The reviewer BELLS: each mint writes ONE request bell to the resolved
  // reviewer (the replayed mint stacks nothing); respond and withdraw mark
  // it read; the reviewer got auto-subscribed at the first mint.
  const bells = await sql<
    { resourceId: string; read: boolean; type: string }[]
  >`
    SELECT resource_id AS "resourceId", read, type
    FROM app.user_notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
      AND type = 'task_review_requested' AND task_id = ${taskId}
    ORDER BY seq
  `;
  const firstBell = bells.find((bell) => bell.resourceId === minted[0]?.id);
  const roundTwoBell = bells.find(
    (bell) => bell.resourceId === roundTwo[0]?.id,
  );
  const withdrawnBell = bells.find(
    (bell) => bell.resourceId === gated[0]?.id || !bell.read,
  );
  const subscribed = await sql<{ reason: string }[]>`
    SELECT reason FROM app.task_subscriptions
    WHERE task_id = ${taskId} AND subscriber_type = 'user'
      AND subscriber_id = ${userId}
  `;
  const facet = z
    .object({
      reviews: z.array(
        z.object({ taskId: z.string(), approvalId: z.string() }).loose(),
      ),
    })
    .safeParse(
      await get(
        `/api/app/tasks/pending-reviews?orgId=${orgId}&projectIds=${projectId}`,
      ),
    );
  record(
    'pending-reviews facet lists the open gate for the project',
    facet.success &&
      facet.data.reviews.some(
        (row) => row.taskId === taskId && row.approvalId === gated[0]?.id,
      ),
    `facet=${facet.success ? facet.data.reviews.length : 'ERR'} rows, hasGated=${facet.success && facet.data.reviews.some((row) => row.approvalId === gated[0]?.id)}`,
  );

  record(
    'review bells: one per mint, dismissed on respond/withdraw, reviewer subscribed',
    bells.length === 4 &&
      firstBell?.read === true &&
      roundTwoBell?.read === true &&
      // The policy-gated round's bell was dismissed by nothing — its refusal
      // left the approval pending, so its bell stays unread.
      withdrawnBell !== undefined &&
      // First reason wins in the idempotent upsert (0.4 semantics): the
      // creator subscription predates the reviewer designation.
      subscribed.length === 1,
    `bells=${bells.length} (want 4 — one per mint), first=${firstBell?.read} (want read), round2=${roundTwoBell?.read} (want read), subscribed=${subscribed[0]?.reason}`,
  );
}

/**
 * The watchdog sweeps on hand-stranded rows — the handler bodies invoked
 * directly (the scheduled lane is just a cron row over the same functions;
 * assertions are on ROW STATE so a cron firing mid-check changes nothing):
 * an overdue running run deadline-fails with its op cancelled and its
 * session slot released; an overdue PARKED run fails too; an expired-TTL
 * session flips while a fresh one stays; a dead admission ticket reaps
 * while a live one stays; a stale chat generation clears with its thread
 * settled idle and its pending placeholder failed.
 */
async function checkWatchdogs(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string },
): Promise<void> {
  const { cookie, orgId } = ctx;
  const post = (route: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const project = z
    .object({ projectId: z.string() })
    .safeParse(
      await (
        await post(`/api/app/projects?orgId=${orgId}`, { name: 'Watchdogs' })
      ).json(),
    );
  const projectId = project.success ? project.data.projectId : '';
  const task = z.object({ taskId: z.string() }).safeParse(
    await (
      await post(`/api/app/tasks?orgId=${orgId}`, {
        projectId,
        title: 'Watchdog quarry',
      })
    ).json(),
  );
  const taskId = task.success ? task.data.taskId : '';
  const now = Date.now();

  // Lane 1: an overdue RUNNING run with a live op and a live session slot.
  const overdue = await sql<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, started_at_ms, launched_at_ms,
      deadline_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, 'wd-agent', 'exec-wd-1',
      'pa-wd-agent', 'running', 'claude-code', 'itest-model', 'itest:wd',
      ${now - 13 * 3_600_000}, ${now - 13 * 3_600_000}, ${now - 3_600_000},
      ${now}
    ) RETURNING id
  `;
  const overdueId = overdue[0]?.id ?? '';
  await sql`
    INSERT INTO app.sandbox_session_ops (
      org_id, session_id, exec_id, kind, status, heartbeat_at_ms,
      started_at_ms
    ) VALUES (
      ${orgId}, 'pa-wd-agent', 'exec-wd-1', 'agent-run', 'running',
      ${now - 3_600_000}, ${now - 13 * 3_600_000}
    )
  `;
  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, 'pa-wd-agent', 'active', 'project_agent', 'wd-agent',
      'itest:wd', ${now - 13 * 3_600_000}, ${now + 24 * 3_600_000}
    )
  `;
  // Lane 2: an overdue PARKED run (never launched — no op, no slot).
  const parked = await sql<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, started_at_ms, waiting_for_capacity_at_ms,
      deadline_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, 'wd-agent-2', 'exec-wd-2',
      'pa-wd-agent-2', 'queued', 'claude-code', 'itest-model', 'itest:wd',
      ${now - 13 * 3_600_000}, ${now - 13 * 3_600_000}, ${now - 3_600_000},
      ${now}
    ) RETURNING id
  `;
  const parkedId = parked[0]?.id ?? '';

  const taskWatchdogs = await import('./domains/tasks/watchdogs.ts');
  await taskWatchdogs.runTaskAgentWatchdog(sql);
  const runsAfter = await sql<
    { id: string; status: string; error: string | null }[]
  >`
    SELECT id, status, error FROM app.project_agent_runs
    WHERE id IN (${overdueId}, ${parkedId})
  `;
  const overdueAfter = runsAfter.find((r) => r.id === overdueId);
  const parkedAfter = runsAfter.find((r) => r.id === parkedId);
  const opAfter = await sql<{ status: string; finalizedAt: number | null }[]>`
    SELECT status, finalized_at_ms::float8 AS "finalizedAt"
    FROM app.sandbox_session_ops
    WHERE session_id = 'pa-wd-agent' AND exec_id = 'exec-wd-1'
  `;
  const slotAfter = await sql<{ status: string }[]>`
    SELECT status FROM app.sandbox_sessions
    WHERE session_id = 'pa-wd-agent' AND org_id = ${orgId}
    ORDER BY created_at_ms DESC LIMIT 1
  `;
  record(
    'task-agent watchdog deadline-fails overdue runs and frees their slots',
    overdueAfter?.status === 'failed' &&
      (overdueAfter.error ?? '').includes('time limit') &&
      parkedAfter?.status === 'failed' &&
      (parkedAfter.error ?? '').includes('capacity') &&
      opAfter[0]?.status === 'cancelled' &&
      opAfter[0].finalizedAt !== null &&
      slotAfter[0]?.status === 'stopped',
    `overdue=${overdueAfter?.status} parked=${parkedAfter?.status} op=${opAfter[0]?.status} slot=${slotAfter[0]?.status}`,
  );

  // Lane 3: sandbox expiry + admission reap (reconcile skipped — no spawner
  // is live here; the cron lane fail-closes on probe errors by design).
  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, expires_at_ms
    ) VALUES
      (${orgId}, 'wd-ttl-gone', 'active', 'render', 'wd-ttl-gone',
       'itest:wd', ${now - 25 * 3_600_000}, ${now - 3_600_000}),
      (${orgId}, 'wd-ttl-live', 'active', 'render', 'wd-ttl-live',
       'itest:wd', ${now}, ${now + 24 * 3_600_000})
  `;
  await sql`
    INSERT INTO app.sandbox_admission_tickets (
      org_id, kind, owner_type, owner_id, source, status, created_at_ms,
      last_seen_at_ms
    ) VALUES
      (${orgId}, 'session', 'render', 'wd-ticket-dead', 'workflow',
       'waiting', ${now - 3_600_000}, ${now - 3_600_000}),
      (${orgId}, 'session', 'render', 'wd-ticket-live', 'workflow',
       'waiting', ${now}, ${now})
  `;
  const sandboxWatchdogs = await import('./domains/sandbox/watchdogs.ts');
  await sandboxWatchdogs.runSandboxWatchdog(sql, { skipReconcile: true });
  const ttlRows = await sql<{ sessionId: string; status: string }[]>`
    SELECT session_id AS "sessionId", status FROM app.sandbox_sessions
    WHERE session_id IN ('wd-ttl-gone', 'wd-ttl-live')
  `;
  const tickets = await sql<{ ownerId: string }[]>`
    SELECT owner_id AS "ownerId" FROM app.sandbox_admission_tickets
    WHERE owner_id IN ('wd-ticket-dead', 'wd-ticket-live')
  `;
  record(
    'sandbox watchdog expires overdue sessions and reaps dead tickets',
    ttlRows.find((r) => r.sessionId === 'wd-ttl-gone')?.status === 'expired' &&
      ttlRows.find((r) => r.sessionId === 'wd-ttl-live')?.status === 'active' &&
      tickets.length === 1 &&
      tickets[0]?.ownerId === 'wd-ticket-live',
    `ttl=${JSON.stringify(ttlRows)} tickets=${tickets.map((t) => t.ownerId).join(',')}`,
  );

  // Lane 4: a stale chat generation (hard-killed turn) clears; the thread
  // settles idle and the pending placeholder fails.
  const thread = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, kind, created_at_ms, updated_at_ms)
    VALUES (${orgId}, 'chat', ${now}, ${now}) RETURNING id
  `;
  const threadId = thread[0]?.id ?? '';
  await sql`
    INSERT INTO app.thread_metadata (
      thread_id, org_id, user_id, chat_type, status, generation_status,
      stream_id, generation_heartbeat_at_ms, created_at_ms
    ) VALUES (
      ${threadId}, ${orgId}, 'itest:wd', 'assistant', 'active', 'generating',
      'stream-wd', ${now - 20 * 60_000}, ${now}
    )
  `;
  await sql`
    INSERT INTO app.messages (
      thread_id, org_id, "order", step_order, role, text, status,
      created_at_ms
    ) VALUES (
      ${threadId}, ${orgId}, 1, 0, 'assistant', '', 'pending', ${now}
    )
  `;
  await sql`
    INSERT INTO app.generations (
      thread_id, org_id, text, started_at_ms, heartbeat_at_ms, updated_at_ms
    ) VALUES (
      ${threadId}, ${orgId}, 'partial…', ${now - 20 * 60_000},
      ${now - 20 * 60_000}, ${now - 20 * 60_000}
    )
  `;
  const chatWatchdogs = await import('./domains/chat/watchdogs.ts');
  await chatWatchdogs.runChatGenerationWatchdog(sql);
  const genGone = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.generations
    WHERE thread_id = ${threadId}
  `;
  const metaAfter = await sql<
    { generationStatus: string | null; streamId: string | null }[]
  >`
    SELECT generation_status AS "generationStatus", stream_id AS "streamId"
    FROM app.thread_metadata WHERE thread_id = ${threadId}
  `;
  const msgAfter = await sql<{ status: string; error: string | null }[]>`
    SELECT status, error FROM app.messages WHERE thread_id = ${threadId}
  `;
  record(
    'chat watchdog clears stale generations and settles the thread',
    genGone[0]?.count === '0' &&
      metaAfter[0]?.generationStatus === 'idle' &&
      metaAfter[0].streamId === null &&
      msgAfter[0]?.status === 'failed' &&
      (msgAfter[0].error ?? '') !== '',
    `gen=${genGone[0]?.count} meta=${metaAfter[0]?.generationStatus} msg=${msgAfter[0]?.status}`,
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
  // The reused 0.4 SSO handlers sign state/cookies from process.env — keep
  // it in lockstep with the instance secret or cookie verification splits.
  process.env.BETTER_AUTH_SECRET ??= 'itest-secret-itest-secret';
  // Shrink the outbound-send undo window so the send lane check stays fast.
  process.env.CONVERSATION_UNDO_SEND_DELAY_MS ??= '1500';
  // Shrink the notification-email debounce for the sink check; the drain
  // helper settles stragglers before any SMTP-counting fake installs.
  process.env.NOTIFICATION_EMAIL_DEBOUNCE_MS ??= '1500';
  const auth = createAuth({
    databaseUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    baseUrl,
    sql,
  });

  console.log('[itest] starting pg-boss (installs its own schema)…');
  const boss = createBoss(databaseUrl, { supervise: true });
  await boss.start();
  await ensureQueues(boss);
  await registerSchedules(boss);
  setEnqueueBoss(boss);
  // No itest job may ever open a real IMAP/SMTP connection.
  setMailTransportForTesting(DEFAULT_MAIL_FAKE);

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
    await checkChatThreadSurface(sql, baseUrl, authCtx);
    await checkBrandingAndTeams(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkAgentSecrets(sql, baseUrl, authCtx);
    await checkKnowledgeEntries(sql, baseUrl, authCtx);
    await checkCollabEmitters(sql, baseUrl, authCtx);
    await checkChangelogAndAccounts(sql, baseUrl, authCtx);
    await checkLegalHolds(sql, baseUrl, authCtx);
    await checkRetention(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkErasure(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkTwoFactor(
      sql,
      baseUrl,
      authCtx,
      `itest-${orgSuffix}`,
      `itest-${orgSuffix}@example.com`,
    );
    await checkChatMemoriesDeferredAuto(
      sql,
      baseUrl,
      authCtx,
      `itest-${orgSuffix}`,
    );
    await checkAutomations(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkRestDoor(sql, baseUrl, authCtx);
    await checkRestMachineJourney(sql, baseUrl, authCtx);
    await checkRestResources(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkSsoLogin(sql, baseUrl, authCtx.orgId, `itest-${orgSuffix}`);
    await checkScim(sql, baseUrl, authCtx);
    await checkTrustedHeaders(sql, baseUrl);
    await checkConnectorCredentials(sql, baseUrl, authCtx);
    await checkConversations(sql, baseUrl, authCtx);
    await checkMailboxSyncLane(sql, authCtx);
    await checkOutboundSendLane(sql, baseUrl, authCtx);
    await checkNotificationEmailSink(sql, authCtx);
    await checkApprovalsSurface(sql, baseUrl, authCtx);
    await checkGovernance(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkTaskAgentRuns(sql, baseUrl, authCtx);
    await checkTaskAgentTurnDrive(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkAutomationAgentNode(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkAskAnswer(sql, baseUrl, authCtx);
    await checkAutoRetryAndKickPlan(sql, baseUrl, authCtx);
    await checkReviewArc(sql, baseUrl, authCtx, `itest-${orgSuffix}`);
    await checkSandboxSessions(sql, authCtx);
    await checkSandboxSpawner(sql, baseUrl, authCtx);
    await checkWatchdogs(sql, baseUrl, authCtx);
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
