/** Real Postgres proof of an automation step's message to members
 * (`notify.member`): whom it reaches, whom it skips, and that it is told
 * once. In the suite's organization, runs started by Ada send through the
 * store the native calls (`pgNotifyStore`):
 *
 * - Ada named by her email in another case, by `run-starter`, and Noah, who
 *   switched messages from automations off (the 0196 column): Ada gets one
 *   row, framed by the automation's name; Noah none, and is listed;
 * - the same execution again writes nothing and answers the same;
 * - a disabled membership, an API key's own identity and someone of no
 *   organization here each refuse the whole message, writing nothing;
 * - a run whose steps already sent 99 messages refuses a step that would
 *   send 2, writing nothing;
 * - the run's count and the retry's lookup can read the partial index 0196
 *   made for them.
 *
 * Nothing is sent by email: the rows are gone before their jobs come due,
 * and the lane deletes everything it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { pgNotifyStore } from './notify-store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkAutomationMessages(
  sql: Sql,
  ctx: { orgId: string },
  record: Recorder,
): Promise<void> {
  const { orgId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const ada = `notify-ada-${suffix}`;
  const noah = `notify-noah-${suffix}`;
  const gone = `notify-disabled-${suffix}`;
  const key = `notify-key-${suffix}`;
  const outsider = `notify-outsider-${suffix}`;
  const people = [ada, noah, gone, key, outsider];
  const emailOf = (id: string) =>
    id === key ? `${id}@apikeys.invalid` : `${id}@example.com`;
  const automation = `notify-probe-${suffix}`;
  const runIds: string[] = [];
  const store = pgNotifyStore(sql);
  // A run written as the engine does, under its writer protocol.
  const startRun = async (): Promise<string> => {
    const [run] = await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      return tx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, status, mode, started_by, started_at_ms
        ) VALUES (
          ${orgId}, ${automation}, 1, 'running', 'live', ${`user:${ada}`},
          ${Date.now()}
        )
        RETURNING id
      `;
    });
    if (run === undefined) throw new Error('the run was not written');
    runIds.push(run.id);
    return run.id;
  };
  const rowsOf = (runId: string) =>
    sql<{ userId: string; automation: string | null }[]>`
      SELECT user_id AS "userId", params->>'automation' AS automation
      FROM app.user_notifications
      WHERE org_id = ${orgId} AND type = 'automation_message'
        AND resource_id = ${runId}
    `;

  try {
    for (const person of people) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${person}, ${person}, ${emailOf(person)}, true,
                ${new Date()}, ${new Date()})
      `;
    }
    for (const [person, role] of [
      [ada, 'member'],
      [noah, 'member'],
      [gone, 'disabled'],
      [key, 'member'],
    ] as const) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${person}`}, ${orgId}, ${person}, ${role}, ${new Date()})
      `;
    }
    await sql`
      INSERT INTO app.notification_preferences (
        user_id, org_id, automation_messages, updated_at_ms
      ) VALUES (${noah}, ${orgId}, false, ${Date.now()})
    `;

    const runId = await startRun();
    const ask = {
      organizationId: orgId,
      runId,
      idempotencyKey: `${runId}/tell/0/0`,
      to: [emailOf(ada).toUpperCase(), 'run-starter', noah],
      title: 'Weekly report ready',
      message: 'Revenue is up.',
    };
    const first = await store.notify(ask);
    const rows = await rowsOf(runId);
    record(
      'notify.member reaches each member it names once, and lists who switched it off',
      first.ok &&
        first.delivered.length === 1 &&
        first.delivered[0]?.userId === ada &&
        first.skipped.length === 1 &&
        first.skipped[0]?.userId === noah &&
        first.skipped[0]?.reason === 'preference' &&
        rows.length === 1 &&
        rows[0]?.userId === ada &&
        // No declared name: the frame reads the slug as a title.
        rows[0]?.automation === `Notify probe ${suffix}`,
      `answer=${JSON.stringify(first)} rows=${JSON.stringify(rows)}`,
    );

    const again = await store.notify(ask);
    const after = await rowsOf(runId);
    record(
      'notify.member: a retry of the same execution tells nobody twice',
      JSON.stringify(again) === JSON.stringify(first) && after.length === 1,
      `answer=${JSON.stringify(again)} rows=${after.length}`,
    );

    for (const [who, to] of [
      ['a disabled membership', gone],
      ["an API key's own identity", key],
      ['someone of no organization here', emailOf(outsider)],
    ] as const) {
      const refused = await store.notify({
        ...ask,
        idempotencyKey: `${runId}/refused/${who}`,
        to: [emailOf(ada), to],
      });
      const unchanged = await rowsOf(runId);
      record(
        `notify.member refuses ${who}, writing nothing`,
        !refused.ok &&
          refused.refusal.kind === 'not_a_member' &&
          refused.refusal.recipients.join() === to &&
          unchanged.length === 1,
        `answer=${JSON.stringify(refused)} rows=${unchanged.length}`,
      );
    }

    const busy = await startRun();
    await sql`
      INSERT INTO app.user_notifications (
        user_id, org_id, type, title_key, body_key, params, resource_type,
        resource_id, actor_type, read, created_at_ms
      )
      SELECT ${ada}, ${orgId}, 'automation_message', 'automationMessage',
             'automationMessageBodyNoText',
             jsonb_build_object('deliveryKey', ${busy}::text || '/earlier/' || n),
             'automation_run', ${busy}, 'system', true, ${Date.now()}
      FROM generate_series(1, 99) AS n
    `;
    const capped = await store.notify({
      ...ask,
      runId: busy,
      idempotencyKey: `${busy}/tell/0/0`,
      to: [emailOf(ada), noah],
    });
    // Noah is muted, so this step would send one — under the cap.
    const fits = capped.ok && (await rowsOf(busy)).length === 100;
    await sql`
      DELETE FROM app.notification_preferences
      WHERE user_id = ${noah} AND org_id = ${orgId}
    `;
    const over = await store.notify({
      ...ask,
      runId: busy,
      idempotencyKey: `${busy}/tell/1/0`,
      to: [emailOf(ada), noah],
    });
    record(
      'notify.member refuses a step that would take its run past 100 messages',
      fits &&
        !over.ok &&
        over.refusal.kind === 'run_limit' &&
        over.refusal.sent === 100 &&
        (await rowsOf(busy)).length === 100,
      `fits=${fits} answer=${JSON.stringify(over)}`,
    );

    const plan = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`;
      return tx<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT user_id, params->>'deliveryKey'
        FROM app.user_notifications
        WHERE org_id = ${orgId} AND type = 'automation_message'
          AND resource_id = ${busy}
      `;
    });
    const text = plan.map((line) => line['QUERY PLAN']).join('\n');
    record(
      "notify.member: the run's messages are read through their partial index",
      text.includes('user_notifications_automation_run'),
      text,
    );
  } finally {
    if (runIds.length > 0) {
      await sql`
        DELETE FROM app.user_notifications
        WHERE org_id = ${orgId} AND resource_id IN ${sql(runIds)}
      `;
      await sql.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`DELETE FROM app.automation_runs WHERE id IN ${tx(runIds)}`;
      });
    }
    await sql`
      DELETE FROM app.notification_preferences
      WHERE org_id = ${orgId} AND user_id IN ${sql(people)}
    `;
    await sql`DELETE FROM "member" WHERE "userId" IN ${sql(people)}`;
    await sql`DELETE FROM "user" WHERE "id" IN ${sql(people)}`;
  }
}
