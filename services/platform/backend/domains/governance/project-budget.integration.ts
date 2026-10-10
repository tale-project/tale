/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  reserveLlmStepBudget,
  llmStepOp,
  recordLlmStepUsage,
} from '../automations/llm-metering.ts';
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import {
  assertChatTurnBudget,
  ChatBudgetExceededError,
} from '../chat/budget-admission.ts';
import { createPgTurnStore } from '../chat/store.ts';
import {
  loadProjectSharedThread,
  projectChatAccess,
  setThreadSharedWithProject,
} from '../chat/threads.ts';
import { processErasure } from '../erasure/service.ts';
import {
  openTranscriptionCall,
  settleTranscriptionCall,
  uploadTranscriptionSubject,
} from '../files/transcription-metering.ts';
import {
  reconcilePendingSessionOpKeys,
  settleCostFreeTurn,
  settleSessionOpSpend,
} from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import { loadBudgetSubject, readBudgetStanding } from './budget-gate.ts';
import { readInFlightReservations } from './budget-reservations.ts';
import {
  openDirectCall,
  releaseStaleDirectCalls,
  settleDirectCall,
} from './direct-calls.ts';
import { incrementUsageLedger, recordConnectorUsage } from './service.ts';

const createdSchema = z.object({ id: z.string() });

/** The composer banner's read, as far as these checks look at it. */
const budgetStatusSchema = z.object({
  status: z
    .looseObject({
      exceeded: z.boolean(),
      scope: z.string().optional(),
      projectName: z.string().nullable().optional(),
      warnings: z
        .array(
          z.looseObject({
            code: z.string(),
            scope: z.string().optional(),
            projectId: z.string().optional(),
            projectName: z.string().nullable().optional(),
          }),
        )
        .nullable(),
    })
    .nullable(),
});

/**
 * A project's budget cap (`GOV-R14`, migration 0155): spend that names a
 * project lands in the project's own buckets beside the ledger; a chat turn
 * in one of its threads is admitted against the project's cap, counting the
 * turns in flight there; a model request in the project is held to it and
 * stamps the project on its op, whose hold then counts toward the project;
 * an automation run spends in every project it is in, its agent steps and
 * its llm steps alike; a recording added to one of its chats is transcribed
 * on its budget; and nothing outside the project is bound by it.
 *
 * `ctx` is the suite's owner. The lane makes its own project and threads,
 * and removes them with its budgets file and its bookings.
 */
export async function checkProjectBudgets(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const { orgId, userId } = ctx;
  const now = Date.now();
  const agentSlug = `itest-project-budget-${suffix}`;
  const [org] = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId}
  `;
  const governanceDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    org?.slug ?? '',
    'governance',
  );
  const budgetsFile = path.join(governanceDir, 'budgets.yml');
  const projectBudgetsFile = path.join(governanceDir, 'project-budgets.yml');

  const [project] = await sql<{ id: string }[]>`
    INSERT INTO app.projects (
      org_id, name, key, team_ids, team_id, shared_with_team_ids,
      created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, ${`Budget ${suffix}`}, ${`PB${suffix.slice(0, 4)}`},
      ${[]}, ${null}, ${[]}, ${userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const projectId = project?.id ?? '';
  const newThread = async (body: Record<string, string>): Promise<string> => {
    const response = await fetch(
      `${base}/api/app/chat/threads?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify(body),
      },
    );
    const parsed = createdSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success ? parsed.data.id : '';
  };
  const projectThread = await newThread({ projectId });
  const ownThread = await newThread({});
  const opSession = `model-api:itest-project-${suffix}`;
  const automationName = `itest/project-budget-${suffix}`;
  const runSession = `wf-itest-project-${suffix}`;
  let secondProjectId = '';
  let llmSession = '';
  let runId = '';
  const projectReaderId = randomUUID();
  const erasureRequestId = randomUUID();
  let erasureRunId = '';
  let erasureSession = '';
  const erasureAutomation = `itest/project-erasure-${suffix}`;
  // A hidden branch of the project's conversation, as an edit or a
  // regenerate leaves one: later turns run on it.
  const [branch] = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                             updated_at_ms)
    VALUES (${orgId}, ${userId}, 'branch', 'chat', ${now}, ${now})
    RETURNING id
  `;
  const branchThread = branch?.id ?? '';
  await sql`
    INSERT INTO app.thread_metadata (
      thread_id, org_id, user_id, chat_type, status, project_id, hidden,
      branch_root_id, branch_parent_id, branch_fork_sequence, created_at_ms
    ) VALUES (
      ${branchThread}, ${orgId}, ${userId}, 'chat', 'active', ${projectId},
      true, ${projectThread}, ${projectThread}, 1, ${now}
    )
  `;
  /** Refile the conversation; answers each row's project afterwards. */
  const refile = async (target: string | null): Promise<(string | null)[]> => {
    await fetch(
      `${base}/api/app/chat/threads/${projectThread}/project?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ projectId: target }),
      },
    );
    const rows = await sql<{ threadId: string; projectId: string | null }[]>`
      SELECT thread_id AS "threadId", project_id AS "projectId"
      FROM app.thread_metadata
      WHERE thread_id = ANY(${[projectThread, branchThread]})
    `;
    return [projectThread, branchThread].map(
      (id) => rows.find((row) => row.threadId === id)?.projectId ?? null,
    );
  };

  /** The scope a chat send is refused for, or `admitted`. */
  const chatAdmission = async (threadId: string): Promise<string> => {
    try {
      await assertChatTurnBudget(sql, {
        organizationId: orgId,
        userId,
        threadId,
      });
      return 'admitted';
    } catch (error) {
      if (error instanceof ChatBudgetExceededError) return error.data.scope;
      throw error;
    }
  };

  try {
    // Before any budget binds the organization: a direct call is recorded
    // on a row that holds nothing, and booked from that row exactly once.
    const unheldSlug = `itest-unheld-${suffix}`;
    const memberHolds = async (): Promise<number> =>
      (
        await readInFlightReservations(sql, {
          organizationId: orgId,
          userId,
          userTeamIds: [],
        })
      ).user?.requests ?? 0;
    const holdsBefore = await memberHolds();
    const unheld = await openDirectCall(sql, {
      organizationId: orgId,
      lane: 'itest',
      // No project: its booking stays out of the project buckets below.
      subject: { userId, agentSlug: unheldSlug },
      worstCase: { cents: 5, tokens: 10 },
      maxDurationMs: 60_000,
    });
    const unheldRows = unheld.allowed
      ? await sql<{ budgetCents: number | null; userId: string | null }[]>`
          SELECT budget_cents AS "budgetCents", user_id AS "userId"
          FROM app.sandbox_session_ops
          WHERE org_id = ${orgId} AND session_id = ${unheld.lease.sessionId}
            AND exec_id = ${unheld.lease.execId}
        `
      : [];
    const holdsWhileUnheld = await memberHolds();
    const unheldSpend = {
      provider: 'itest',
      model: `itest-model-${suffix}`,
      inputTokens: 4,
      outputTokens: 2,
      costCents: 0.5,
    };
    const unheldSettles = unheld.allowed
      ? [
          await settleDirectCall(sql, unheld.lease, unheldSpend),
          await settleDirectCall(sql, unheld.lease, unheldSpend),
        ]
      : [];
    const unheldBooked = await sql<{ cost: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${unheldSlug}
        AND granularity = 'monthly'
    `;
    record(
      'project budgets: with no budget bound, a direct call is recorded without a hold and booked from its row once',
      unheld.allowed &&
        unheldRows.length === 1 &&
        unheldRows[0]?.budgetCents === null &&
        unheldRows[0].userId === userId &&
        holdsWhileUnheld === holdsBefore &&
        unheldSettles.join() === 'settled,already_settled' &&
        unheldBooked.length === 1 &&
        unheldBooked[0]?.cost === 0.5,
      `admitted=${unheld.allowed} row=${JSON.stringify(unheldRows)} (want one, no budget_cents, the member) member's holds ${holdsBefore} then ${holdsWhileUnheld} (want unchanged) settles=${unheldSettles.join()} (want settled,already_settled) booked=${JSON.stringify(unheldBooked)} (want 0.5 cents, once)`,
    );

    await mkdir(governanceDir, { recursive: true });
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        '    maxCostCents: 100',
      ].join('\n'),
    );
    clearOrgConfigCaches();

    // 60 of the project's 100 booked by its member.
    await incrementUsageLedger(sql, {
      organizationId: orgId,
      userId,
      inputTokens: 10,
      outputTokens: 5,
      costEstimateCents: 60,
      timestamp: now,
      agentSlug,
      projectIds: [projectId],
    });
    const buckets = await sql<
      { granularity: string; periodKey: string; cost: number; tokens: number }[]
    >`
      SELECT granularity, period_key AS "periodKey",
             cost_estimate_cents::float8 AS cost, total_tokens::float8 AS tokens
      FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${projectId}
      ORDER BY granularity
    `;
    const ledgerRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${agentSlug}
    `;
    record(
      'project budgets: spend in a project lands in its own buckets, beside the ledger',
      buckets.length === 3 &&
        buckets.every((bucket) => bucket.cost === 60 && bucket.tokens === 15) &&
        buckets.some(
          (bucket) =>
            bucket.granularity === 'monthly' &&
            bucket.periodKey === buildPeriodKeyFromTimestamp('monthly', now),
        ) &&
        ledgerRows[0]?.count === '3',
      `buckets=${JSON.stringify(buckets)} (want 3 at 60 cents, 15 tokens), ledger rows=${ledgerRows[0]?.count} (want 3)`,
    );

    // A connector call is counted as one, never as a model request: its
    // ledger rows carry none, the project's buckets take nothing from it,
    // and a request cap reads past a connector row booked with a request
    // before that rule. A personal request cap is set for the reading
    // alone, then the project's rule stands alone again.
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules:',
        '  - scope: default',
        '    period: monthly',
        '    maxRequests: 1000000',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        '    maxCostCents: 100',
      ].join('\n'),
    );
    clearOrgConfigCaches();
    const memberSubject = await loadBudgetSubject(sql, {
      organizationId: orgId,
      userId,
    });
    const requestsRead = async () =>
      (await readBudgetStanding(sql, memberSubject)).find(
        (standing) => standing.scope === 'user',
      )?.usage.requestCount ?? -1;
    const requestsBefore = await requestsRead();
    await recordConnectorUsage(sql, {
      organizationId: orgId,
      userId,
      agentSlug,
      connectorName: 'itest-connector',
      connectorOperation: 'list',
      costEstimateCents: 0,
      timestamp: now,
      projectIds: [projectId],
    });
    await incrementUsageLedger(sql, {
      organizationId: orgId,
      userId,
      inputTokens: 0,
      outputTokens: 0,
      costEstimateCents: 0,
      timestamp: now,
      agentSlug,
      connectorName: 'itest-connector',
      connectorOperation: 'legacy',
      connectorCallCount: 1,
      requestCount: 1,
    });
    const requestsAfter = await requestsRead();
    const connectorRows = await sql<{ requests: number; calls: number }[]>`
      SELECT request_count::float8 AS requests,
             connector_call_count::float8 AS calls
      FROM app.usage_ledger
      WHERE org_id = ${orgId} AND connector_name = 'itest-connector'
        AND connector_operation = 'list'
    `;
    const projectAfter = await sql<{ requests: number }[]>`
      SELECT coalesce(sum(request_count), 0)::float8 AS requests
      FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${projectId}
        AND granularity = 'monthly'
    `;
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        '    maxCostCents: 100',
      ].join('\n'),
    );
    clearOrgConfigCaches();
    record(
      'project budgets: a connector call is counted as one, never as a model request [GOV-R15]',
      connectorRows.length === 3 &&
        connectorRows.every((row) => row.requests === 0 && row.calls === 1) &&
        projectAfter[0]?.requests === 1 &&
        requestsBefore >= 0 &&
        requestsAfter === requestsBefore,
      `connector rows=${JSON.stringify(connectorRows)} (want 3 at 0 requests, 1 call), project requests=${projectAfter[0]?.requests} (want 1, the model call's), member requests ${requestsBefore} → ${requestsAfter} (want unchanged)`,
    );

    // Another of the project's turns holds the remaining 40.
    const roomLeft = await chatAdmission(projectThread);
    await sql`
      INSERT INTO app.generations (
        thread_id, org_id, user_id, reserved_cost_cents, reserved_tokens,
        started_at_ms, heartbeat_at_ms, updated_at_ms
      ) VALUES (${projectThread}, ${orgId}, ${userId}, 40, 100, ${now},
                ${now}, ${now})
    `;
    const capReached = await chatAdmission(projectThread);
    const outside = await chatAdmission(ownThread);
    const heldModelRequest = await reserveTurnBudget(sql, {
      organizationId: orgId,
      sessionId: opSession,
      execId: 'held',
      kind: 'model-api',
      defaultBudgetCents: 10,
      subject: {
        userId,
        agentSlug: '__direct_api__',
        projectIds: [projectId],
      },
      whole: { prospectiveTokens: 10 },
    });
    record(
      'project budgets: a project’s cap refuses work in it once spent — counting the turns in flight — and binds nothing outside it',
      projectThread !== '' &&
        ownThread !== '' &&
        roomLeft === 'admitted' &&
        capReached === 'project' &&
        outside === 'admitted' &&
        !heldModelRequest.allowed,
      `project thread=${roomLeft} then ${capReached} (want admitted then project), own thread=${outside} (want admitted), model request at the cap=${heldModelRequest.allowed ? 'admitted' : 'refused'} (want refused)`,
    );

    // The turn ends: a model request in the project fits again, stamps its
    // project, and its hold counts toward the project.
    await sql`DELETE FROM app.generations WHERE thread_id = ${projectThread}`;
    const admitted = await reserveTurnBudget(sql, {
      organizationId: orgId,
      sessionId: opSession,
      execId: 'admitted',
      kind: 'model-api',
      defaultBudgetCents: 10,
      subject: {
        userId,
        agentSlug: '__direct_api__',
        projectIds: [projectId],
      },
      whole: { prospectiveTokens: 10 },
    });
    const stamp = await sql<{ projectIds: string[] | null }[]>`
      SELECT project_ids AS "projectIds" FROM app.sandbox_session_ops
      WHERE session_id = ${opSession} AND exec_id = 'admitted'
    `;
    const holds = await readInFlightReservations(sql, {
      organizationId: orgId,
      userId,
      userTeamIds: [],
      projectIds: [projectId],
    });
    const projectHold = holds.projects?.[projectId];
    // Taken out of the project and filed back: the branch follows each
    // move, so a turn on it spends where the conversation is.
    const out = await refile(null);
    const back = await refile(projectId);
    record(
      'project budgets: refiling a conversation moves its hidden branches with it',
      out.every((id) => id === null) && back.every((id) => id === projectId),
      `out=${JSON.stringify(out)} (want both null), back=${JSON.stringify(back)} (want both the project)`,
    );
    record(
      'project budgets: a model request in a project stamps its project, and its hold counts toward the project',
      admitted.allowed &&
        JSON.stringify(stamp[0]?.projectIds) === JSON.stringify([projectId]) &&
        projectHold?.costCents === 10 &&
        projectHold.requests === 1,
      `admitted=${admitted.allowed}, stamp=${JSON.stringify(stamp[0]?.projectIds)} (want the project), project hold=${JSON.stringify(projectHold)} (want 10 cents, 1 request)`,
    );

    // An automation bound to this project and a second one: a run a
    // schedule starts names neither, so it acts — and spends — in both.
    const [second] = await sql<{ id: string }[]>`
      INSERT INTO app.projects (
        org_id, name, key, team_ids, team_id, shared_with_team_ids,
        created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${`Budget ${suffix} two`}, ${`PC${suffix.slice(0, 4)}`},
        ${[]}, ${null}, ${[]}, ${userId}, ${now}, ${now}
      )
      RETURNING id
    `;
    secondProjectId = second?.id ?? '';
    for (const bound of [projectId, secondProjectId]) {
      await sql`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_at_ms, bound_by
        ) VALUES (${orgId}, ${automationName}, ${bound}, ${now}, ${userId})
      `;
    }
    // A run written as the engine does, under its writer protocol.
    const [run] = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, status, mode, started_by, input, checkpoints,
          wake_at_ms, claim_epoch, lease_epoch, lease_expires_at_ms, started_at_ms
        ) VALUES (
          ${orgId}, ${automationName}, 1, 'running', 'live', 'trigger:itest',
          ${sql.json({})}, ${sql.json({ nodes: {}, executions: 0 })},
          ${null}, 1, 1, ${now + 3_600_000}, ${now}
        ) RETURNING id
      `;
    });
    runId = run?.id ?? '';
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, status, owner_type, owner_id, created_by,
        pinned, created_at_ms, expires_at_ms
      ) VALUES (
        ${orgId}, ${runSession}, 'active', 'workflow_run', ${runId},
        'itest', false, ${now}, ${now + 3_600_000}
      )
    `;
    const turn = await reserveTurnBudget(sql, {
      organizationId: orgId,
      sessionId: runSession,
      execId: 'step',
      kind: 'workflow-agent',
      defaultBudgetCents: 10,
    });
    const runStamp = await sql<{ projectIds: string[] | null }[]>`
      SELECT project_ids AS "projectIds" FROM app.sandbox_session_ops
      WHERE session_id = ${runSession} AND exec_id = 'step'
    `;
    const secondHolds = await readInFlightReservations(sql, {
      organizationId: orgId,
      userId: '__automation__',
      userTeamIds: [],
      projectIds: [secondProjectId],
    });
    await settleSessionOpSpend(sql, {
      sessionId: runSession,
      execId: 'step',
      spentCents: 7,
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    const booked = await sql<{ projectId: string; cost: number }[]>`
      SELECT project_id AS "projectId", cost_estimate_cents::float8 AS cost
      FROM app.project_usage
      WHERE org_id = ${orgId} AND granularity = 'monthly'
        AND project_id = ANY(${[projectId, secondProjectId]})
    `;
    const costOf = (id: string): number | undefined =>
      booked.find((row) => row.projectId === id)?.cost;
    record(
      'project budgets: a scheduled run of an automation bound to two projects holds and books in both',
      turn.allowed &&
        JSON.stringify(runStamp[0]?.projectIds) ===
          JSON.stringify([projectId, secondProjectId].toSorted()) &&
        secondHolds.projects?.[secondProjectId]?.costCents === 10 &&
        costOf(projectId) === 67 &&
        costOf(secondProjectId) === 7,
      `admitted=${turn.allowed}, stamp=${JSON.stringify(runStamp[0]?.projectIds)} (want both projects), second project's hold=${JSON.stringify(secondHolds.projects?.[secondProjectId])} (want 10 cents), booked=${JSON.stringify(booked)} (want 60+7 and 7)`,
    );

    // The run's llm steps are its spend too: each call is measured against
    // both projects' caps, and booked to both beside the ledger, under the
    // automation subject and the automation's name.
    const stepModel = `itest-model-${suffix}`;
    const attemptFor = (nodeId: string) => ({
      nodeId,
      itemIndex: 0,
      pass: 0,
      attempt: 1,
    });
    for (const node of [
      'llm-one',
      'llm-two',
      'llm-capped',
      'llm-unknown',
      'llm-crashed',
    ]) {
      await sql`
        INSERT INTO app.automation_node_attempts
          (org_id, run_id, node_id, kind, node_type, status, claim_epoch, started_at_ms)
        VALUES (${orgId}, ${runId}, ${node}, 'llm', 'llm', 'started', 1, ${now})
      `;
    }
    const reservation = (nodeId: string) => ({
      organizationId: orgId,
      runId,
      attempt: attemptFor(nodeId),
      provider: 'itest',
      model: stepModel,
      reserveCents: 20,
      reserveTokens: 50,
    });
    llmSession = llmStepOp(reservation('llm-one')).sessionId;
    // Both calls would fit settled usage alone; only one fits the actual
    // headroom once both the earlier model hold and the first LLM hold count.
    const competing = await Promise.all([
      reserveLlmStepBudget(sql, reservation('llm-one')),
      reserveLlmStepBudget(sql, reservation('llm-two')),
    ]);
    const beforeCap = competing.find((result) => result.allowed);
    record(
      'project budgets: distinct direct LLM attempts serialize whole holds before a provider call',
      competing.filter((result) => result.allowed).length === 1,
      JSON.stringify(competing),
    );
    if (beforeCap === undefined || !beforeCap.allowed)
      throw new Error('No direct LLM fixture admitted');
    await sql`DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${automationName} AND project_id = ${secondProjectId}`;
    const heldAfterUnbind = await readInFlightReservations(sql, {
      organizationId: orgId,
      userId: '__automation__',
      userTeamIds: [],
      projectIds: [secondProjectId],
    });
    record(
      'project budgets: a direct LLM hold retains the project unbound during the call',
      heldAfterUnbind.projects?.[secondProjectId]?.costCents === 20,
      JSON.stringify(heldAfterUnbind.projects),
    );
    await recordLlmStepUsage(sql, {
      organizationId: orgId,
      sessionId: beforeCap.sessionId,
      execId: beforeCap.execId,
      usage: { inputTokens: 40, outputTokens: 10, cents: 0 },
    });
    // Repeated delivery is idempotent; live bindings do not redirect spend.
    await recordLlmStepUsage(sql, {
      organizationId: orgId,
      sessionId: beforeCap.sessionId,
      execId: beforeCap.execId,
      usage: { inputTokens: 40, outputTokens: 10, cents: 0 },
    });
    await sql`INSERT INTO app.automation_project_bindings
      (org_id, automation_name, project_id, bound_at_ms, bound_by)
      VALUES (${orgId}, ${automationName}, ${secondProjectId}, ${now}, ${userId})`;
    const stepBuckets = await sql<
      { projectId: string; tokens: number; requests: number }[]
    >`
      SELECT project_id AS "projectId", total_tokens::float8 AS tokens,
             request_count::float8 AS requests
      FROM app.project_usage
      WHERE org_id = ${orgId} AND granularity = 'monthly'
        AND project_id = ANY(${[projectId, secondProjectId]})
    `;
    const stepLedger = await sql<{ userId: string; tokens: number }[]>`
      SELECT user_id AS "userId", total_tokens::float8 AS tokens
      FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${automationName}
        AND model = ${stepModel} AND granularity = 'monthly'
    `;
    const secondBucket = stepBuckets.find(
      (row) => row.projectId === secondProjectId,
    );
    // The second project's requests are its cap now: the next step is
    // refused, naming the project's cap.
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${secondProjectId}`,
        '    period: monthly',
        `    maxRequests: ${secondBucket?.requests ?? 0}`,
      ].join('\n'),
    );
    clearOrgConfigCaches();
    const atCap = await reserveLlmStepBudget(sql, reservation('llm-capped'));
    record(
      'project budgets: an automation’s llm step is measured against, and booked to, every project its run is in',
      beforeCap.allowed &&
        stepBuckets.length === 2 &&
        stepBuckets.find((row) => row.projectId === projectId)?.tokens === 72 &&
        secondBucket?.tokens === 57 &&
        secondBucket.requests === 2 &&
        stepLedger.length === 1 &&
        stepLedger[0]?.userId === '__automation__' &&
        stepLedger[0].tokens === 50 &&
        !atCap.allowed &&
        atCap.violation?.scope === 'project' &&
        atCap.violation.projectId === secondProjectId &&
        atCap.violation.code === 'REQUEST_LIMIT' &&
        atCap.violation.period === 'monthly' &&
        atCap.violation.used === 2 &&
        atCap.violation.limit === 2,
      `before the cap=${JSON.stringify(beforeCap)} (want allowed), buckets=${JSON.stringify(stepBuckets)} (want 15+7+50 and 7+50 tokens, the second at 2 requests), ledger=${JSON.stringify(stepLedger)} (want 50 tokens under __automation__), at the cap=${JSON.stringify(atCap)} (want refused for the project's request limit)`,
    );
    await writeFile(
      budgetsFile,
      'enabled: true\nrules: []\nprojectRules: []\n',
    );
    clearOrgConfigCaches();
    const unknown = await reserveLlmStepBudget(sql, {
      ...reservation('llm-unknown'),
      reserveCents: 2,
      reserveTokens: 123,
    });
    if (!unknown.allowed)
      throw new Error('Unknown-outcome fixture was refused');
    await sql`UPDATE app.sandbox_session_ops SET started_at_ms = ${Date.now() - 180_001}
      WHERE org_id = ${orgId} AND session_id = ${unknown.sessionId} AND exec_id = ${unknown.execId}`;
    await recordLlmStepUsage(sql, {
      organizationId: orgId,
      sessionId: unknown.sessionId,
      execId: unknown.execId,
      usage: null,
    });
    const unknownFacts = await sql<
      {
        expected: number | null;
        floor: number;
        spent: number;
        settled: boolean;
      }[]
    >`
      SELECT expected_cents AS expected, floor_cents AS floor, spent_cents AS spent,
        spend_settled_at_ms IS NOT NULL AS settled FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ${unknown.sessionId} AND exec_id = ${unknown.execId}`;
    record(
      'project budgets: unknown direct LLM outcome settles its durable reserved estimate, never no-key zero',
      unknownFacts[0]?.expected === null &&
        unknownFacts[0]?.floor === 2 &&
        unknownFacts[0]?.spent === 2 &&
        unknownFacts[0] !== undefined &&
        unknownFacts[0].settled,
      JSON.stringify(unknownFacts),
    );

    // A process can disappear after dispatch without saving terminal facts.
    // The ordinary watchdog must find that running op and settle it once.
    const crashedModel = `${stepModel}-crashed`;
    const crashed = await reserveLlmStepBudget(sql, {
      ...reservation('llm-crashed'),
      model: crashedModel,
      reserveCents: 3,
      reserveTokens: 29,
    });
    if (!crashed.allowed) throw new Error('Crash fixture was refused');
    const beforeCrash = await sql<{ running: boolean }[]>`
      SELECT status = 'running' AND finalized_at_ms IS NULL
        AND spend_settled_at_ms IS NULL AS running
      FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ${crashed.sessionId} AND exec_id = ${crashed.execId}`;
    const readCrashProjects = () => sql<{ projectId: string; cost: number }[]>`
      SELECT project_id AS "projectId", cost_estimate_cents::float8 AS cost
      FROM app.project_usage WHERE org_id = ${orgId} AND granularity = 'monthly'
        AND project_id = ANY(${[projectId, secondProjectId]}) ORDER BY project_id`;
    const beforeCrashProjects = await readCrashProjects();
    await sql`DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${automationName} AND project_id = ${secondProjectId}`;
    await sql`UPDATE app.sandbox_session_ops SET started_at_ms = ${Date.now() - 180_001}
      WHERE org_id = ${orgId} AND session_id = ${crashed.sessionId} AND exec_id = ${crashed.execId}`;
    await reconcilePendingSessionOpKeys(sql, { batch: 100, now: Date.now() });
    const crashFacts = await sql<
      {
        projectIds: string[] | null;
        failed: boolean;
        finalized: boolean;
        expected: number | null;
        floor: number;
        spent: number;
        settled: boolean;
      }[]
    >`
      SELECT project_ids AS "projectIds", status = 'failed' AS failed,
        finalized_at_ms IS NOT NULL AS finalized, expected_cents AS expected,
        floor_cents AS floor, spent_cents AS spent,
        spend_settled_at_ms IS NOT NULL AS settled FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ${crashed.sessionId} AND exec_id = ${crashed.execId}`;
    const afterCrashProjects = await readCrashProjects();
    await reconcilePendingSessionOpKeys(sql, { batch: 100, now: Date.now() });
    const afterRepeatedSweep = await readCrashProjects();
    const crashLedger = await sql<
      { cost: number; tokens: number; requests: number }[]
    >`
      SELECT cost_estimate_cents::float8 AS cost, total_tokens::float8 AS tokens,
        request_count::float8 AS requests FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${automationName}
        AND model = ${crashedModel} AND granularity = 'monthly'`;
    record(
      'project budgets: the ordinary sweep recovers a never-finalized direct LLM op once in its original projects',
      beforeCrash[0] !== undefined &&
        beforeCrash[0].running &&
        crashFacts[0] !== undefined &&
        JSON.stringify(crashFacts[0]?.projectIds) ===
          JSON.stringify([projectId, secondProjectId].toSorted()) &&
        crashFacts[0].failed &&
        crashFacts[0].finalized &&
        crashFacts[0]?.expected === null &&
        crashFacts[0]?.floor === 3 &&
        crashFacts[0]?.spent === 3 &&
        crashFacts[0].settled &&
        beforeCrashProjects.length === 2 &&
        afterCrashProjects.length === 2 &&
        afterCrashProjects.every(
          (row) =>
            row.cost ===
            (beforeCrashProjects.find(
              (prior) => prior.projectId === row.projectId,
            )?.cost ?? -1) +
              3,
        ) &&
        JSON.stringify(afterCrashProjects) ===
          JSON.stringify(afterRepeatedSweep) &&
        crashLedger.length === 1 &&
        crashLedger[0]?.cost === 3 &&
        crashLedger[0]?.tokens === 29 &&
        crashLedger[0]?.requests === 1,
      JSON.stringify({
        beforeCrash,
        crashFacts,
        beforeCrashProjects,
        afterCrashProjects,
        afterRepeatedSweep,
        crashLedger,
      }),
    );

    // Refiling through a hidden sibling must end the root's old audience.
    // The second member can access B, but not this conversation until the
    // owner explicitly shares the canonical root again after the move.
    await sql`INSERT INTO "user" ("id", "email", "name", "emailVerified", "createdAt", "updatedAt")
      VALUES (${projectReaderId}, ${`itest-budget-reader-${suffix}@example.test`}, 'Budget project reader', true, now(), now())`;
    await sql`INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${randomUUID()}, ${orgId}, ${projectReaderId}, 'member', now())`;
    await setThreadSharedWithProject(
      sql,
      { organizationId: orgId, userId },
      projectThread,
      true,
    );
    const beforeRefile = await loadProjectSharedThread(
      sql,
      orgId,
      projectReaderId,
      projectThread,
    );
    const targetAccess = await projectChatAccess(sql, {
      organizationId: orgId,
      userId: projectReaderId,
      projectId: secondProjectId,
    });
    const refileBranch = await fetch(
      `${base}/api/app/chat/threads/${branchThread}/project?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ projectId: secondProjectId }),
      },
    );
    const movedLineage = await sql<
      { threadId: string; projectId: string; shared: boolean | null }[]
    >`
      SELECT thread_id AS "threadId", project_id AS "projectId", shared_with_project AS shared
      FROM app.thread_metadata WHERE org_id = ${orgId}
        AND thread_id = ANY(${[projectThread, branchThread]})`;
    const beforeReshare = await loadProjectSharedThread(
      sql,
      orgId,
      projectReaderId,
      projectThread,
    );
    await setThreadSharedWithProject(
      sql,
      { organizationId: orgId, userId },
      projectThread,
      true,
    );
    const afterReshare = await loadProjectSharedThread(
      sql,
      orgId,
      projectReaderId,
      projectThread,
    );
    record(
      'project budgets: refiling through a hidden branch ends the original project share until the root is explicitly shared again',
      beforeRefile?.id === projectThread &&
        targetAccess === 'ok' &&
        refileBranch.ok &&
        movedLineage.length === 2 &&
        movedLineage.every(
          (row) =>
            row.projectId === secondProjectId &&
            row.shared !== null &&
            !row.shared,
        ) &&
        beforeReshare === null &&
        afterReshare?.id === projectThread &&
        afterReshare.projectId === secondProjectId,
      JSON.stringify({
        beforeRefile: beforeRefile?.id,
        targetAccess,
        status: refileBranch.status,
        movedLineage,
        beforeReshare: beforeReshare?.id,
        afterReshare: afterReshare?.id,
      }),
    );

    // A producer is retired before its ops lose identity. A provider result
    // arriving after erasure must use the preserved op's pseudonym, not
    // recreate personal usage. Use the isolated reader created above.
    const [erasureRun] = await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, status, mode, started_by, input, checkpoints,
          wake_at_ms, claim_epoch, lease_epoch, lease_expires_at_ms, started_at_ms
        ) VALUES (
          ${orgId}, ${erasureAutomation}, 1, 'running', 'live', ${`user:${projectReaderId}`},
          ${sql.json({})}, ${sql.json({ nodes: {}, executions: 0 })},
          ${null}, 1, 1, ${Date.now() + 3_600_000}, ${Date.now()}
        ) RETURNING id
      `;
    });
    erasureRunId = erasureRun?.id ?? '';
    for (const node of [
      'erasure-settled',
      'erasure-pending',
      'erasure-too-late',
    ]) {
      await sql`
        INSERT INTO app.automation_node_attempts
          (org_id, run_id, node_id, kind, node_type, status, claim_epoch, started_at_ms)
        VALUES (${orgId}, ${erasureRunId}, ${node}, 'llm', 'llm', 'started', 1, ${Date.now()})
      `;
    }
    const erasureReservation = (nodeId: string) => ({
      organizationId: orgId,
      runId: erasureRunId,
      attempt: attemptFor(nodeId),
      provider: 'itest',
      model: `erasure-${suffix}`,
      reserveCents: 2,
      reserveTokens: 20,
    });
    const settledRequest = await reserveLlmStepBudget(
      sql,
      erasureReservation('erasure-settled'),
    );
    const pendingRequest = await reserveLlmStepBudget(
      sql,
      erasureReservation('erasure-pending'),
    );
    if (!settledRequest.allowed || !pendingRequest.allowed)
      throw new Error('Erasure direct LLM fixture was not admitted');
    erasureSession = pendingRequest.sessionId;
    await recordLlmStepUsage(sql, {
      organizationId: orgId,
      sessionId: settledRequest.sessionId,
      execId: settledRequest.execId,
      usage: { inputTokens: 8, outputTokens: 2, cents: 1 },
    });
    await sql`
      INSERT INTO app.gdpr_erasure_requests (id, org_id, target_user_id, reason,
        reason_code, requested_by, requested_at_ms, sla_deadline_at_ms, status)
      VALUES (${erasureRequestId}, ${orgId}, ${projectReaderId}, 'Direct model settlement regression',
        'consent_withdrawn', ${userId}, ${Date.now()}, ${Date.now() + 86_400_000}, 'pending')
    `;
    await processErasure(sql, erasureRequestId);
    const afterErasure = await sql<
      { execId: string; userId: string; settled: boolean }[]
    >`
      SELECT exec_id AS "execId", user_id AS "userId", spend_settled_at_ms IS NOT NULL AS settled
      FROM app.sandbox_session_ops WHERE org_id = ${orgId} AND session_id = ${erasureSession}
    `;
    const [erasureReceipt] = await sql<
      {
        status: string;
        counts: { modelApiRequests?: number; automationRuns?: number };
      }[]
    >`
      SELECT status, counts FROM app.gdpr_erasure_requests WHERE id = ${erasureRequestId}
    `;
    let retiredAdmissionRefused = false;
    try {
      await reserveLlmStepBudget(sql, erasureReservation('erasure-too-late'));
    } catch (error) {
      retiredAdmissionRefused =
        error instanceof Error &&
        error.message === 'The LLM effect attempt is no longer current';
    }
    const lateUsage = {
      organizationId: orgId,
      sessionId: pendingRequest.sessionId,
      execId: pendingRequest.execId,
      usage: { inputTokens: 12, outputTokens: 3, cents: 2 },
    };
    await recordLlmStepUsage(sql, lateUsage);
    await recordLlmStepUsage(sql, lateUsage);
    const afterLateSettlement = await sql<
      { userId: string; cost: number; requests: number }[]
    >`
      SELECT user_id AS "userId", cost_estimate_cents::float8 AS cost, request_count::int AS requests
      FROM app.usage_ledger WHERE org_id = ${orgId} AND granularity = 'monthly'
        AND agent_slug = ${erasureAutomation}
    `;
    const [personalUsage] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.usage_ledger
      WHERE org_id = ${orgId} AND user_id = ANY(${[projectReaderId, `user:${projectReaderId}`, `api-key:${projectReaderId}`]})
    `;
    record(
      'project budgets: erasure retires direct LLM producers and late settlement books once only under the erased-user pseudonym',
      erasureReceipt?.status === 'done' &&
        erasureReceipt.counts.modelApiRequests === 2 &&
        erasureReceipt.counts.automationRuns === 1 &&
        afterErasure.length === 1 &&
        afterErasure[0]?.execId === pendingRequest.execId &&
        afterErasure[0]?.userId === 'erased-user' &&
        afterErasure[0] !== undefined &&
        !afterErasure[0].settled &&
        retiredAdmissionRefused &&
        personalUsage?.count === 0 &&
        afterLateSettlement.length === 1 &&
        afterLateSettlement[0]?.userId === 'erased-user' &&
        afterLateSettlement[0]?.cost === 2 &&
        afterLateSettlement[0]?.requests === 1,
      JSON.stringify({
        erasureReceipt,
        afterErasure,
        retiredAdmissionRefused,
        personalUsage,
        afterLateSettlement,
      }),
    );

    // Work holds only while a cap binds it, and the lane above left none:
    // a cap on the project again, far above anything spent here, so the
    // holds below are taken and nothing is refused.
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        '    maxCostCents: 1000000',
      ].join('\n'),
    );
    clearOrgConfigCaches();

    // The other holds, on the real schema: a direct call past its deadline
    // stops holding, and is still booked when it ends; a reply's later round
    // raises its hold.
    const inProject = {
      organizationId: orgId,
      userId,
      userTeamIds: [],
      projectIds: [projectId],
    };
    const heldInProject = async (): Promise<number> =>
      (await readInFlightReservations(sql, inProject)).projects?.[projectId]
        ?.costCents ?? 0;
    const baseline = await heldInProject();

    const directSlug = `itest-direct-${suffix}`;
    const lost = await openDirectCall(sql, {
      organizationId: orgId,
      lane: 'itest',
      subject: { userId, agentSlug: directSlug, projectIds: [projectId] },
      worstCase: { cents: 5, tokens: 10 },
      // Already past its deadline: its process "died" at once.
      maxDurationMs: -1_000,
    });
    const whileDirect = await heldInProject();
    const released = await releaseStaleDirectCalls(sql);
    const afterRelease = await heldInProject();
    if (lost.allowed) {
      await settleDirectCall(sql, lost.lease, {
        provider: 'itest',
        model: `itest-model-${suffix}`,
        inputTokens: 4,
        outputTokens: 2,
        costCents: 1.5,
      });
    }
    const lateBooking = await sql<{ cost: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${directSlug}
        AND granularity = 'monthly'
    `;

    await sql`
      INSERT INTO app.generations (
        thread_id, org_id, user_id, project_ids, reserved_cost_cents,
        reserved_tokens, started_at_ms, heartbeat_at_ms, updated_at_ms
      ) VALUES (${projectThread}, ${orgId}, ${userId}, ${[projectId]}, 0, 0,
                ${now}, ${now}, ${now})
    `;
    const beforeRound = await heldInProject();
    await createPgTurnStore(sql).holdNextRound?.({
      organizationId: orgId,
      threadId: projectThread,
      tokens: 100,
      costCents: 4,
    });
    const afterRound = await heldInProject();
    await sql`DELETE FROM app.generations WHERE thread_id = ${projectThread}`;
    record(
      'project budgets: a direct call and a reply’s later round hold in the project, and a lost direct call stops holding',
      lost.allowed &&
        whileDirect - baseline === 5 &&
        released >= 1 &&
        afterRelease === baseline &&
        lateBooking[0]?.cost === 1.5 &&
        afterRound - beforeRound === 4,
      `direct call held ${whileDirect - baseline} (want 5), released=${released} then ${afterRelease - baseline} (want ≥1 then 0), late booking=${JSON.stringify(lateBooking)} (want 1.5 cents), next round raised the reply's hold by ${afterRound - beforeRound} (want 4)`,
    );

    // A recording added to the project's chat: its transcription is its
    // uploader's spend and the project's, held at its whole length (ten
    // minutes at 0.6¢ a minute) while it runs and booked at the minutes the
    // provider transcribed.
    const recording = `s3:itest/recording-${suffix}`;
    // Added to the project's new chat, before its thread exists: the
    // composer named the project when it registered the file (0158). A
    // second recording claims a thread its uploader does not own, which
    // names no project; a third was removed before its transcription.
    const strangerRecording = `s3:itest/recording-stranger-${suffix}`;
    const removedRecording = `s3:itest/recording-removed-${suffix}`;
    await sql`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, uploaded_by,
        thread_id, project_id, transcription_status, created_at_ms
      ) VALUES
        (${orgId}, ${recording}, 'call.m4a', 'audio/mp4', 1, ${userId},
         NULL, ${projectId}, 'queued', ${now}),
        (${orgId}, ${strangerRecording}, 'call.m4a', 'audio/mp4', 1,
         ${`itest-stranger-${suffix}`}, ${projectThread}, NULL, 'queued',
         ${now}),
        (${orgId}, ${removedRecording}, 'call.m4a', 'audio/mp4', 1, ${userId},
         NULL, ${projectId}, 'skipped', ${now})
    `;
    const transcriptionSubject = await uploadTranscriptionSubject(sql, {
      organizationId: orgId,
      storageId: recording,
    });
    const strangerSubject = await uploadTranscriptionSubject(sql, {
      organizationId: orgId,
      storageId: strangerRecording,
    });
    const removedSubject = await uploadTranscriptionSubject(sql, {
      organizationId: orgId,
      storageId: removedRecording,
    });
    const whisper = {
      organizationId: orgId,
      provider: 'itest',
      model: `itest-whisper-${suffix}`,
      centsPerAudioMinute: 0.6,
    };
    const beforeTranscription = await heldInProject();
    const transcription = await openTranscriptionCall(sql, {
      ...whisper,
      subject: transcriptionSubject ?? {
        userId: '__automation__',
        agentSlug: '__transcription__',
      },
      audioDurationSec: 600,
    });
    const whileTranscribing = await heldInProject();
    if (transcription.allowed) {
      await settleTranscriptionCall(sql, {
        ...whisper,
        lease: transcription.lease,
        audioDurationSec: 88,
      });
    }
    const afterTranscription = await heldInProject();
    const transcriptionBooked = await sql<
      { userId: string; cost: number; seconds: number }[]
    >`
      SELECT user_id AS "userId", cost_estimate_cents::float8 AS cost,
             audio_duration_sec::float8 AS seconds
      FROM app.usage_ledger
      WHERE org_id = ${orgId} AND model = ${whisper.model}
        AND agent_slug = '__transcription__' AND granularity = 'monthly'
    `;
    record(
      'project budgets: a recording’s transcription is held in its chat’s project at its whole length and booked under its uploader',
      transcriptionSubject?.userId === userId &&
        transcriptionSubject.projectIds?.[0] === projectId &&
        strangerSubject !== null &&
        strangerSubject.projectIds === undefined &&
        // The stranger is no member: the recording is no person's spend.
        strangerSubject.userId === '__automation__' &&
        removedSubject === null &&
        transcription.allowed &&
        whileTranscribing - beforeTranscription === 6 &&
        afterTranscription === beforeTranscription &&
        transcriptionBooked.length === 1 &&
        transcriptionBooked[0]?.userId === userId &&
        Math.abs((transcriptionBooked[0]?.cost ?? 0) - 0.88) < 1e-9 &&
        transcriptionBooked[0]?.seconds === 88,
      `subject=${JSON.stringify(transcriptionSubject)} (want the uploader in the project) stranger=${JSON.stringify(strangerSubject)} (want no project, booked to __automation__ — its uploader is no member) removed=${JSON.stringify(removedSubject)} (want null) held ${whileTranscribing - beforeTranscription} then ${afterTranscription - beforeTranscription} (want 6 then 0) booked=${JSON.stringify(transcriptionBooked)} (want 0.88 cents, 88 s, the uploader)`,
    );

    // A subscription turn costs nothing per call: the project's spent cost
    // cap cannot refuse it. It holds one request at no cost while it runs,
    // and is booked as that request, with its tokens, once it ends. Last in
    // the lane: its booking lands in the project's buckets, which the checks
    // above read to the token.
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        '    maxCostCents: 1',
      ].join('\n'),
    );
    clearOrgConfigCaches();
    const holdsInProject = async () =>
      (
        await readInFlightReservations(sql, {
          organizationId: orgId,
          userId,
          userTeamIds: [],
          projectIds: [projectId],
        })
      ).projects?.[projectId] ?? { costCents: 0, tokens: 0, requests: 0 };
    const beforeSubscription = await holdsInProject();
    const subscriptionTurn = await reserveTurnBudget(sql, {
      organizationId: orgId,
      sessionId: opSession,
      execId: 'subscription',
      kind: 'task-agent',
      defaultBudgetCents: 0,
      costFree: true,
      subject: {
        userId,
        agentSlug: 'itest-subscription-agent',
        projectIds: [projectId],
      },
    });
    const whileSubscription = await holdsInProject();
    await settleCostFreeTurn(sql, {
      sessionId: opSession,
      execId: 'subscription',
      usage: { inputTokens: 1_200, outputTokens: 300 },
    });
    // Settled once: a second call books nothing more.
    await settleCostFreeTurn(sql, {
      sessionId: opSession,
      execId: 'subscription',
    });
    const afterSubscription = await holdsInProject();
    const subscriptionBooked = await sql<
      { requests: number; cost: number; tokens: number }[]
    >`
      SELECT request_count::float8 AS requests,
             cost_estimate_cents::float8 AS cost,
             total_tokens::float8 AS tokens
      FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = 'itest-subscription-agent'
        AND granularity = 'monthly'
    `;
    record(
      'project budgets: a subscription turn is a request at no cost — a spent cost cap admits it, and it books once [GOV-R16]',
      subscriptionTurn.allowed &&
        subscriptionTurn.budgetCents === 0 &&
        whileSubscription.requests - beforeSubscription.requests === 1 &&
        whileSubscription.costCents === beforeSubscription.costCents &&
        afterSubscription.requests === beforeSubscription.requests &&
        subscriptionBooked.length === 1 &&
        subscriptionBooked[0]?.requests === 1 &&
        subscriptionBooked[0]?.cost === 0 &&
        subscriptionBooked[0]?.tokens === 1_500,
      `admitted=${JSON.stringify(subscriptionTurn)} (want allowed at 0 cents), project hold requests ${beforeSubscription.requests} → ${whileSubscription.requests} → ${afterSubscription.requests} (want +1 then back), cost ${beforeSubscription.costCents} → ${whileSubscription.costCents} (want unchanged), booked=${JSON.stringify(subscriptionBooked)} (want one request, 0 cents, 1500 tokens)`,
    );

    // A project's cap is part of the standing of whoever chats in it, named
    // by the project, and it can warn. Its rules live in a file of their
    // own; the budgets file's `projectRules` binds only while that file has
    // never been written.
    const [monthly] = await sql<{ requests: number }[]>`
      SELECT request_count::float8 AS requests FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${projectId}
        AND granularity = 'monthly'
        AND period_key = ${buildPeriodKeyFromTimestamp('monthly', Date.now())}
    `;
    const usedRequests = monthly?.requests ?? 0;
    const statusIn = async (withProject: boolean) => {
      const response = await fetch(
        `${base}/api/app/governance/my/budget-status?orgId=${orgId}${withProject ? `&projectId=${projectId}` : ''}`,
        { headers: { cookie: ctx.cookie, origin: base } },
      );
      const parsed = budgetStatusSchema.safeParse(
        await response.json().catch(() => null),
      );
      return parsed.success ? parsed.data.status : undefined;
    };
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        `    maxRequests: ${usedRequests}`,
      ].join('\n'),
    );
    clearOrgConfigCaches();
    const legacyReached = await statusIn(true);
    const legacyElsewhere = await statusIn(false);
    await writeFile(
      projectBudgetsFile,
      [
        'rules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        `    maxRequests: ${usedRequests + 10}`,
        '    warningThresholdPercent: 1',
      ].join('\n'),
    );
    clearOrgConfigCaches();
    const warned = await statusIn(true);
    const saved = await fetch(
      `${base}/api/app/governance/policies/project_budgets?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ config: { rules: [] } }),
      },
    );
    clearOrgConfigCaches();
    const emptied = await statusIn(true);
    const audited = await sql<{ action: string }[]>`
      SELECT action FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'governance_policy'
        AND resource_id = 'project_budgets'
      ORDER BY ts DESC LIMIT 1
    `;
    const projectWarning = warned?.warnings?.find(
      (warning) => warning.scope === 'project',
    );
    record(
      'project budgets: a project’s cap warns whoever chats in it by name, from a file of its own that outranks the budgets file’s copy [GOV-R6]',
      usedRequests >= 1 &&
        legacyReached?.exceeded === true &&
        legacyReached.scope === 'project' &&
        legacyReached.projectName === `Budget ${suffix}` &&
        legacyElsewhere === null &&
        warned?.exceeded === false &&
        projectWarning?.code === 'REQUEST_WARNING' &&
        projectWarning.projectId === projectId &&
        projectWarning.projectName === `Budget ${suffix}` &&
        saved.status === 200 &&
        emptied === null &&
        audited[0]?.action === 'governance_policy.updated',
      `project requests=${usedRequests} (want ≥1); budgets-file copy reached: ${JSON.stringify(legacyReached)} (want exceeded, scope project, named); outside the project: ${JSON.stringify(legacyElsewhere)} (want null); own file at a 1% threshold: ${JSON.stringify(warned)} (want a named project REQUEST_WARNING, not exceeded); saved empty → ${saved.status} (want 200), then ${JSON.stringify(emptied)} (want null: the emptied file outranks the copy); audit=${audited[0]?.action ?? 'none'} (want governance_policy.updated)`,
    );
  } finally {
    await unlink(budgetsFile).catch((error: unknown) => {
      console.warn('[itest] project budgets: budgets file not removed', error);
    });
    await unlink(projectBudgetsFile).catch((error: unknown) => {
      console.warn(
        '[itest] project budgets: project caps file not removed',
        error,
      );
    });
    clearOrgConfigCaches();
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ANY(${[opSession, runSession, llmSession, erasureSession]})
    `;
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId}
        AND (session_id = 'direct-call:itest'
          OR (session_id = 'direct-call:transcription'
              AND model_ref = ${`itest/itest-whisper-${suffix}`}))
    `;
    await sql`
      DELETE FROM app.file_metadata
      WHERE org_id = ${orgId}
        AND storage_ref = ANY(${[
          `s3:itest/recording-${suffix}`,
          `s3:itest/recording-stranger-${suffix}`,
          `s3:itest/recording-removed-${suffix}`,
        ]})
    `;
    await sql`
      DELETE FROM app.usage_ledger
      WHERE org_id = ${orgId} AND model = ${`itest-whisper-${suffix}`}
    `;
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ${runSession}
    `;
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      await fixtureTx`DELETE FROM app.automation_runs WHERE id = ANY(${[runId, erasureRunId]})`;
    });
    await sql`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${automationName}
    `;
    await sql`
      DELETE FROM app.threads
      WHERE id = ANY(${[projectThread, ownThread, branchThread].filter(
        (id) => id !== '',
      )})
    `;
    await sql`
      DELETE FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ANY(${[agentSlug, automationName, erasureAutomation, `itest-direct-${suffix}`, `itest-unheld-${suffix}`]})
    `;
    await sql`
      DELETE FROM app.project_usage
      WHERE org_id = ${orgId}
        AND project_id = ANY(${[projectId, secondProjectId]})
    `;
    await sql`
      DELETE FROM app.projects WHERE id = ANY(${[projectId, secondProjectId]})
    `;
    await sql`DELETE FROM app.gdpr_erasure_requests WHERE id = ${erasureRequestId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${orgId} AND "userId" = ${projectReaderId}`;
    await sql`DELETE FROM "user" WHERE "id" = ${projectReaderId}`;
  }
}
