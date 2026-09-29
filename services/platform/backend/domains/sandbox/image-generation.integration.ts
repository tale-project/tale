/**
 * `generate_image`'s admission and settle on the real schema: racing calls
 * near an organization cap cannot both pass it (the budget-admission lock
 * and the holds), one turn runs one generation at a time, the per-turn
 * ceiling and the turn's allowance refuse before any provider call, a
 * generation in flight holds its estimate and its image requests for every
 * other admission, and the settle books cost and requests (never tokens)
 * while releasing the hold — which the schema allows only beside an
 * in-flight mark.
 *
 * A fixture organization of its own (a real row, so its policy files
 * resolve) keeps the cap and the holds apart from every other lane.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { buildPeriodKeyFromTimestamp } from '../../core/governance/helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { readInFlightReservations } from '../governance/budget-reservations.ts';
import {
  admitImageGeneration,
  type ImageAdmission,
  settleImageGeneration,
} from './image-generation.ts';

const NOBODY = { userId: '__automation__', agentSlug: 'itest/images' };

export async function checkImageGenerationAdmission(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const run = randomUUID().slice(0, 8);
  const org = `${ctx.orgId}-image-generation-fixture`;
  // Its own slug, in the form a policy file's directory needs.
  const slug = `itest-img-${run}`;
  const stamp = new Date();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${org}, 'Image Generation Fixture', ${slug}, ${stamp})
    ON CONFLICT ("id") DO NOTHING
  `;
  const governanceDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    slug,
    'governance',
  );
  const budgetsPath = path.join(governanceDir, 'budgets.yml');
  const seedOp = async (
    execId: string,
    fields: { budgetCents?: number | null; imagesAdmitted?: number } = {},
  ) => {
    const now = Date.now();
    await sql`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, user_id, budget_cents,
        images_admitted, heartbeat_at_ms, started_at_ms
      ) VALUES (
        ${org}, ${`img-${run}`}, ${execId}, 'workflow-agent', 'running',
        '__automation__',
        ${fields.budgetCents === undefined ? 500 : fields.budgetCents},
        ${fields.imagesAdmitted ?? 0}, ${now}, ${now}
      )
    `;
  };
  const admit = (execId: string, images: number) =>
    admitImageGeneration(sql, {
      organizationId: org,
      sessionId: `img-${run}`,
      execId,
      subject: NOBODY,
      images,
    });
  const refusalCode = (admission: ImageAdmission) =>
    admission.admitted ? 'admitted' : admission.code;

  try {
    // --- racing calls near an organization cap ---------------------------
    // Two turns each hold a 60-cent allowance; the cap is 200. Two images
    // are held at 50: whichever call is admitted first leaves
    // 200 − 120 − 50 = 30, too little for the other's 50.
    await mkdir(governanceDir, { recursive: true });
    await writeFile(
      budgetsPath,
      [
        'enabled: true',
        'rules:',
        '  - scope: org',
        '    period: monthly',
        '    maxCostCents: 200',
      ].join('\n'),
    );
    clearOrgConfigCaches();
    await seedOp('exec-race-a', { budgetCents: 60 });
    await seedOp('exec-race-b', { budgetCents: 60 });
    const race = await Promise.all([
      admit('exec-race-a', 2),
      admit('exec-race-b', 2),
    ]);
    const raceCodes = race.map(refusalCode).sort();
    record(
      'image generation: racing calls near a cap — exactly one is admitted',
      raceCodes[0] === 'admitted' && raceCodes[1] === 'budget_exceeded',
      `codes=${JSON.stringify(raceCodes)}`,
    );

    // --- the settle books cost and requests, never tokens ------------------
    const winner = race.findIndex((admission) => admission.admitted);
    const winnerExec = winner === 0 ? 'exec-race-a' : 'exec-race-b';
    const admitted = race[winner];
    const heldBefore = await readInFlightReservations(sql, {
      organizationId: org,
      userId: '__automation__',
      userTeamIds: [],
      impersonal: true,
    });
    if (admitted !== undefined && admitted.admitted) {
      await settleImageGeneration(sql, {
        organizationId: org,
        sessionId: `img-${run}`,
        execId: winnerExec,
        callStartedAt: admitted.callStartedAt,
        subject: NOBODY,
        provider: 'itest-images',
        model: 'itest-image-model',
        charges: [3.9, 2.5],
        timestamp: Date.now(),
      });
    }
    const heldAfter = await readInFlightReservations(sql, {
      organizationId: org,
      userId: '__automation__',
      userTeamIds: [],
      impersonal: true,
    });
    const ledger = await sql<
      { requests: number; cost: number; tokens: number }[]
    >`
      SELECT coalesce(sum(request_count), 0)::float8 AS requests,
             coalesce(sum(cost_estimate_cents), 0)::float8 AS cost,
             coalesce(sum(total_tokens), 0)::float8 AS tokens
      FROM app.usage_ledger
      WHERE org_id = ${org} AND model = 'itest-image-model'
        AND granularity = 'monthly'
        AND period_key = ${buildPeriodKeyFromTimestamp('monthly', Date.now())}
    `;
    const settledOp = await sql<
      {
        spent: number;
        hold: number;
        holdRequests: number;
        inFlight: boolean;
      }[]
    >`
      SELECT image_spent_cents::float8 AS spent,
             image_hold_cents::float8 AS hold,
             image_hold_requests AS "holdRequests",
             image_call_started_at_ms IS NOT NULL AS "inFlight"
      FROM app.sandbox_session_ops
      WHERE session_id = ${`img-${run}`} AND exec_id = ${winnerExec}
    `;
    record(
      'image generation: a call in flight holds its estimate; the settle books cost and requests without tokens and releases it',
      // Before: both turns' 60, the call's 50; one request per turn plus
      // one per image in flight. After: the turns' holds alone.
      Math.abs((heldBefore.org?.costCents ?? 0) - 170) < 0.001 &&
        heldBefore.org?.requests === 4 &&
        Math.abs((heldAfter.org?.costCents ?? 0) - 120) < 0.001 &&
        heldAfter.org?.requests === 2 &&
        ledger[0]?.requests === 2 &&
        Math.abs((ledger[0]?.cost ?? 0) - 6.4) < 0.001 &&
        ledger[0]?.tokens === 0 &&
        Math.abs((settledOp[0]?.spent ?? 0) - 6.4) < 0.001 &&
        settledOp[0]?.hold === 0 &&
        settledOp[0]?.holdRequests === 0 &&
        settledOp[0] !== undefined &&
        !settledOp[0].inFlight,
      `before=${JSON.stringify(heldBefore.org)} after=${JSON.stringify(heldAfter.org)} ledger=${JSON.stringify(ledger[0])} op=${JSON.stringify(settledOp[0])}`,
    );
    await rm(budgetsPath, { force: true });
    clearOrgConfigCaches();

    // --- one generation in flight per turn --------------------------------
    await seedOp('exec-mutex');
    const sameTurn = await Promise.all([
      admit('exec-mutex', 1),
      admit('exec-mutex', 1),
    ]);
    const sameCodes = sameTurn.map(refusalCode).sort();
    record(
      'image generation: one call in flight per turn — the second is told to wait',
      sameCodes[0] === 'admitted' && sameCodes[1] === 'generation_in_progress',
      `codes=${JSON.stringify(sameCodes)}`,
    );

    // --- the per-turn ceiling and the turn's allowance ---------------------
    await seedOp('exec-ceiling', { imagesAdmitted: 15 });
    const overCeiling = await admit('exec-ceiling', 2);
    const atCeiling = await admit('exec-ceiling', 1);
    await seedOp('exec-allowance', { budgetCents: 60 });
    const overAllowance = await admit('exec-allowance', 3);
    const inAllowance = await admit('exec-allowance', 2);
    // A subscription turn has no allowance of its own: the deployment's
    // default (500 cents) bounds its images, and it holds only while one
    // of its generations runs.
    await seedOp('exec-subscription', { budgetCents: null });
    const subscription = await admit('exec-subscription', 4);
    const subscriptionHold = await readInFlightReservations(sql, {
      organizationId: org,
      userId: '__automation__',
      userTeamIds: [],
      impersonal: true,
    });
    record(
      'image generation: the per-turn ceiling and the turn allowance refuse before any provider call',
      refusalCode(overCeiling) === 'turn_image_limit' &&
        atCeiling.admitted &&
        refusalCode(overAllowance) === 'turn_allowance' &&
        inAllowance.admitted &&
        inAllowance.holdCents === 50 &&
        subscription.admitted &&
        subscription.holdCents === 100,
      `ceiling=${JSON.stringify([overCeiling, atCeiling])} allowance=${JSON.stringify([overAllowance, inAllowance])} subscription=${JSON.stringify(subscription)} holds=${JSON.stringify(subscriptionHold.org)}`,
    );

    // --- the schema refuses a hold without an in-flight mark ---------------
    const refused = await sql`
      UPDATE app.sandbox_session_ops SET image_hold_cents = 5
      WHERE session_id = ${`img-${run}`} AND exec_id = 'exec-race-a'
        AND image_call_started_at_ms IS NULL
    `.then(
      () => 'accepted',
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'error',
    );
    record(
      'image generation: a hold without an in-flight call is refused by the schema',
      refused === '23514',
      `update=${refused}`,
    );
  } finally {
    await rm(budgetsPath, { force: true });
    clearOrgConfigCaches();
    await sql`DELETE FROM app.sandbox_session_ops WHERE org_id = ${org}`;
    await sql`DELETE FROM app.usage_ledger WHERE org_id = ${org}`;
    await sql`DELETE FROM app.budget_admissions WHERE org_id = ${org}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${org}`;
  }
}
