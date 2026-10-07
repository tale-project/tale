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
  assertChatTurnBudget,
  ChatBudgetExceededError,
} from '../chat/budget-admission.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import { readInFlightReservations } from './budget-reservations.ts';
import { incrementUsageLedger } from './service.ts';

const createdSchema = z.object({ id: z.string() });

/**
 * A project's budget cap (`GOV-R14`, migration 0155): spend that names a
 * project lands in the project's own buckets beside the ledger; a chat turn
 * in one of its threads is admitted against the project's cap, counting the
 * turns in flight there; a model request in the project is held to it and
 * stamps the project on its op, whose hold then counts toward the project;
 * and nothing outside the project is bound by it.
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
      projectId,
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
      subject: { userId, agentSlug: '__direct_api__', projectId },
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
      subject: { userId, agentSlug: '__direct_api__', projectId },
      whole: { prospectiveTokens: 10 },
    });
    const stamp = await sql<{ projectId: string | null }[]>`
      SELECT project_id AS "projectId" FROM app.sandbox_session_ops
      WHERE session_id = ${opSession} AND exec_id = 'admitted'
    `;
    const holds = await readInFlightReservations(sql, {
      organizationId: orgId,
      userId,
      userTeamIds: [],
      projectId,
    });
    record(
      'project budgets: a model request in a project stamps its project, and its hold counts toward the project',
      admitted.allowed &&
        stamp[0]?.projectId === projectId &&
        holds.project?.costCents === 10 &&
        holds.project.requests === 1,
      `admitted=${admitted.allowed}, stamp=${stamp[0]?.projectId ?? 'none'} (want the project), project hold=${JSON.stringify(holds.project)} (want 10 cents, 1 request)`,
    );
  } finally {
    await unlink(budgetsFile).catch((error: unknown) => {
      console.warn('[itest] project budgets: budgets file not removed', error);
    });
    clearOrgConfigCaches();
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ${opSession}
    `;
    await sql`
      DELETE FROM app.threads
      WHERE id = ANY(${[projectThread, ownThread].filter((id) => id !== '')})
    `;
    await sql`
      DELETE FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${agentSlug}
    `;
    await sql`
      DELETE FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${projectId}
    `;
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
  }
}
