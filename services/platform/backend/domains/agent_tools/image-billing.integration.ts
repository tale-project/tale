import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { turnImageBilling } from './image-billing.ts';

/**
 * Real Postgres proof of an image's budget hold: it is raised and given back
 * on the generation row of the reply the image belongs to. A thread has one
 * live generation row at a time, and an image call can outlive its reply — a
 * Stop abandons a tool that does not listen — so its settle can arrive after
 * the next reply has taken the thread. That settle must lower nothing on the
 * new row (the hold it gives back was on a row that is gone), while the
 * spend it books stays booked.
 */
export async function checkImageHoldIdentity(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const agentSlug = `itest-image-hold-${suffix}`;
  const now = Date.now();
  const [org] = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId}
  `;
  const governanceDir = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    org?.slug ?? '',
    'governance',
  );
  const budgetsFile = path.join(governanceDir, 'budgets.yml');
  const budgetsBefore = await readFile(budgetsFile, 'utf8').catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    },
  );

  const [thread] = await sql<{ id: string }[]>`
    INSERT INTO app.threads (org_id, user_id, title, kind, created_at_ms,
                             updated_at_ms)
    VALUES (${orgId}, ${userId}, 'image hold', 'chat', ${now}, ${now})
    RETURNING id
  `;
  const threadId = thread?.id ?? '';

  const openReply = (messageId: string, holdCents: number) => sql`
    INSERT INTO app.generations (
      thread_id, org_id, message_id, started_at_ms, heartbeat_at_ms,
      updated_at_ms, user_id, reserved_cost_cents
    ) VALUES (
      ${threadId}, ${orgId}, ${messageId}, ${now}, ${now}, ${now}, ${userId},
      ${holdCents}
    )
  `;
  const heldOnThread = async () => {
    const [row] = await sql<{ held: number; messageId: string | null }[]>`
      SELECT reserved_cost_cents::float8 AS held, message_id AS "messageId"
      FROM app.generations WHERE thread_id = ${threadId}
    `;
    return row;
  };
  const billing = () =>
    turnImageBilling(sql, {
      organizationId: orgId,
      userId,
      threadId,
      projectIds: [],
      agentSlug,
      unit: 'reply',
    });

  try {
    // A budget rule must bind for an image to hold anything at all.
    await mkdir(governanceDir, { recursive: true });
    await writeFile(
      budgetsFile,
      [
        'enabled: true',
        'rules:',
        '  - scope: default',
        '    period: monthly',
        '    maxRequests: 1000000',
      ].join('\n'),
    );
    clearOrgConfigCaches();

    // The first reply holds 10 for its model and admits two images (50).
    await openReply('msg-first', 10);
    const first = billing();
    const admitted = await first.admit(2);
    const holding = await heldOnThread();

    // It is stopped; its row goes, and the person's next message takes the
    // thread with a hold of its own.
    await sql`DELETE FROM app.generations WHERE thread_id = ${threadId}`;
    await openReply('msg-second', 10);

    // The abandoned image finishes now: it books its spend and gives back the
    // hold it had — on a row that is gone, not on the new reply's.
    await first.settle({
      holdCents: admitted.admitted ? admitted.holdCents : 0,
      charges: [4, 3],
      provider: 'itest',
      model: 'itest-image',
    });
    const afterLate = await heldOnThread();
    const [booked] = await sql<{ cost: number }[]>`
      SELECT coalesce(sum(cost_estimate_cents), 0)::float8 AS cost
      FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${agentSlug}
        AND granularity = 'monthly'
    `;

    // The new reply's own images still hold and give back on its own row.
    const second = billing();
    const admittedSecond = await second.admit(1);
    const holdingSecond = await heldOnThread();
    await second.settle({
      holdCents: admittedSecond.admitted ? admittedSecond.holdCents : 0,
      charges: [],
      provider: 'itest',
      model: 'itest-image',
    });
    const afterOwn = await heldOnThread();

    record(
      'image holds: a settle that outlives its reply lowers nothing on the next reply, and its spend is still booked [CHAT-R22]',
      admitted.admitted &&
        admitted.holdCents === 50 &&
        holding?.held === 60 &&
        holding.messageId === 'msg-first' &&
        afterLate?.held === 10 &&
        afterLate.messageId === 'msg-second' &&
        booked?.cost === 7 &&
        admittedSecond.admitted &&
        holdingSecond?.held === 35 &&
        afterOwn?.held === 10,
      `first reply held ${holding?.held} on ${holding?.messageId} (want 60 on msg-first); after its late settle the next reply holds ${afterLate?.held} on ${afterLate?.messageId} (want 10 on msg-second); booked ${booked?.cost} cents (want 7); the next reply's own image: ${holdingSecond?.held} while held, ${afterOwn?.held} after (want 35, 10)`,
    );
  } finally {
    await sql`DELETE FROM app.threads WHERE id = ${threadId}`;
    await sql`
      DELETE FROM app.usage_ledger
      WHERE org_id = ${orgId} AND agent_slug = ${agentSlug}
    `;
    if (budgetsBefore === null) {
      await unlink(budgetsFile).catch((error: unknown) => {
        console.warn('[itest] image holds: budgets file not removed', error);
      });
    } else {
      await writeFile(budgetsFile, budgetsBefore);
    }
    clearOrgConfigCaches();
  }
}
