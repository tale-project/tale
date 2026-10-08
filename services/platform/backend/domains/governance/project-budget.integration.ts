/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import {
  openLlmStepCall,
  settleLlmStepCall,
} from '../automations/llm-metering.ts';
import {
  assertChatTurnBudget,
  ChatBudgetExceededError,
} from '../chat/budget-admission.ts';
import { createPgTurnStore } from '../chat/store.ts';
import {
  openTranscriptionCall,
  settleTranscriptionCall,
  uploadTranscriptionSubject,
} from '../files/transcription-metering.ts';
import { settleSessionOpSpend } from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import { readInFlightReservations } from './budget-reservations.ts';
import {
  openDirectCall,
  releaseStaleDirectCalls,
  settleDirectCall,
} from './direct-calls.ts';
import { incrementUsageLedger } from './service.ts';

const createdSchema = z.object({ id: z.string() });

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
  let runId = '';
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
          wake_at_ms, claim_epoch, started_at_ms
        ) VALUES (
          ${orgId}, ${automationName}, 1, 'running', 'live', 'trigger:itest',
          ${sql.json({})}, ${sql.json({ nodes: {}, executions: 0 })},
          ${null}, 1, ${now}
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

    // The run's llm steps are its spend too: each call holds its worst case
    // in both projects while it runs, then is booked to both beside the
    // ledger in the hold's place, under the automation subject and the
    // automation's name.
    const stepModel = `itest-model-${suffix}`;
    const stepCall = {
      organizationId: orgId,
      runId,
      automation: automationName,
      provider: 'itest',
      model: stepModel,
    };
    const bothProjects = {
      organizationId: orgId,
      userId: '__automation__',
      userTeamIds: [],
      projectIds: [projectId, secondProjectId],
    };
    const beforeCap = await openLlmStepCall(sql, {
      ...stepCall,
      promptTokens: 40,
      maxOutputTokens: 100,
    });
    const stepHolds = await readInFlightReservations(sql, bothProjects);
    if (beforeCap.allowed) {
      await settleLlmStepCall(sql, {
        ...stepCall,
        lease: beforeCap.lease,
        inputTokens: 40,
        outputTokens: 10,
      });
    }
    const settledHolds = await readInFlightReservations(sql, bothProjects);
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
    const atCap = await openLlmStepCall(sql, {
      ...stepCall,
      promptTokens: 40,
      maxOutputTokens: 100,
    });
    record(
      'project budgets: an automation’s llm step is held in, and booked to, every project its run is in',
      beforeCap.allowed &&
        JSON.stringify(stepHolds.projects?.[secondProjectId]) ===
          JSON.stringify({ costCents: 1, tokens: 140, requests: 1 }) &&
        settledHolds.projects?.[secondProjectId] === undefined &&
        stepBuckets.length === 2 &&
        stepBuckets.find((row) => row.projectId === projectId)?.tokens === 72 &&
        secondBucket?.tokens === 57 &&
        secondBucket.requests === 2 &&
        stepLedger.length === 1 &&
        stepLedger[0]?.userId === '__automation__' &&
        stepLedger[0].tokens === 50 &&
        !atCap.allowed &&
        atCap.reason.includes("This project's monthly request limit"),
      `before the cap=${JSON.stringify(beforeCap.allowed)} (want allowed), second project's hold while the call ran=${JSON.stringify(stepHolds.projects?.[secondProjectId])} (want 1 cent, 140 tokens, 1 request), after it=${JSON.stringify(settledHolds.projects?.[secondProjectId])} (want none), buckets=${JSON.stringify(stepBuckets)} (want 15+7+50 and 7+50 tokens, the second at 2 requests), ledger=${JSON.stringify(stepLedger)} (want 50 tokens under __automation__), at the cap=${JSON.stringify(atCap)} (want refused for the project's request limit)`,
    );

    // The other holds, on the real schema: a voice chunk being made holds
    // its estimate in the project's thread until it is ready; a direct call
    // past its deadline stops holding, and is still booked when it ends; a
    // reply's later round raises its hold.
    const inProject = {
      organizationId: orgId,
      userId,
      userTeamIds: [],
      projectIds: [projectId],
    };
    const heldInProject = async (): Promise<number> =>
      (await readInFlightReservations(sql, inProject)).projects?.[projectId]
        ?.costCents ?? 0;
    const chunkMessage = `itest-msg-${suffix}`;
    const baseline = await heldInProject();
    await sql`
      INSERT INTO app.tts_audio_chunks (
        org_id, thread_id, message_id, user_id, chunk_index, text, status,
        locale, created_at_ms, attempt_created_at_ms, reserved_cost_cents
      ) VALUES (
        ${orgId}, ${projectThread}, ${chunkMessage}, ${userId}, 0, 'Hello.',
        'pending', 'en', ${Date.now()}, ${Date.now()}, 3
      )
    `;
    const whileVoiced = await heldInProject();
    await sql`
      UPDATE app.tts_audio_chunks SET status = 'ready'
      WHERE message_id = ${chunkMessage}
    `;
    const afterVoiced = await heldInProject();

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
        thread_id, org_id, user_id, reserved_cost_cents, reserved_tokens,
        started_at_ms, heartbeat_at_ms, updated_at_ms
      ) VALUES (${projectThread}, ${orgId}, ${userId}, 0, 0, ${now}, ${now},
                ${now})
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
      'project budgets: a voice chunk, a direct call and a reply’s later round hold in the project, and a lost direct call stops holding',
      whileVoiced - baseline === 3 &&
        afterVoiced === baseline &&
        lost.allowed &&
        whileDirect - baseline === 5 &&
        released >= 1 &&
        afterRelease === baseline &&
        lateBooking[0]?.cost === 1.5 &&
        afterRound - beforeRound === 4,
      `voice chunk held ${whileVoiced - baseline} then ${afterVoiced - baseline} (want 3 then 0), direct call held ${whileDirect - baseline} (want 5), released=${released} then ${afterRelease - baseline} (want ≥1 then 0), late booking=${JSON.stringify(lateBooking)} (want 1.5 cents), next round raised the reply's hold by ${afterRound - beforeRound} (want 4)`,
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
  } finally {
    await unlink(budgetsFile).catch((error: unknown) => {
      console.warn('[itest] project budgets: budgets file not removed', error);
    });
    clearOrgConfigCaches();
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ANY(${[opSession, runSession]})
    `;
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId}
        AND ((session_id = 'direct-call:llm-step'
              AND agent_slug = ${automationName})
          OR session_id = 'direct-call:itest'
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
      DELETE FROM app.tts_audio_chunks
      WHERE org_id = ${orgId} AND message_id = ${`itest-msg-${suffix}`}
    `;
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ${runSession}
    `;
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      await fixtureTx`DELETE FROM app.automation_runs WHERE id = ${runId}`;
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
      WHERE org_id = ${orgId}
        AND agent_slug = ANY(${[agentSlug, automationName, `itest-direct-${suffix}`, `itest-unheld-${suffix}`]})
    `;
    await sql`
      DELETE FROM app.project_usage
      WHERE org_id = ${orgId}
        AND project_id = ANY(${[projectId, secondProjectId]})
    `;
    await sql`
      DELETE FROM app.projects WHERE id = ANY(${[projectId, secondProjectId]})
    `;
  }
}
