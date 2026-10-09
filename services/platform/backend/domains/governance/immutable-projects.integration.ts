/** Real PostgreSQL and app-door proof that admission, holds and billing use
 * the same project set even when a conversation or automation is refiled. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { ChatBudgetExceededError } from '../chat/budget-admission.ts';
import { createPgTurnStore } from '../chat/store.ts';
import {
  admitImageGeneration,
  resolveImageTurnContext,
  settleImageGeneration,
} from '../sandbox/image-generation.ts';
import { settleSessionOpSpend } from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import { readInFlightReservations } from './budget-reservations.ts';

const threadSchema = z.object({ id: z.string() });

export async function checkImmutableBudgetProjects(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID();
  const now = Date.now();
  const automation = `itest/immutable-budget-${suffix}`;
  const sessionId = `wf-immutable-budget-${suffix}`;
  const emptySession = `model-api:immutable-budget-${suffix}`;
  const projects: string[] = [];
  const threads: string[] = [];
  let runId = '';
  const [org] = await sql<
    { slug: string }[]
  >`SELECT slug FROM "organization" WHERE id = ${orgId}`;
  if (org === undefined)
    throw new Error('Budget fixture organization is missing');
  const directory = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    org.slug,
    'governance',
  );
  const policy = path.join(directory, 'budgets.yml');
  let previous: string | undefined;
  try {
    previous = await readFile(policy, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const report = (name: string, ok: boolean, detail: unknown) =>
    record(`immutable budget projects: ${name}`, ok, JSON.stringify(detail));
  const project = async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO app.projects (org_id, name, team_ids, team_id, shared_with_team_ids, created_by, created_at_ms, updated_at_ms)
      VALUES (${orgId}, ${`Immutable budget ${suffix}`}, ${[]}, NULL, ${[]}, ${userId}, ${now}, ${now}) RETURNING id`;
    if (row === undefined) throw new Error('Budget fixture project missing');
    projects.push(row.id);
    return row.id;
  };
  const thread = async (projectId?: string) => {
    const response = await fetch(
      `${base}/api/app/chat/threads?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          cookie: ctx.cookie,
          origin: base,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...(projectId !== undefined ? { projectId } : {}),
          title: `Budget ${suffix}`,
        }),
      },
    );
    const parsed = threadSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success)
      throw new Error('Budget fixture thread refused');
    threads.push(parsed.data.id);
    return parsed.data.id;
  };
  const refile = async (threadId: string, projectId: string) => {
    const response = await fetch(
      `${base}/api/app/chat/threads/${threadId}/project?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          cookie: ctx.cookie,
          origin: base,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ projectId }),
      },
    );
    if (!response.ok)
      throw new Error(`Budget fixture refile refused: ${response.status}`);
  };
  const budget = async (projectId: string, maxCostCents: number) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      policy,
      [
        'enabled: true',
        'rules: []',
        'projectRules:',
        '  - scope: project',
        `    scopeId: ${projectId}`,
        '    period: monthly',
        `    maxCostCents: ${maxCostCents}`,
      ].join('\n'),
    );
    clearOrgConfigCaches();
  };
  const holds = () =>
    readInFlightReservations(sql, {
      organizationId: orgId,
      userId,
      userTeamIds: [],
      projectIds: projects,
    });
  const store = createPgTurnStore(sql);
  const open = (threadId: string, projectIds: string[], costCents: number) =>
    store.beginTurn({
      organizationId: orgId,
      threadId,
      userParts: [{ type: 'text', text: 'bounded budget fixture' }],
      spend: { userId, projectIds, tokens: 1, costCents },
    });
  try {
    const a = await project();
    const b = await project();
    const c = await project();
    const active = await thread(a);
    const next = await thread(b);
    const outside = await thread();
    await budget(a, 10);
    await open(active, [a], 10);
    await refile(active, b);
    const afterMove = await holds();
    let refused = false;
    try {
      await open(next, [a], 1);
    } catch (error) {
      if (
        error instanceof ChatBudgetExceededError &&
        error.data.projectId === a
      )
        refused = true;
      else throw error;
    }
    report(
      'refiling a live chat retains its original hold and refuses another captured-project admission',
      afterMove.projects?.[a]?.costCents === 10 &&
        afterMove.projects?.[b] === undefined &&
        refused,
      { afterMove, refused },
    );
    await store.endGeneration({ organizationId: orgId, threadId: active });
    await store.endGeneration({ organizationId: orgId, threadId: next });

    await open(outside, [], 2);
    await refile(outside, b);
    const empty = await holds();
    report(
      'a no-project chat keeps an authoritative empty stamp after refiling',
      projects.every((id) => empty.projects?.[id] === undefined),
      empty,
    );
    await store.endGeneration({ organizationId: orgId, threadId: outside });

    // A pre-upgrade writer can still insert its old column set. This proves
    // schema/read compatibility, not a historical binary or old-cost recall.
    await sql`INSERT INTO app.generations (thread_id, org_id, user_id, reserved_cost_cents, reserved_tokens, started_at_ms, heartbeat_at_ms, updated_at_ms)
      VALUES (${active}, ${orgId}, ${userId}, 3, 1, ${now}, ${now}, ${now})`;
    const legacy = await holds();
    report(
      'legacy unstamped generation rows retain current-thread fallback',
      legacy.projects?.[b]?.costCents === 3,
      legacy,
    );
    await store.endGeneration({ organizationId: orgId, threadId: active });

    await budget(a, 100);
    for (const id of [a, b])
      await sql`
      INSERT INTO app.automation_project_bindings (org_id, automation_name, project_id, bound_at_ms, bound_by)
      VALUES (${orgId}, ${automation}, ${id}, ${now}, ${userId})`;
    const [run] = await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      return tx<
        { id: string }[]
      >`INSERT INTO app.automation_runs (org_id, name, version, status, mode, started_by, input, checkpoints, wake_at_ms, claim_epoch, started_at_ms)
        VALUES (${orgId}, ${automation}, 1, 'running', 'live', 'trigger:itest', ${sql.json({})}, ${sql.json({ nodes: {}, executions: 0 })}, NULL, 1, ${now}) RETURNING id`;
    });
    if (run === undefined) throw new Error('Budget fixture run missing');
    runId = run.id;
    await sql`INSERT INTO app.sandbox_sessions (org_id, session_id, status, owner_type, owner_id, created_by, pinned, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${sessionId}, 'active', 'workflow_run', ${runId}, 'itest', false, ${now}, ${now + 3600000})`;
    const reservationArgs = {
      organizationId: orgId,
      sessionId,
      execId: 'step',
      kind: 'workflow-agent' as const,
      defaultBudgetCents: 50,
      modelRef: `itest/${automation}`,
    };
    const first = await reserveTurnBudget(sql, reservationArgs);
    await sql`DELETE FROM app.automation_project_bindings WHERE org_id = ${orgId} AND automation_name = ${automation}`;
    await sql`INSERT INTO app.automation_project_bindings (org_id, automation_name, project_id, bound_at_ms, bound_by)
      VALUES (${orgId}, ${automation}, ${c}, ${now}, ${userId})`;
    const repeated = await reserveTurnBudget(sql, reservationArgs);
    const context = await resolveImageTurnContext(sql, reservationArgs);
    const rebound = await holds();
    report(
      'managed retries and live image context retain the admitted automation projects after rebinding',
      first.allowed &&
        repeated.allowed &&
        context.status === 'live' &&
        JSON.stringify(context.subject.projectIds?.toSorted()) ===
          JSON.stringify([a, b].toSorted()) &&
        rebound.projects?.[a]?.costCents === 50 &&
        rebound.projects?.[b]?.costCents === 50 &&
        rebound.projects?.[c] === undefined,
      { first, repeated, context, rebound },
    );
    if (context.status !== 'live')
      throw new Error('Budget fixture image context ended');
    // Simulate context captured after a rebind: admission must refresh the
    // op's billing stamp under its lock, not trust that stale project list.
    const staleSubject = { ...context.subject, projectIds: [c] };
    const image = await admitImageGeneration(sql, {
      organizationId: orgId,
      sessionId,
      execId: 'step',
      subject: staleSubject,
      images: 1,
    });
    const duringImage = await holds();
    report(
      'image admission adds its hold to the same admitted projects',
      image.admitted &&
        duringImage.projects?.[a]?.costCents === 75 &&
        duringImage.projects?.[b]?.costCents === 75 &&
        duringImage.projects?.[c] === undefined,
      { image, duringImage },
    );
    if (!image.admitted) throw new Error('Budget fixture image refused');
    await settleImageGeneration(sql, {
      organizationId: orgId,
      sessionId,
      execId: 'step',
      callStartedAt: image.callStartedAt,
      subject: staleSubject,
      provider: 'itest',
      model: automation,
      charges: [7],
      timestamp: now,
    });
    await settleSessionOpSpend(sql, {
      sessionId,
      execId: 'step',
      spentCents: 3,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const booked = await sql<
      { projectId: string; cost: number }[]
    >`SELECT project_id AS "projectId", cost_estimate_cents::float8 AS cost FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ANY(${projects}) AND granularity = 'monthly'`;
    const after = await holds();
    report(
      'image and managed settlement replace the admitted holds with bills in exactly those projects',
      booked.length === 2 &&
        booked.every(
          (row) => [a, b].includes(row.projectId) && row.cost === 10,
        ) &&
        projects.every((id) => after.projects?.[id] === undefined),
      { booked, after },
    );

    const outsideArgs = {
      organizationId: orgId,
      sessionId: emptySession,
      execId: 'empty',
      kind: 'model-api' as const,
      defaultBudgetCents: 1,
      subject: { userId, agentSlug: automation, projectIds: [] as string[] },
      whole: { prospectiveTokens: 1 },
    };
    const emptyFirst = await reserveTurnBudget(sql, outsideArgs);
    const emptyRetry = await reserveTurnBudget(sql, {
      ...outsideArgs,
      subject: { ...outsideArgs.subject, projectIds: [c] },
    });
    await settleSessionOpSpend(sql, {
      sessionId: emptySession,
      execId: 'empty',
      spentCents: 1,
    });
    const noNewProject = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${c}`;
    report(
      'an explicit empty op stamp stays empty during retry and settlement',
      emptyFirst.allowed && emptyRetry.allowed && noNewProject[0]?.count === 0,
      { emptyFirst, emptyRetry, noNewProject },
    );
  } finally {
    if (previous === undefined)
      await unlink(policy).catch((error: unknown) => {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
      });
    else await writeFile(policy, previous);
    clearOrgConfigCaches();
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId} AND session_id = ANY(${[sessionId, emptySession]})`;
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId} AND session_id = ${sessionId}`;
    if (runId !== '')
      await sql.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`DELETE FROM app.automation_runs WHERE org_id = ${orgId} AND id = ${runId}`;
      });
    await sql`DELETE FROM app.automation_project_bindings WHERE org_id = ${orgId} AND automation_name = ${automation}`;
    await sql`DELETE FROM app.threads WHERE org_id = ${orgId} AND id = ANY(${threads})`;
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId} AND agent_slug = ${automation}`;
    await sql`DELETE FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${projects})`;
    await sql`DELETE FROM app.projects WHERE org_id = ${orgId} AND id = ANY(${projects})`;
  }
}
