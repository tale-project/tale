/** Real PostgreSQL admission/settlement proof, with no provider invocation.
 * The normal integration harness owns outbound isolation and job execution.
 * Every row, policy change and synthetic blob key here is nonce-owned. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';
import { z } from 'zod';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { ChatBudgetExceededError } from '../chat/budget-admission.ts';
import { createPgTurnStore } from '../chat/store.ts';
import { readInFlightReservations } from '../governance/budget-reservations.ts';
import { settleSessionOpSpend } from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import {
  gcExpiredTtsChunks,
  markChunkReadyAndRecordUsage,
  reserveChunk,
  runTtsCleanup,
  runTtsWatchdog,
  TtsError,
} from './service.ts';

type Reserved = Extract<
  Awaited<ReturnType<typeof reserveChunk>>,
  { kind: 'reserved' }
>;
const threadResult = z.object({ id: z.string() });

export async function checkTtsBudgetReservations(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID();
  const { orgId, userId } = ctx;
  const now = Date.now();
  const model = `tts-budget-${suffix}`;
  const opSession = `model-api:tts-budget-${suffix}`;
  const messageId = `tts-budget-${suffix}`;
  const foreignOrg = `tts-budget-foreign-${suffix}`;
  const chunkIds = new Set<string>();
  const projects: string[] = [];
  const threads: string[] = [];
  const store = createPgTurnStore(sql);
  const org = await sql<
    { slug: string }[]
  >`SELECT slug FROM "organization" WHERE id = ${orgId}`;
  if (!org[0]) throw new Error('TTS budget fixture organization is missing');
  const directory = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    org[0].slug,
    'governance',
  );
  const policy = path.join(directory, 'budgets.yml');
  let original: string | undefined;
  try {
    original = await readFile(policy, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const report = (label: string, ok: boolean, detail: unknown) =>
    record(`tts shared budget: ${label}`, ok, JSON.stringify(detail));
  const project = async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.projects (org_id, name, team_ids, team_id, shared_with_team_ids,
        created_by, created_at_ms, updated_at_ms)
      VALUES (${orgId}, ${`TTS budget ${suffix}`}, ${[]}, NULL, ${[]}, ${userId}, ${now}, ${now}) RETURNING id`;
    if (!rows[0]) throw new Error('TTS fixture project insert failed');
    projects.push(rows[0].id);
    return rows[0].id;
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
          title: `TTS budget ${suffix}`,
          ...(projectId ? { projectId } : {}),
        }),
      },
    );
    const parsed = threadResult.safeParse(await response.json());
    if (!response.ok || !parsed.success)
      throw new Error('TTS fixture thread creation failed');
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
    if (!response.ok) throw new Error('TTS fixture refile failed');
  };
  const budget = async (
    projectId: string,
    limits: { cost?: number; requests?: number },
  ) => {
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
        ...(limits.cost === undefined
          ? []
          : [`    maxCostCents: ${limits.cost}`]),
        ...(limits.requests === undefined
          ? []
          : [`    maxRequests: ${limits.requests}`]),
      ].join('\n'),
    );
    clearOrgConfigCaches();
  };
  const voice = async (threadId: string, index: number) => {
    const outcome = await reserveChunk(sql, {
      organizationId: orgId,
      userId,
      threadId,
      messageId,
      index,
      text: 'x'.repeat(1000),
      locale: 'en',
      agentSlug: null,
      prospectiveCostCentsPerMChars: 1000,
      modelId: model,
      providerName: 'tts-budget-fixture',
    });
    if (outcome.kind === 'reserved') {
      chunkIds.add(outcome.chunkId);
      // Hold only our scheduled watchdogs; the lane explicitly exercises
      // their real handler and must not race a wall-clock worker tick.
      await sql`UPDATE pgboss.job SET start_after = now() + interval '1 hour'
        WHERE name = 'tts.watchdog_chunk' AND data ->> 'chunkId' = ${outcome.chunkId}`;
    }
    return outcome;
  };
  const requireReserved = (
    value: Awaited<ReturnType<typeof voice>>,
  ): Reserved => {
    if (value.kind !== 'reserved')
      throw new Error(`Expected TTS reservation, received ${value.kind}`);
    return value;
  };
  const refused = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return false;
    } catch (error) {
      if (error instanceof TtsError && error.code === 'BUDGET_EXCEEDED')
        return true;
      throw error;
    }
  };
  const holds = (projectIds: string[], organizationId = orgId) =>
    readInFlightReservations(sql, {
      organizationId,
      userId,
      userTeamIds: [],
      projectIds,
    });
  const op = (projectId: string, execId: string) =>
    reserveTurnBudget(sql, {
      organizationId: orgId,
      sessionId: opSession,
      execId,
      kind: 'model-api',
      defaultBudgetCents: 1,
      subject: { userId, agentSlug: model, projectIds: [projectId] },
      modelRef: `itest/${model}`,
      whole: { prospectiveTokens: 1 },
    });
  const openChat = (threadId: string, projectId: string, costCents: number) =>
    store.beginTurn({
      organizationId: orgId,
      threadId,
      userParts: [{ type: 'text', text: 'bounded budget fixture' }],
      spend: { userId, tokens: 1, costCents, projectIds: [projectId] },
    });
  const settle = (reservation: Reserved, cost: number, key: string) =>
    markChunkReadyAndRecordUsage(sql, {
      organizationId: orgId,
      chunkId: reservation.chunkId,
      attemptCreatedAt: reservation.attemptCreatedAt,
      storageRef: `s3:itest-tts-budget-${suffix}/${key}`,
      voice: 'fixture',
      providerName: 'itest',
      modelId: model,
      format: 'mp3',
      characterCount: 1000,
      costEstimateCents: cost,
    });
  try {
    const a = await project();
    const b = await project();
    const audioThread = await thread(a);
    const chatThread = await thread(a);
    const nextChatThread = await thread(a);
    const outside = await thread();
    await budget(a, { cost: 1.5 });
    const racers = await Promise.all(
      [0, 1].map(async (index) => {
        try {
          return {
            index,
            outcome: await voice(audioThread, index),
            refused: false,
          };
        } catch (error) {
          if (error instanceof TtsError && error.code === 'BUDGET_EXCEEDED')
            return { index, outcome: null, refused: true };
          throw error;
        }
      }),
    );
    const winners = racers.filter((row) => row.outcome?.kind === 'reserved');
    const first = winners[0];
    report(
      'distinct chunks racing cost headroom admit exactly one pending attempt',
      winners.length === 1 &&
        racers.filter((row) => row.refused).length === 1 &&
        (await holds([a])).projects?.[a]?.costCents === 1,
      racers,
    );
    if (first?.outcome?.kind !== 'reserved')
      throw new Error('TTS race has no winner');
    const duplicate = await voice(audioThread, first.index);
    report(
      'same chunk returns in-flight without another reservation',
      duplicate.kind === 'pending-in-flight' &&
        (await holds([a])).projects?.[a]?.requests === 1,
      duplicate,
    );
    const opAfterVoice = await op(a, 'after-voice');
    report(
      'voice pending cost refuses a whole model request before execution',
      !opAfterVoice.allowed,
      opAfterVoice,
    );

    // Chat's maintained gate measures existing usage, rather than voice's
    // prospective cost. Add a real half-cent chat hold to reach this cap,
    // then a further chat must see the voice hold as well as the chat hold.
    await openChat(chatThread, a, 0.5);
    let chatRefused = false;
    try {
      await openChat(nextChatThread, a, 0.1);
    } catch (error) {
      if (error instanceof ChatBudgetExceededError) chatRefused = true;
      else throw error;
    }
    report(
      'chat sees the voice share of a mixed pending cap',
      chatRefused && (await holds([a])).projects?.[a]?.costCents === 1.5,
      { chatRefused },
    );
    await store.endGeneration({ organizationId: orgId, threadId: chatThread });
    await store.endGeneration({
      organizationId: orgId,
      threadId: nextChatThread,
    });
    for (const row of winners)
      if (row.outcome?.kind === 'reserved')
        await runTtsWatchdog(sql, row.outcome);
    const unknownBooked = await sql<{ cost: number; requests: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost, request_count::float8 AS requests
      FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${a} AND granularity = 'monthly'`;
    const retryRefused = await refused(() => voice(audioThread, first.index));
    report(
      'watchdog books the unknown estimate once and a retry still respects the cap',
      (await holds([a])).projects?.[a] === undefined &&
        unknownBooked[0]?.cost === 1 &&
        unknownBooked[0]?.requests === 1 &&
        retryRefused,
      { unknownBooked, retryRefused },
    );
    await runTtsWatchdog(sql, first.outcome);
    const duplicateUnknown = await sql<{ cost: number; requests: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost, request_count::float8 AS requests
      FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${a} AND granularity = 'monthly'`;
    report(
      'duplicate watchdog does not book the failed attempt twice',
      JSON.stringify(unknownBooked) === JSON.stringify(duplicateUnknown),
      duplicateUnknown,
    );
    // This next scenario owns a separate headroom measurement. The previous
    // assertion observed the estimate before resetting only our project.
    await sql`DELETE FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${a}`;

    await openChat(chatThread, a, 1);
    const voiceAfterChat = await refused(() => voice(audioThread, 2));
    report(
      'a real chat hold refuses a distinct voice request',
      voiceAfterChat,
      { voiceAfterChat },
    );
    await store.endGeneration({ organizationId: orgId, threadId: chatThread });
    const modelHold = await op(a, 'before-voice');
    const voiceAfterOp = await refused(() => voice(audioThread, 2));
    report(
      'a real model hold refuses a distinct voice request',
      modelHold.allowed && voiceAfterOp,
      { modelHold, voiceAfterOp },
    );
    await settleSessionOpSpend(sql, {
      sessionId: opSession,
      execId: 'before-voice',
      spentCents: 0,
    });
    // These buckets belong only to this nonce's project; reset the scenario
    // before changing from cost to request policy, retaining the op facts.
    await sql`DELETE FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${a}`;
    await budget(a, { requests: 2 });
    const requestFirst = requireReserved(await voice(audioThread, 3));
    const requestSecond = await refused(() => voice(audioThread, 4));
    report(
      'pending voice holds bind the request dimension',
      requestSecond && (await holds([a])).projects?.[a]?.requests === 1,
      { requestSecond },
    );
    await runTtsWatchdog(sql, requestFirst);
    await sql`DELETE FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${a}`;

    await budget(a, { cost: 100 });
    const drift = requireReserved(await voice(audioThread, 5));
    await refile(audioThread, b);
    const driftHold = await holds([a, b]);
    report(
      'refiling retains the admitted voice project hold',
      driftHold.projects?.[a]?.costCents === 1 &&
        driftHold.projects?.[b] === undefined,
      driftHold,
    );
    const finished = await settle(drift, 0.75, 'ready');
    const booked = await sql<
      { projectId: string; cost: number; requests: number }[]
    >`
      SELECT project_id AS "projectId", cost_estimate_cents::float8 AS cost, request_count::float8 AS requests
      FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${[a, b]}) AND granularity = 'monthly'`;
    const after = await holds([a, b]);
    report(
      'ready replaces the hold with actual booked cost in the admitted project',
      !finished.stale &&
        after.projects?.[a] === undefined &&
        after.projects?.[b] === undefined &&
        booked.find((row) => row.projectId === a)?.cost === 0.75 &&
        booked.find((row) => row.projectId === a)?.requests === 1 &&
        !booked.some((row) => row.projectId === b),
      { booked, after },
    );
    const beforeReplay =
      await sql`SELECT * FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${[a, b]}) ORDER BY project_id, granularity`;
    const replay = await settle(drift, 0.75, 'unused-replay');
    const replayBooked =
      await sql`SELECT * FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${[a, b]}) ORDER BY project_id, granularity`;
    const noProject = requireReserved(await voice(outside, 6));
    await refile(outside, b);
    await settle(noProject, 0.5, 'no-project');
    const noProjectBooked =
      await sql`SELECT * FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${[a, b]}) ORDER BY project_id, granularity`;
    report(
      'explicit no-project stays empty and duplicate settlement cannot book twice',
      replay.stale &&
        JSON.stringify(replayBooked) === JSON.stringify(beforeReplay) &&
        JSON.stringify(noProjectBooked) === JSON.stringify(replayBooked),
      { replay, noProjectBooked },
    );

    const retry = requireReserved(await voice(audioThread, 7));
    await runTtsWatchdog(sql, retry);
    const next = requireReserved(await voice(audioThread, 7));
    await runTtsWatchdog(sql, retry);
    const staleResult = await settle(retry, 20, 'unused-stale');
    const pending = await sql<{ attempt: number; status: string }[]>`
      SELECT attempt_created_at_ms::float8 AS attempt, status FROM app.tts_audio_chunks WHERE id = ${next.chunkId}`;
    const retryBooked = await sql<{ cost: number; requests: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost, request_count::float8 AS requests
      FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${b} AND granularity = 'monthly'`;
    report(
      'old watchdog and provider completion cannot release or charge a retry',
      next.attemptCreatedAt > retry.attemptCreatedAt &&
        staleResult.stale &&
        pending[0]?.attempt === next.attemptCreatedAt &&
        pending[0].status === 'pending' &&
        (await holds([b])).projects?.[b]?.costCents === 1 &&
        retryBooked[0]?.cost === 1 &&
        retryBooked[0]?.requests === 1,
      { retry, next, staleResult, pending, retryBooked },
    );
    await settle(next, 0.25, 'retry-ready');

    // Storage emitted by a previous writer omits both new columns. This is
    // a legacy-row compatibility probe, not execution of an old binary.
    const legacyId = randomUUID();
    chunkIds.add(legacyId);
    await sql`INSERT INTO app.tts_audio_chunks (id, org_id, thread_id, message_id, user_id,
      chunk_index, text, status, locale, created_at_ms, attempt_created_at_ms)
      VALUES (${legacyId}, ${orgId}, ${outside}, ${`legacy-${suffix}`}, ${userId}, 0,
        'legacy pending', 'pending', 'en', ${now}, ${now})`;
    const legacyStamp = await sql<
      { projects: string[] | null; cost: number | null }[]
    >`
      SELECT project_ids AS projects, reserved_cost_cents AS cost
      FROM app.tts_audio_chunks WHERE id = ${legacyId}`;
    const beforeLegacy = await sql<{ cost: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${b} AND granularity = 'monthly'`;
    await settle(
      { kind: 'reserved', chunkId: legacyId, attemptCreatedAt: now },
      0.5,
      'legacy-ready',
    );
    const afterLegacy = await sql<{ cost: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${b} AND granularity = 'monthly'`;
    report(
      'legacy NULL attribution retains its current-thread settlement fallback',
      legacyStamp[0]?.projects === null &&
        legacyStamp[0].cost === null &&
        afterLegacy[0]?.cost === (beforeLegacy[0]?.cost ?? 0) + 0.5,
      { legacyStamp, beforeLegacy, afterLegacy },
    );

    const foreignId = randomUUID();
    chunkIds.add(foreignId);
    await sql`INSERT INTO app.tts_audio_chunks (id, org_id, thread_id, message_id, user_id,
      chunk_index, text, status, locale, reserved_cost_cents, project_ids, created_at_ms, attempt_created_at_ms)
      VALUES (${foreignId}, ${foreignOrg}, ${`foreign-${suffix}`}, ${`foreign-${suffix}`}, ${userId}, 0,
        'foreign pending storage boundary', 'pending', 'en', 100, ${[b]}, ${now}, ${now})`;
    report(
      'another tenant pending row never contributes to this tenant holds',
      (await holds([b])).projects?.[b] === undefined &&
        (await holds([b], foreignOrg)).projects?.[b]?.costCents === 100,
      { foreignId },
    );

    const c = await project();
    const staleThread = await thread(c);
    await budget(c, { cost: 1.5 });
    const abandoned = requireReserved(await voice(staleThread, 8));
    await sql`UPDATE app.tts_audio_chunks SET created_at_ms = ${now - 8 * 24 * 60 * 60 * 1000}
      WHERE id = ${abandoned.chunkId}`;
    await runTtsCleanup(sql, { threadId: staleThread });
    await gcExpiredTtsChunks(sql, { limit: 1 });
    const afterCleanup = await holds([c]);
    report(
      'ordinary age cleanup and GC retain an unknown pending hold',
      afterCleanup.projects?.[c]?.costCents === 1,
      afterCleanup,
    );
    const takeoverRefused = await refused(() => voice(staleThread, 8));
    const retained = await sql<{ status: string; recorded: number | null }[]>`
      SELECT status, usage_recorded_at_ms::float8 AS recorded FROM app.tts_audio_chunks
      WHERE id = ${abandoned.chunkId}`;
    const refusedBooked = await sql`SELECT * FROM app.project_usage
      WHERE org_id = ${orgId} AND project_id = ${c}`;
    report(
      'refused stale takeover rolls back booking and keeps its predecessor hold',
      takeoverRefused &&
        retained[0]?.status === 'pending' &&
        retained[0].recorded === null &&
        refusedBooked.length === 0 &&
        (await holds([c])).projects?.[c]?.costCents === 1,
      { takeoverRefused, retained, refusedBooked },
    );
    await budget(c, { cost: 3 });
    const replacement = requireReserved(await voice(staleThread, 8));
    await runTtsWatchdog(sql, abandoned);
    const late = await settle(abandoned, 50, 'stale-takeover');
    const takeoverBooked = await sql<{ cost: number; requests: number }[]>`
      SELECT cost_estimate_cents::float8 AS cost, request_count::float8 AS requests
      FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ${c} AND granularity = 'monthly'`;
    report(
      'admitted stale takeover books the predecessor once before its new hold',
      replacement.attemptCreatedAt > abandoned.attemptCreatedAt &&
        late.stale &&
        takeoverBooked[0]?.cost === 1 &&
        takeoverBooked[0]?.requests === 1 &&
        (await holds([c])).projects?.[c]?.costCents === 1,
      { replacement, late, takeoverBooked },
    );
    await runTtsWatchdog(sql, replacement);
  } finally {
    if (original === undefined)
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
    else await writeFile(policy, original);
    clearOrgConfigCaches();
    for (const threadId of threads)
      await store.endGeneration({ organizationId: orgId, threadId });
    await sql`DELETE FROM pgboss.job WHERE (name = 'tts.watchdog_chunk' AND data ->> 'chunkId' = ANY(${[...chunkIds]}))
      OR (name = 'tts.cleanup' AND data ->> 'threadId' = ANY(${threads}))`;
    await sql`DELETE FROM app.tts_audio_chunks WHERE id = ANY(${[...chunkIds]}) AND org_id = ANY(${[orgId, foreignOrg]})`;
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${orgId} AND session_id = ${opSession}`;
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${orgId} AND (model = ${model} OR agent_slug = ${model})`;
    await sql`DELETE FROM app.project_usage WHERE org_id = ${orgId} AND project_id = ANY(${projects})`;
    await sql`DELETE FROM app.threads WHERE org_id = ${orgId} AND id = ANY(${threads})`;
    await sql`DELETE FROM app.projects WHERE org_id = ${orgId} AND id = ANY(${projects})`;
  }
}
