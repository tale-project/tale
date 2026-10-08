import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Sql } from 'postgres';

import { getConfigRoot } from '../../core/lib/file_io.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { verifyAuditChain } from '../audit_logs/verify.ts';
/**
 * Real Postgres proof of the cleanup's audit trail, on a seeded sweep in an
 * organization of its own: a held run records its start and end and
 * destroys nothing; a released run writes exactly one system row per
 * category with that category's counts — never one per record — between
 * its start and end rows; the chain still verifies afterwards and anchors
 * on the hash the audit-prefix row recorded; and a destruction row the
 * chain refuses takes its deletes down with it and fails the run.
 */
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { applyRetentionBounds, runRetentionCleanup } from './service.ts';

interface TrailRow {
  action: string;
  actorId: string;
  actorType: string;
  category: string;
  resourceId: string | null;
  status: string;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

const DAY_MS = 24 * 3_600_000;

/** Every category the bounds walk requires, each floor clearing the
 * schema's compliance floors. */
export const BOUNDS_FILE = [
  ['documents', 1, 'days'],
  ['userTempHours', 1, 'hours'],
  ['agentTempHours', 1, 'hours'],
  ['chatHistory', 1, 'days'],
  ['auditLog', 365, 'days'],
  ['workflowLog', 1, 'days'],
  ['usageLedger', 30, 'days'],
  ['loginAttempt', 90, 'days'],
  ['chatFilterEvents', 1, 'days'],
  ['messageFeedback', 1, 'days'],
  ['contacts', 1, 'days'],
  ['externalConversations', 1, 'days'],
  ['notifications', 1, 'days'],
  ['agentRuns', 1, 'days'],
]
  .map(([category, min, unit]) =>
    [
      `${category}:`,
      `  min: ${min}`,
      '  max: 3650',
      `  default: ${Math.max(Number(min), 30)}`,
      `  unit: ${unit}`,
    ].join('\n'),
  )
  .join('\n');

const POLICY_FILE = [
  'documentsEnabled: true',
  'documentsRetentionDays: 7',
  'chatHistoryEnabled: true',
  'chatHistoryRetentionDays: 7',
  'contactsEnabled: true',
  'contactsRetentionDays: 7',
  'externalConversationsEnabled: true',
  'externalConversationsRetentionDays: 7',
  'agentRunsEnabled: true',
  'agentRunsRetentionDays: 7',
  'workflowLogEnabled: true',
  'workflowLogRetentionDays: 7',
  'auditLogEnabled: true',
  'auditLogRetentionDays: 365',
  'usageLedgerEnabled: true',
  'usageLedgerRetentionDays: 30',
  'messageFeedbackEnabled: true',
  'messageFeedbackRetentionDays: 7',
  'notificationsEnabled: true',
  'notificationsRetentionDays: 7',
  'chatFilterEventsEnabled: true',
  'chatFilterEventsRetentionDays: 7',
  'deletionGraceDays: 0',
].join('\n');

/** The destruction rows a run over the seed must write, in sweep order:
 * the action, the rows it destroyed, and its per-table counts. */
const EXPECTED_ROWS: [string, number, Record<string, number> | null][] = [
  [
    'usage_ledger.retention_deleted',
    4,
    { usageLedger: 2, usageEvents: 1, projectUsage: 1 },
  ],
  ['message_feedback.retention_deleted', 3, null],
  [
    'notification.retention_deleted',
    3,
    { notifications: 1, userNotifications: 2 },
  ],
  ['chat_filter_event.retention_deleted', 2, null],
  ['document.retention_deleted', 2, null],
  ['chat_history.retention_deleted', 2, null],
  ['contact.retention_deleted', 2, null],
  [
    'external_conversation.retention_deleted',
    1,
    { conversations: 1, attachments: 0 },
  ],
  ['agent_run.retention_deleted', 1, null],
  ['automation_run.retention_deleted', 2, null],
  ['audit_log.retention_deleted', 2, null],
  [
    'sandbox_ledger.retention_deleted',
    2,
    { toolCalls: 1, credentialAccess: 1 },
  ],
];

const REFUSED_ACTION = 'message_feedback.retention_deleted';

export async function checkRetentionAuditTrail(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { userId } = ctx;
  const orgId = randomUUID();
  const tag = orgId.slice(0, 8);
  const orgSlug = `itest-retention-trail-${tag}`;
  const now = Date.now();
  const ancient = now - 100 * DAY_MS;
  const pastAuditWindow = now - 400 * DAY_MS;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'Retention audit trail', ${orgSlug}, now())
  `;
  const orgConfigDir = path.join(getConfigRoot('retention'), orgSlug);
  await mkdir(path.join(orgConfigDir, 'governance'), { recursive: true });
  await writeFile(
    path.join(orgConfigDir, 'governance', 'retention.yml'),
    BOUNDS_FILE,
  );
  await writeFile(
    path.join(orgConfigDir, 'governance', 'retention-policy.yml'),
    POLICY_FILE,
  );
  clearOrgConfigCaches();

  // The chain's oldest prefix: two real rows, then the bounds row chained
  // onto them, then the prefix aged past the audit window — so the sweep
  // cuts exactly there and the bounds row is left holding the anchor.
  const prefix: string[] = [];
  for (const step of ['one', 'two']) {
    prefix.push(
      await sql.begin((tx) =>
        createAuditLog(tx, {
          organizationId: orgId,
          actorId: 'itest',
          actorType: 'system',
          action: 'itest.retention_prefix',
          category: 'admin',
          resourceType: 'itest',
          resourceId: step,
          status: 'success',
        }),
      ),
    );
  }
  await applyRetentionBounds(sql, { organizationId: orgId, actorId: userId });
  for (const [index, id] of prefix.entries()) {
    await sql`
      UPDATE app.audit_logs SET ts = ${pastAuditWindow + index} WHERE id = ${id}
    `;
  }
  const prefixHead = await sql<{ hash: string }[]>`
    SELECT integrity_hash AS hash FROM app.audit_logs WHERE id = ${prefix[1] ?? ''}
  `;

  await seedSweep(sql, { orgId, userId, tag, now, ancient, pastAuditWindow });

  // --- 1. A held org's run: started and completed, nothing destroyed. ----
  const hold = await sql<{ id: string }[]>`
    INSERT INTO app.legal_holds (
      org_id, target_type, target_id, target_label, reason, placed_by,
      placed_at_ms
    ) VALUES (
      ${orgId}, 'org', ${orgId}, 'itest', 'retention audit probe', ${userId},
      ${now}
    ) RETURNING id
  `;
  await runRetentionCleanup(sql);
  await sql`
    UPDATE app.legal_holds SET released_at_ms = ${Date.now()}
    WHERE id = ${hold[0]?.id ?? ''}
  `;
  const heldRuns = await retentionRuns(sql, orgId);
  const heldRun = heldRuns[0] ?? [];
  const feedbackWhileHeld = await agedFeedback(sql, orgId, tag);
  record(
    'retention audit: a held run records its start and end and destroys nothing',
    heldRuns.length === 1 &&
      isDeepStrictEqual(
        heldRun.map((row) => row.action),
        ['retention.run_started', 'retention.run_completed'],
      ) &&
      isDeepStrictEqual(heldRun[0]?.metadata?.holds, {
        organization: true,
        custodians: 0,
      }) &&
      heldRun[1]?.metadata?.deleted === 0 &&
      feedbackWhileHeld === 3,
    `runs=${heldRuns.length} (want 1), actions=${heldRun.map((row) => row.action).join(',')}, holds=${JSON.stringify(heldRun[0]?.metadata?.holds)}, agedFeedbackLeft=${feedbackWhileHeld} (want 3)`,
  );

  // --- 2. The released run: one row per category, with its counts. ------
  await runRetentionCleanup(sql);
  const sweep = (await retentionRuns(sql, orgId))[1] ?? [];
  const runId = sweep[0]?.resourceId ?? null;
  const destruction = sweep.slice(1, -1);
  const mismatches: string[] = [];
  EXPECTED_ROWS.forEach(([action, deleted, counts], index) => {
    const row = destruction[index];
    const metadata = row?.metadata;
    if (
      row?.action !== action ||
      metadata?.deleted !== deleted ||
      !isDeepStrictEqual(metadata.counts, counts ?? undefined)
    ) {
      mismatches.push(
        `${action}: got ${row?.action ?? 'nothing'} deleted=${String(metadata?.deleted)} counts=${JSON.stringify(metadata?.counts)}`,
      );
    }
  });
  const framed = sweep.every(
    (row) =>
      row.actorId === 'system' &&
      row.actorType === 'system' &&
      row.category === 'data' &&
      row.resourceId === runId &&
      row.status === 'success',
  );
  const closing = sweep[sweep.length - 1];
  const totalDeleted = EXPECTED_ROWS.reduce((sum, [, n]) => sum + n, 0);
  const survivors = await sweepSurvivors(sql, orgId, tag);
  record(
    'retention audit: a seeded sweep writes one system row per category with its counts, never one per record',
    runId !== null &&
      sweep[0]?.action === 'retention.run_started' &&
      closing?.action === 'retention.run_completed' &&
      destruction.length === EXPECTED_ROWS.length &&
      mismatches.length === 0 &&
      framed &&
      closing.metadata?.deleted === totalDeleted &&
      isDeepStrictEqual(
        closing.metadata.categories,
        categoriesOf(EXPECTED_ROWS),
      ) &&
      isDeepStrictEqual(survivors, {
        agedRows: 0,
        freshFeedback: 1,
        freshContacts: 1,
        freshChatFilterEvents: 1,
        runningAutomation: 1,
      }),
    `actions=${sweep.map((row) => row.action).join(',')}, mismatches=${mismatches.join('; ') || 'none'}, framed=${framed}, total=${String(closing?.metadata?.deleted)} (want ${totalDeleted}), survivors=${JSON.stringify(survivors)}`,
  );

  // --- 3. A destruction row the chain refuses rolls its deletes back. ----
  await sql`
    INSERT INTO app.message_feedback (
      org_id, thread_id, message_id, user_id, rating, created_at_ms
    ) VALUES
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-late-1`}, ${userId}, 'negative',
       ${ancient}),
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-late-2`}, ${userId}, 'negative',
       ${ancient})
  `;
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION app.itest_refuse_retention_row() RETURNS trigger AS $$
    BEGIN
      IF NEW.org_id = '${orgId}' AND NEW.action = '${REFUSED_ACTION}' THEN
        RAISE EXCEPTION 'itest: the chain refused the retention row';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER itest_refuse_retention_row BEFORE INSERT ON app.audit_logs
      FOR EACH ROW EXECUTE FUNCTION app.itest_refuse_retention_row();
  `);
  try {
    await runRetentionCleanup(sql);
  } finally {
    await sql.unsafe(`
      DROP TRIGGER IF EXISTS itest_refuse_retention_row ON app.audit_logs;
      DROP FUNCTION IF EXISTS app.itest_refuse_retention_row();
    `);
  }
  const refusedRun = (await retentionRuns(sql, orgId))[2] ?? [];
  const failedRow = refusedRun[refusedRun.length - 1];
  const keptFeedback = await agedFeedback(sql, orgId, tag);
  record(
    'retention audit: a destruction row the chain refuses rolls its deletes back and fails the run',
    isDeepStrictEqual(
      refusedRun.map((row) => row.action),
      ['retention.run_started', 'retention.run_failed'],
    ) &&
      failedRow?.status === 'failure' &&
      (failedRow.errorMessage ?? '').includes('the chain refused') &&
      failedRow.metadata?.failedCategory === 'messageFeedback' &&
      keptFeedback === 2,
    `actions=${refusedRun.map((row) => row.action).join(',')}, status=${failedRow?.status}, error=${failedRow?.errorMessage}, failedCategory=${String(failedRow?.metadata?.failedCategory)}, agedFeedbackLeft=${keptFeedback} (want 2: rolled back)`,
  );

  // --- 4. The next run destroys and records what the refused one kept. ---
  await runRetentionCleanup(sql);
  const retry = (await retentionRuns(sql, orgId))[3] ?? [];
  const feedbackAfterRetry = await agedFeedback(sql, orgId, tag);
  const verified = await verifyAuditChain(sql, orgId);
  const anchor = await sql<{ previousHash: string | null }[]>`
    SELECT previous_hash AS "previousHash" FROM app.audit_logs
    WHERE org_id = ${orgId} ORDER BY ts ASC, id ASC LIMIT 1
  `;
  const cut = destruction.find(
    (row) => row.action === 'audit_log.retention_deleted',
  )?.metadata?.lastDeletedHash;
  record(
    'retention audit: the retry records what the refused run kept, and the chain verifies from the recorded cut',
    isDeepStrictEqual(
      retry.map((row) => row.action),
      [
        'retention.run_started',
        'message_feedback.retention_deleted',
        'retention.run_completed',
      ],
    ) &&
      retry[1]?.metadata?.deleted === 2 &&
      feedbackAfterRetry === 0 &&
      verified.valid &&
      prefixHead[0]?.hash !== undefined &&
      cut === prefixHead[0].hash &&
      anchor[0]?.previousHash === cut,
    `actions=${retry.map((row) => row.action).join(',')}, deleted=${String(retry[1]?.metadata?.deleted)} (want 2), agedFeedbackLeft=${feedbackAfterRetry}, chainValid=${verified.valid} (${verified.verifiedCount} rows), cut=${String(cut)} prefixHead=${prefixHead[0]?.hash} anchor=${anchor[0]?.previousHash}`,
  );

  // Later lanes sweep the fleet; this organization leaves it.
  await sql`DELETE FROM app.retention_applied_bounds WHERE org_id = ${orgId}`;
  await rm(orgConfigDir, { recursive: true, force: true });
}

/** Every seeded category gets aged rows past its window (several where the
 * aggregation is the point) beside fresh or live rows that must stay. */
async function seedSweep(
  sql: Sql,
  seed: {
    orgId: string;
    userId: string;
    tag: string;
    now: number;
    ancient: number;
    pastAuditWindow: number;
  },
): Promise<void> {
  const { orgId, userId, tag, now, ancient, pastAuditWindow } = seed;
  await sql`
    INSERT INTO app.usage_ledger (
      org_id, user_id, period_key, granularity, input_tokens, output_tokens,
      total_tokens, cost_estimate_cents, request_count, connector_call_count,
      updated_at_ms
    ) VALUES
      (${orgId}, ${userId}, ${`rta-${tag}-a`}, 'daily', 1, 1, 2, 0, 1, 0,
       ${ancient}),
      (${orgId}, ${userId}, ${`rta-${tag}-b`}, 'daily', 1, 1, 2, 0, 1, 0,
       ${ancient})
  `;
  await sql`
    INSERT INTO app.usage_events (
      org_id, user_id, model, provider, input_tokens, output_tokens,
      total_tokens, created_at_ms
    ) VALUES (${orgId}, ${userId}, 'itest-model', 'itest', 1, 1, 2, ${ancient})
  `;
  await sql`
    INSERT INTO app.project_usage (
      org_id, project_id, granularity, period_key, input_tokens,
      output_tokens, total_tokens, cost_estimate_cents, request_count,
      updated_at_ms
    ) VALUES (${orgId}, ${`rta-${tag}-project`}, 'daily', ${`rta-${tag}-a`},
      1, 1, 2, 0, 1, ${ancient})
  `;
  await sql`
    INSERT INTO app.message_feedback (
      org_id, thread_id, message_id, user_id, rating, created_at_ms
    ) VALUES
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-1`}, ${userId}, 'positive',
       ${ancient}),
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-2`}, ${userId}, 'positive',
       ${ancient}),
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-3`}, ${userId}, 'positive',
       ${ancient}),
      (${orgId}, ${`rta-${tag}`}, ${`rta-${tag}-fresh`}, ${userId}, 'positive',
       ${now})
  `;
  await sql`
    INSERT INTO app.notifications (
      org_id, category, severity, title_key, body_key, created_at_ms
    ) VALUES (${orgId}, 'system', 'info', 'itest', 'itest', ${ancient})
  `;
  await sql`
    INSERT INTO app.user_notifications (
      user_id, org_id, type, title_key, body_key, resource_type,
      resource_id, actor_type, read, created_at_ms
    ) VALUES
      (${userId}, ${orgId}, 'task_commented', 'x', 'y', 'task', 'rta-1',
       'system', true, ${ancient}),
      (${userId}, ${orgId}, 'task_commented', 'x', 'y', 'task', 'rta-2',
       'system', true, ${ancient}),
      (${userId}, ${orgId}, 'task_commented', 'x', 'y', 'task', 'rta-fresh',
       'system', true, ${now})
  `;
  await sql`
    INSERT INTO app.chat_filter_events (
      org_id, sanitization_run_id, thread_id, filter_name, direction, kind,
      category_ids, created_at_ms
    ) VALUES
      (${orgId}, ${`rta-${tag}-cfe-1`}, ${`rta-${tag}`}, 'pii', 'input',
       'detected', ${['email']}::text[], ${ancient}),
      (${orgId}, ${`rta-${tag}-cfe-2`}, ${`rta-${tag}`}, 'chat_filter',
       'output', 'blocked', ${['itest']}::text[], ${ancient}),
      (${orgId}, ${`rta-${tag}-cfe-3`}, ${`rta-${tag}`}, 'pii', 'input',
       'detected', ${['email']}::text[], ${now})
  `;
  // No file refs: a document without bytes purges without the object store,
  // so the lane holds wherever the harness runs.
  await sql`
    INSERT INTO app.documents (
      org_id, title, created_by, created_at_ms, updated_at_ms
    ) VALUES
      (${orgId}, 'rta-old-1.md', ${userId}, ${ancient}, ${ancient}),
      (${orgId}, 'rta-old-2.md', ${userId}, ${ancient}, ${ancient})
  `;
  for (const title of ['rta-chat-1', 'rta-chat-2']) {
    const thread = await sql<{ id: string }[]>`
      INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                               updated_at_ms)
      VALUES (${orgId}, ${userId}, ${title}, 'chat', ${ancient}, ${ancient})
      RETURNING id
    `;
    const threadId = thread[0]?.id ?? '';
    await sql`
      INSERT INTO app.thread_metadata (
        thread_id, org_id, user_id, chat_type, status, created_at_ms
      ) VALUES (${threadId}, ${orgId}, ${userId}, 'chat', 'active', ${ancient})
    `;
    await sql`
      INSERT INTO app.messages (
        thread_id, org_id, "order", step_order, role, text, status,
        created_at_ms
      ) VALUES (${threadId}, ${orgId}, 0, 0, 'user', 'old words', 'complete',
                ${ancient})
    `;
  }
  await sql`
    INSERT INTO app.contacts (org_id, name, email, source, created_at_ms,
                              updated_at_ms)
    VALUES
      (${orgId}, 'Old One', ${`rta-${tag}-1@ext.test`}, 'api_import',
       ${ancient}, ${ancient}),
      (${orgId}, 'Old Two', ${`rta-${tag}-2@ext.test`}, 'api_import',
       ${ancient}, ${ancient}),
      (${orgId}, 'Fresh', ${`rta-${tag}-3@ext.test`}, 'api_import', ${now},
       ${now})
  `;
  const conversation = await sql<{ id: string }[]>`
    INSERT INTO app.conversations (
      org_id, subject, status, channel, direction, connector_name,
      last_message_at_ms, created_at_ms
    ) VALUES (${orgId}, 'rta-conv', 'open', 'email', 'inbound', 'imap_smtp',
              ${ancient}, ${ancient})
    RETURNING id
  `;
  await sql`
    INSERT INTO app.conversation_messages (
      org_id, conversation_id, channel, direction, delivery_state, content,
      sent_at_ms, created_at_ms
    ) VALUES (${orgId}, ${conversation[0]?.id ?? ''}, 'email', 'inbound',
              'delivered', 'an old email body', ${ancient}, ${ancient})
  `;
  const project = await sql<{ id: string }[]>`
    INSERT INTO app.projects (org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${orgId}, 'Retention trail', ${userId}, ${now}, ${now})
    RETURNING id
  `;
  const projectId = project[0]?.id ?? '';
  const taskId = randomUUID();
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
      created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${taskId}, ${orgId}, ${projectId}, 'Old agent work', 'done',
      ${taskId}, ${userId}, 'user', ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, model, started_by, started_at_ms, settled_at_ms,
      deadline_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${projectId}, ${taskId}, 'rta-agent', ${`rta-exec-${tag}`},
      'rta-sess', 'settled', 'claude-code', 'm', ${userId}, ${ancient},
      ${ancient}, ${ancient}, ${ancient}
    )
  `;
  await sql.begin(async (fixtureTx) => {
    await markAutomationWriterInTx(fixtureTx);
    return fixtureTx`
    INSERT INTO app.automation_runs (
      org_id, name, version, status, mode, started_by, started_at_ms,
      finished_at_ms
    ) VALUES
      (${orgId}, 'rta-success', 1, 'success', 'live', 'trigger:itest',
       ${ancient}, ${ancient}),
      (${orgId}, 'rta-failed', 1, 'failed', 'live', 'trigger:itest',
       ${ancient}, ${ancient}),
      (${orgId}, 'rta-running', 1, 'running', 'live', 'trigger:itest',
       ${ancient}, NULL)
  `;
  });
  await sql`
    INSERT INTO app.sandbox_tool_calls (
      org_id, session_id, tool, user_id, outcome, created_at_ms
    ) VALUES
      (${orgId}, 'rta-sess', 'rag_search', ${userId}, 'ok', ${pastAuditWindow}),
      (${orgId}, 'rta-sess', 'rag_search', ${userId}, 'ok', ${now})
  `;
  await sql`
    INSERT INTO app.sandbox_credential_access (
      org_id, session_id, slug, kind, fetched_at_ms
    ) VALUES
      (${orgId}, 'rta-sess', 'rta-cred', 'bootstrap', ${pastAuditWindow}),
      (${orgId}, 'rta-sess', 'rta-cred', 'bootstrap', ${now})
  `;
}

/** The org's retention rows grouped by run, runs in the order they began. */
async function retentionRuns(sql: Sql, orgId: string): Promise<TrailRow[][]> {
  const rows = await sql<TrailRow[]>`
    SELECT action, actor_id AS "actorId", actor_type AS "actorType", category,
           resource_id AS "resourceId", status,
           error_message AS "errorMessage", metadata
    FROM app.audit_logs
    WHERE org_id = ${orgId} AND resource_type = 'retention_run'
    ORDER BY ts ASC, id ASC
  `;
  const runs = new Map<string, TrailRow[]>();
  for (const row of rows) {
    const key = row.resourceId ?? '';
    runs.set(key, [...(runs.get(key) ?? []), row]);
  }
  return [...runs.values()];
}

async function agedFeedback(
  sql: Sql,
  orgId: string,
  tag: string,
): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.message_feedback
    WHERE org_id = ${orgId} AND message_id <> ${`rta-${tag}-fresh`}
  `;
  return rows[0]?.count ?? -1;
}

/** What the sweep must leave: none of the aged seed, all of the fresh or
 * live rows. */
async function sweepSurvivors(
  sql: Sql,
  orgId: string,
  tag: string,
): Promise<Record<string, number>> {
  const rows = await sql<
    {
      agedRows: number;
      freshFeedback: number;
      freshContacts: number;
      freshChatFilterEvents: number;
      runningAutomation: number;
    }[]
  >`
    SELECT
      ((SELECT count(*) FROM app.usage_ledger WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.usage_events WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.project_usage WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.message_feedback
         WHERE org_id = ${orgId} AND message_id <> ${`rta-${tag}-fresh`})
      + (SELECT count(*) FROM app.notifications WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.user_notifications
         WHERE org_id = ${orgId} AND resource_id <> 'rta-fresh')
      + (SELECT count(*) FROM app.chat_filter_events
         WHERE org_id = ${orgId} AND created_at_ms < ${Date.now() - DAY_MS})
      + (SELECT count(*) FROM app.documents WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.threads WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.messages WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.contacts
         WHERE org_id = ${orgId} AND name <> 'Fresh')
      + (SELECT count(*) FROM app.conversations WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.conversation_messages WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.project_agent_runs WHERE org_id = ${orgId})
      + (SELECT count(*) FROM app.automation_runs
         WHERE org_id = ${orgId} AND status <> 'running')
      + (SELECT count(*) FROM app.sandbox_tool_calls
         WHERE org_id = ${orgId} AND created_at_ms < ${Date.now() - DAY_MS})
      + (SELECT count(*) FROM app.sandbox_credential_access
         WHERE org_id = ${orgId} AND fetched_at_ms < ${Date.now() - DAY_MS})
      + (SELECT count(*) FROM app.audit_logs
         WHERE org_id = ${orgId} AND action = 'itest.retention_prefix'))::int
        AS "agedRows",
      (SELECT count(*) FROM app.message_feedback
       WHERE org_id = ${orgId} AND message_id = ${`rta-${tag}-fresh`})::int
        AS "freshFeedback",
      (SELECT count(*) FROM app.contacts
       WHERE org_id = ${orgId} AND name = 'Fresh')::int AS "freshContacts",
      (SELECT count(*) FROM app.chat_filter_events
       WHERE org_id = ${orgId} AND created_at_ms >= ${Date.now() - DAY_MS})::int
        AS "freshChatFilterEvents",
      (SELECT count(*) FROM app.automation_runs
       WHERE org_id = ${orgId} AND status = 'running')::int
        AS "runningAutomation"
  `;
  return (
    rows[0] ?? {
      agedRows: -1,
      freshFeedback: -1,
      freshContacts: -1,
      freshChatFilterEvents: -1,
      runningAutomation: -1,
    }
  );
}

/** The closing row's per-category tallies the expected rows add up to. */
function categoriesOf(
  expected: typeof EXPECTED_ROWS,
): Record<string, { deleted: number }> {
  const category: Record<string, string> = {
    'usage_ledger.retention_deleted': 'usageLedger',
    'message_feedback.retention_deleted': 'messageFeedback',
    'notification.retention_deleted': 'notifications',
    'chat_filter_event.retention_deleted': 'chatFilterEvents',
    'document.retention_deleted': 'documents',
    'chat_history.retention_deleted': 'chatHistory',
    'contact.retention_deleted': 'contacts',
    'external_conversation.retention_deleted': 'externalConversations',
    'agent_run.retention_deleted': 'agentRuns',
    'automation_run.retention_deleted': 'automationRuns',
    'audit_log.retention_deleted': 'auditLogs',
    'sandbox_ledger.retention_deleted': 'sandboxLedgers',
  };
  return Object.fromEntries(
    expected.map(([action, deleted]) => [
      category[action] ?? action,
      { deleted },
    ]),
  );
}
