/** Complete released b493 host flow over real old SQL and an actual boot
 * cutover. External sandbox/provider effects are recorded, never sent. */
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';

import postgres, { type Sql } from 'postgres';
import { z } from 'zod';

import {
  legacyAgentEvent,
  legacyAgentToken,
  withLegacyAgentPorts,
  type LegacyAgentPorts,
} from '../../../tests/fixtures/automation-legacy-v1/agent-flow-adapter.ts';
import {
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
  type StartWorkflowAgentTurnArgs,
} from '../../../tests/fixtures/automation-legacy-v1/agent-flow.ts';
import { legacyAgentSqlHandlers } from '../../../tests/fixtures/automation-legacy-v1/shim-flow.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { agentWorkTurnDeadlineMs } from '../../core/sandbox/agent_deadline.ts';
import {
  applyMigrationFileInTx,
  isMigrationFile,
  runBootMigrations,
} from '../../db/migrate.ts';
import { resolvePostgresConnection } from '../../db/ssl.ts';
import { createCtxShim, type ShimHandlers } from '../../lib/ctx-shim.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;
const migrationRoot = new URL('../../db/migrations/', import.meta.url);
const recordSchema = z.record(z.string(), z.unknown());

function connect(url: string): Sql {
  const connection = new URL(url);
  connection.searchParams.set(
    'options',
    '-c statement_timeout=8000 -c lock_timeout=8000',
  );
  const resolved = resolvePostgresConnection(connection.toString());
  return postgres(resolved.url, {
    ssl: resolved.ssl,
    max: 1,
    connect_timeout: 8,
    onnotice: () => {},
  });
}

/** Session/configuration ports only. Run/ask operations always dispatch into
 * exact retained old SQL; neither this adapter nor its scheduler reads protocol. */
function context(sql: Sql): ActionCtx {
  const ops = new Map<string, Record<string, unknown>>();
  const finalized = new Set<string>();
  const key = (raw: Record<string, unknown>) =>
    `${String(raw.sessionId)}/${String(raw.execId)}`;
  const external: ShimHandlers = {
    'automations/queries:getRunLanguageContext': async () => ({
      defaultLocale: 'en',
      task: null,
    }),
    'sandbox/session_mutations:reserveTurnBudget': async () => ({
      allowed: true,
      budgetCents: 100,
    }),
    'sandbox/session_mutations:insertSessionToken': async (raw) => {
      const token = z
        .object({
          expiresAt: z.number().finite(),
          llmGatewayKeyId: z.string().optional(),
        })
        .parse(raw);
      legacyAgentToken(token.expiresAt, token.llmGatewayKeyId ?? null);
      await legacyAgentEvent('token');
      return null;
    },
    'sandbox/session_mutations:upsertSessionOp': async (raw) => {
      const value = recordSchema.parse(raw);
      ops.set(key(value), { ...ops.get(key(value)), ...value });
      await legacyAgentEvent('op');
      return null;
    },
    'sandbox/session_mutations:claimSessionOpFinalize': async (raw) => {
      const id = key(recordSchema.parse(raw));
      if (!ops.has(id) || finalized.has(id)) return false;
      finalized.add(id);
      await legacyAgentEvent('finalize');
      return true;
    },
    'sandbox/session_queries:getExternalTurnOpForFinalize': async (raw) =>
      ops.get(key(recordSchema.parse(raw))) ?? null,
    'sandbox/session_mutations:recordSessionOpSpend': async () => {
      await legacyAgentEvent('spend-recorded');
      return null;
    },
    'sandbox/session_mutations:markSessionTokenRevokedByKeyId': async () => {
      await legacyAgentEvent('token-revoked');
      return null;
    },
    'sandbox/session_mutations:hibernateAutomationScopedSession': async () => {
      await legacyAgentEvent('session-release-requested');
      return null;
    },
  };
  for (const [name, handler] of Object.entries(legacyAgentSqlHandlers(sql))) {
    if (name in external) throw new Error('duplicate historical handler');
    external[name] = async (raw) => {
      const result = await handler(raw);
      const fields =
        result !== null && typeof result === 'object' && !Array.isArray(result)
          ? recordSchema.parse(result)
          : {};
      const outcome = fields.stamped ?? fields.retargeted ?? fields.recorded;
      await legacyAgentEvent(
        `sql:${name}${typeof outcome === 'boolean' ? `:${String(outcome)}` : ''}`,
      );
      return result;
    };
  }
  // The maintained shim intentionally omits unavailable facilities. The exact
  // old host only uses registered handlers/scheduler in these scenarios.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same explicit reuse boundary as production hosts
  return createCtxShim(external, {
    scheduler: async () => {
      await legacyAgentEvent('drive-enqueued');
    },
  }) as ActionCtx;
}

function args(id: string): StartWorkflowAgentTurnArgs {
  return {
    organizationId: 'fixture',
    runId: id,
    nodeId: 'agent',
    execId: `${id}-exec`,
    sessionId: `workflow-${id}`,
    harness: 'claude-code',
    providerSlug: 'fixture',
    modelId: 'model',
    gatewayModel: 'fixture/model',
    deadlineAt: Date.now() + 60000,
    request: { model: 'fixture/model', prompt: 'Synthetic fixture only.' },
  };
}

async function seed(
  sql: Sql,
  id: string,
  cursor: 'absent' | 'settled' | 'live',
  ask = false,
): Promise<void> {
  const start = args(id);
  const agent = {
    execId: cursor === 'settled' ? `${id}-previous` : start.execId,
    sessionId: start.sessionId,
    deadlineAt: start.deadlineAt,
    harness: start.harness,
    providerSlug: start.providerSlug,
    gatewayModel: start.gatewayModel,
    input: start.request,
    ...(cursor === 'settled'
      ? { result: { text: 'previous', files: [], errored: false } }
      : {}),
  };
  const checkpoints = {
    nodes: {},
    executions: 0,
    ...(cursor === 'absent' ? {} : { cursor: { node: 'agent', agent } }),
  };
  await sql`INSERT INTO app.automation_runs (id, org_id, name, version, status, mode, started_by, checkpoints, claim_epoch, chain_seq, started_at_ms, wake_at_ms)
    VALUES (${id}, 'fixture', 'example', 1, 'waiting', 'live', 'user:fixture', ${sql.json(checkpoints)}, 3, 4, 1, 1)`;
  if (ask)
    await sql`INSERT INTO app.automation_human_asks (id, org_id, run_id, node_id, session_id, exec_id, question, status, answer, agent_session_id, expires_at_ms, created_at_ms)
    VALUES (${`${id}-ask`}, 'fixture', ${id}, 'agent', ${start.sessionId}, ${start.execId}, 'Synthetic question', 'answered', 'Synthetic answer', 'fixture-conversation', 9999999999999, 1)`;
}

async function invoke(
  sql: Sql,
  id: string,
  resume: boolean,
  ports: LegacyAgentPorts,
): Promise<void> {
  await withLegacyAgentPorts(ports, async () => {
    if (resume)
      await resumeWorkflowAgentTurnWithAnswerImpl(context(sql), {
        organizationId: 'fixture',
        askId: `${id}-ask`,
      });
    else await startWorkflowAgentTurnImpl(context(sql), args(id));
  });
}

/** Requires CREATE DATABASE on the disposable integration server, just like
 * the other boot-cutover proof. Never uses or drops the ordinary harness DB. */
export async function checkLegacyAgentFlow(
  databaseUrl: string,
  record: Recorder,
): Promise<void> {
  const admin = connect(databaseUrl);
  const name = `itest_legacy_agent_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  let owned = false;
  let sql: Sql | undefined;
  let original: unknown;
  const cleanupFailures: unknown[] = [];
  const paused: Array<{ release: () => void; settled: Promise<unknown> }> = [];
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    owned = true;
    await admin`ALTER DATABASE ${admin(name)} SET search_path TO tale, public`;
    sql = connect(target.toString());
    const fixture = sql;
    await fixture`CREATE SCHEMA tale`;
    await fixture`CREATE TABLE app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const file of (await readdir(migrationRoot))
      .filter(isMigrationFile)
      .sort()
      .filter((entry) => entry < '0163_automation_legacy_protocol.sql')) {
      await fixture.begin(async (tx) => {
        await applyMigrationFileInTx(tx, file);
        await tx`INSERT INTO app_migrations (name) VALUES (${file})`;
      });
    }
    for (const cursor of ['absent', 'settled', 'live'] as const) {
      const id = `positive-${cursor}`;
      await seed(fixture, id, cursor);
      const events: string[] = [];
      await invoke(fixture, id, false, { events });
      record(
        `complete old start reaches harness with ${cursor} cursor before cutover`,
        events.includes('harness') &&
          events.includes(
            `sql:automations/mutations:stampAgentTurnLaunch:${String(cursor === 'live')}`,
          ),
        'real old stamp outcome; no adapter liveness decision',
      );
    }
    await seed(fixture, 'positive-resume', 'live', true);
    const resumed: string[] = [];
    await invoke(fixture, 'positive-resume', true, { events: resumed });
    record(
      'complete old answered resume retargets and launches before cutover',
      resumed.includes('harness') &&
        resumed.includes(
          'sql:automations/human_asks:retargetAgentCursor:true',
        ) &&
        resumed.indexOf('token') <
          resumed.indexOf(
            'sql:automations/human_asks:retargetAgentCursor:true',
          ),
      'old SQL retarget and token-before-retarget ordering both observed',
    );

    const cases = [
      {
        id: 'paused-absent',
        cursor: 'absent',
        resume: false,
        pause: 'gateway',
      },
      {
        id: 'paused-settled',
        cursor: 'settled',
        resume: false,
        pause: 'gateway',
      },
      { id: 'paused-live', cursor: 'live', resume: false, pause: 'gateway' },
      { id: 'paused-resume', cursor: 'live', resume: true, pause: 'token' },
      {
        id: 'admitted-resume',
        cursor: 'live',
        resume: true,
        pause: 'equipment',
      },
    ] as const;
    const observations: Array<{
      id: string;
      events: string[];
      tokens: Array<{ expiresAt: number; keyId: string | null }>;
      revokedKeys: string[];
      startedAt: number;
    }> = [];
    for (const sample of cases) {
      await seed(fixture, sample.id, sample.cursor, sample.resume);
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const events: string[] = [];
      const tokens: Array<{ expiresAt: number; keyId: string | null }> = [];
      const revokedKeys: string[] = [];
      const startedAt = Date.now();
      let reached = false;
      const pending = invoke(fixture, sample.id, sample.resume, {
        events,
        tokens,
        revokedKeys,
        after: async (event) => {
          if (!reached && event === sample.pause) {
            reached = true;
            ready.resolve();
            await release.promise;
          }
        },
      });
      const settled = pending.then(
        () => {
          if (!reached)
            ready.reject(new Error('historical flow did not reach pause'));
        },
        (error: unknown) => {
          ready.reject(error);
          throw error;
        },
      );
      void settled.catch(() => {});
      paused.push({ release: () => release.resolve(), settled });
      observations.push({
        id: sample.id,
        events,
        tokens,
        revokedKeys,
        startedAt,
      });
      // No unbounded wait on a lost adapter handshake. SQL itself is capped8s.
      await Promise.race([
        ready.promise,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('legacy agent pause deadline')),
            15000,
          );
          timer.unref();
          void ready.promise.finally(() => clearTimeout(timer)).catch(() => {});
        }),
      ]);
    }
    await runBootMigrations({
      databaseUrl: target.toString(),
      databaseWaitMs: 0,
      log: () => {},
    });
    for (const pending of paused) pending.release();
    await Promise.all(paused.map((pending) => pending.settled));
    for (const sample of observations) {
      const [row] = await fixture<
        { status: string; claimEpoch: number }[]
      >`SELECT status, claim_epoch AS "claimEpoch" FROM app.automation_runs WHERE id = ${sample.id}`;
      const admitted = sample.id === 'admitted-resume';
      const exactPath =
        sample.id === 'paused-resume'
          ? sample.events.includes(
              'sql:automations/human_asks:retargetAgentCursor:false',
            ) &&
            !sample.events.some((event) =>
              event.startsWith(
                'sql:automations/mutations:stampAgentTurnLaunch',
              ),
            )
          : admitted
            ? sample.events.includes(
                'sql:automations/human_asks:retargetAgentCursor:true',
              ) &&
              sample.events.includes(
                'sql:automations/mutations:stampAgentTurnLaunch:true',
              )
            : sample.events.includes(
                'sql:automations/mutations:stampAgentTurnLaunch:false',
              ) &&
              sample.events.filter(
                (event) => event === 'sql:automations/queries:readAgentCursor',
              ).length === 2 &&
              sample.events.includes('session-release-requested');
      record(
        `complete old ${sample.id} observes actual cutover`,
        row?.status === 'quarantined' &&
          row.claimEpoch > 3 &&
          sample.events.includes('harness') === admitted &&
          sample.events.includes('token') &&
          exactPath &&
          !sample.events.some((event) =>
            event.startsWith(
              'sql:automations/mutations:recordAgentTurnSettled',
            ),
          ),
        admitted
          ? 'retarget already committed: in-flight work may still execute, not claimed terminated'
          : 'old host/SQL refuses new execution; earlier synthetic token/session effects remain explicit',
      );
    }
    const refusedResume = observations.find(
      (sample) => sample.id === 'paused-resume',
    );
    const token = refusedResume?.tokens[0];
    record(
      'old refused retarget retains finite requested token expiry without invented cleanup',
      refusedResume !== undefined &&
        refusedResume.tokens.length === 1 &&
        token !== undefined &&
        token.keyId === 'fixture-key' &&
        token.expiresAt >=
          refusedResume.startedAt + agentWorkTurnDeadlineMs() &&
        token.expiresAt <= Date.now() + agentWorkTurnDeadlineMs() &&
        refusedResume.revokedKeys.length === 0 &&
        !refusedResume.events.includes('token-revoked'),
      'synthetic gateway mint and token insertion precede refused retarget; supplied expiry recorded, no real credential or cleanup guarantee',
    );
    const afterStart: string[] = [];
    await invoke(fixture, 'paused-live', false, { events: afterStart });
    const afterResume: string[] = [];
    await invoke(fixture, 'paused-resume', true, { events: afterResume });
    record(
      'complete old start and resume refuse held rows before new mint',
      !afterStart.includes('gateway') &&
        !afterStart.includes('harness') &&
        !afterResume.includes('gateway') &&
        !afterResume.includes('harness'),
      'actual held status is read through original SQL, with no protocol check in adapter',
    );
  } catch (error) {
    original = error;
  } finally {
    for (const pending of paused) pending.release();
    const settled = await Promise.allSettled(
      paused.map((pending) => pending.settled),
    );
    let disconnected = false;
    try {
      await sql?.end({ timeout: 8 });
      disconnected = true;
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
    try {
      if (owned && disconnected) await admin`DROP DATABASE ${admin(name)}`;
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
    try {
      await admin.end({ timeout: 8 });
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
    if (original === undefined) {
      for (const result of settled) {
        if (result.status === 'rejected') cleanupFailures.push(result.reason);
      }
    }
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      original === undefined ? cleanupFailures : [original, ...cleanupFailures],
      'legacy agent proof or owned database cleanup failed',
    );
  if (original !== undefined) throw original;
}
