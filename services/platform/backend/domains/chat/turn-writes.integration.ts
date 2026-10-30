/**
 * Real-Postgres proof of what a chat turn writes (#4709): the room 0221
 * keeps free on the pages of the rows a turn rewrites, one touch of the
 * thread row per open (and of a branch's root), the end of a turn failing
 * its own placeholder by id, and expired send keys leaving through the
 * hourly sweep instead of the send (0222's index).
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  errorText,
  type RecordCheck,
  withCleanup,
} from '../../integration-lane-helpers.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import {
  claimSendIdempotency,
  rememberAcceptedSend,
  type SendKeySweep,
  sweepExpiredSendKeys,
} from './send-idempotency.ts';
import { appendMessageRow, createPgTurnStore } from './store.ts';
import { createThread } from './threads.ts';

export async function checkChatTurnWrites(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const parts: ReadonlyArray<readonly [string, () => Promise<void>]> = [
    ['the storage shape', () => checkStorage(sql, record)],
    ['the touch per open', () => checkOneTouchPerOpen(sql, ctx, record)],
    ['the end of a turn', () => checkPlaceholderById(sql, ctx, record)],
    ['the send-key sweep', () => checkSendKeySweep(sql, record)],
  ];
  // Each part records its own failure, so a part that throws fails its
  // check without cutting off the parts and lanes after it.
  for (const [part, run] of parts) {
    try {
      await run();
    } catch (error) {
      record(`chat turn writes: ${part} runs`, false, errorText(error));
    }
  }
}

async function checkStorage(sql: Sql, record: RecordCheck): Promise<void> {
  const tables = await sql<{ table: string; options: string }[]>`
    SELECT c.relname AS "table",
           coalesce(array_to_string(c.reloptions, ','), '') AS options
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app'
      AND c.relname IN ('generations', 'thread_metadata')
  `;
  const optionsOf = (table: string): string[] =>
    (tables.find((row) => row.table === table)?.options ?? '').split(',');
  record(
    'chat turn writes: generations and thread_metadata keep room on the page for HOT updates (0221)',
    optionsOf('generations').includes('fillfactor=70') &&
      optionsOf('thread_metadata').includes('fillfactor=85'),
    `generations=${optionsOf('generations').join(',')} (want fillfactor=70), thread_metadata=${optionsOf('thread_metadata').join(',')} (want fillfactor=85)`,
  );
  const indexes = await sql<{ name: string; definition: string }[]>`
    SELECT indexname AS name, indexdef AS definition FROM pg_indexes
    WHERE schemaname = 'app' AND tablename = 'chat_send_idempotency'
  `;
  const sweepIndex = indexes.find(
    (row) => row.name === 'chat_send_idempotency_expires_at',
  );
  record(
    'chat turn writes: the send-key ledger is indexed for a sweep across organizations (0222)',
    sweepIndex?.definition.endsWith('(expires_at_ms)') === true &&
      !indexes.some((row) => row.name === 'chat_send_idempotency_expiry'),
    `indexes=${JSON.stringify(indexes.map((row) => row.definition))} (want one on (expires_at_ms), none named chat_send_idempotency_expiry)`,
  );
}

/**
 * A turn's open lands the user row and the placeholder in one transaction:
 * a trigger counts the updates of `threads.updated_at_ms` it makes, one per
 * thread row (the open's thread, and a branch's root) where a touch per
 * appended row made two.
 */
async function checkOneTouchPerOpen(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const store = createPgTurnStore(sql);
  const mkThread = (title: string) =>
    createThread(sql, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      kind: 'direct',
      title,
    });
  const threads: string[] = [];
  const opened: string[] = [];
  await withCleanup(
    [
      [
        'ends the turns it opened',
        async () => {
          for (const threadId of opened) {
            await store.endGeneration({ organizationId: ctx.orgId, threadId });
          }
        },
      ],
      [
        'drops the touch counter',
        () =>
          sql.unsafe(`
            DROP TRIGGER IF EXISTS itest_count_thread_touch ON app.threads;
            DROP FUNCTION IF EXISTS app.itest_count_thread_touch();
            DROP TABLE IF EXISTS app.itest_thread_touches;
          `),
      ],
      [
        'deletes its threads',
        async () => {
          if (threads.length === 0) return;
          await sql`DELETE FROM app.threads WHERE id IN ${sql(threads)}`;
        },
      ],
    ],
    async () => {
      for (const title of ['one thread', 'branch root', 'branch']) {
        threads.push(await mkThread(`Turn writes: ${title}`));
      }
      const [plain = '', root = '', branch = ''] = threads;
      // A hidden sibling of the root: its activity surfaces on the root too.
      await sql`
        UPDATE app.thread_metadata SET branch_root_id = ${root}, hidden = true
        WHERE thread_id = ${branch}
      `;
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS app.itest_thread_touches (
          thread_id text NOT NULL
        );
        CREATE OR REPLACE FUNCTION app.itest_count_thread_touch()
        RETURNS trigger AS $$
        BEGIN
          INSERT INTO app.itest_thread_touches (thread_id) VALUES (NEW.id);
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE OR REPLACE TRIGGER itest_count_thread_touch
          AFTER UPDATE OF updated_at_ms ON app.threads
          FOR EACH ROW WHEN (NEW.id IN ('${plain}', '${root}', '${branch}'))
          EXECUTE FUNCTION app.itest_count_thread_touch();
      `);
      for (const threadId of [plain, branch]) {
        await store.beginTurn({
          organizationId: ctx.orgId,
          threadId,
          userParts: [{ type: 'text', text: 'one touch for the question' }],
        });
        opened.push(threadId);
      }
      const counted = await sql<{ threadId: string; touches: number }[]>`
        SELECT thread_id AS "threadId", count(*)::int AS touches
        FROM app.itest_thread_touches
        WHERE thread_id IN ${sql(threads)}
        GROUP BY thread_id
      `;
      const touchesOf = (threadId: string): number =>
        counted.find((row) => row.threadId === threadId)?.touches ?? 0;
      record(
        'chat turn writes: a turn open touches its thread row once, and a branch its root once',
        touchesOf(plain) === 1 &&
          touchesOf(branch) === 1 &&
          touchesOf(root) === 1,
        `thread=${touchesOf(plain)}, branch=${touchesOf(branch)}, root=${touchesOf(root)} (want 1 each; a touch per appended row made 2)`,
      );
      const stamps = await sql<
        { updatedAt: number; lastReplyAt: number | null; newest: number }[]
      >`
        SELECT t.updated_at_ms::float8 AS "updatedAt",
               tm.last_reply_at_ms::float8 AS "lastReplyAt",
               (SELECT max(m.created_at_ms) FROM app.messages m
                WHERE m.thread_id = t.id)::float8 AS newest
        FROM app.threads t JOIN app.thread_metadata tm ON tm.thread_id = t.id
        WHERE t.id = ${plain}
      `;
      const stamp = stamps[0];
      record(
        'chat turn writes: the one touch keeps the list order and the unread watermark at the newest row',
        stamp !== undefined &&
          stamp.lastReplyAt === stamp.updatedAt &&
          stamp.updatedAt >= stamp.newest,
        `updatedAt=${stamp?.updatedAt}, lastReplyAt=${stamp?.lastReplyAt}, newest message=${stamp?.newest} (want lastReplyAt = updatedAt >= newest)`,
      );
    },
  );
}

/**
 * A turn that ends with its placeholder still pending (its settle never
 * landed) fails that placeholder, found by the id its generation row names.
 * A second pending row in the thread, which no open writes, stands in for
 * every other row of the thread: the end of the turn leaves it alone.
 */
async function checkPlaceholderById(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: RecordCheck,
): Promise<void> {
  const store = createPgTurnStore(sql);
  const threadId = await createThread(sql, {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    kind: 'direct',
    title: 'Turn writes: the end of a turn',
  });
  await withCleanup(
    [
      [
        'ends the turn',
        () => store.endGeneration({ organizationId: ctx.orgId, threadId }),
      ],
      [
        'deletes its thread',
        () => sql`DELETE FROM app.threads WHERE id = ${threadId}`,
      ],
    ],
    async () => {
      const opened = await store.beginTurn({
        organizationId: ctx.orgId,
        threadId,
        userParts: [{ type: 'text', text: 'a reply that never settles' }],
      });
      const stray = await appendMessageRow(sql, {
        organizationId: ctx.orgId,
        threadId,
        role: 'assistant',
        parts: [],
        status: 'pending',
      });
      await store.endGeneration({ organizationId: ctx.orgId, threadId });
      const rows = await sql<
        { id: string; status: string; error: string | null }[]
      >`
        SELECT id, status, error FROM app.messages WHERE thread_id = ${threadId}
      `;
      const rowOf = (id: string) => rows.find((row) => row.id === id);
      const placeholder = rowOf(opened.assistantMessage.id);
      const generations = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.generations
        WHERE thread_id = ${threadId}
      `;
      record(
        'chat turn writes: the end of a turn fails its own unsettled placeholder by id and leaves the thread’s other rows alone',
        placeholder?.status === 'failed' &&
          (placeholder.error ?? '').includes(
            'the turn ended before its reply settled',
          ) &&
          rowOf(stray.id)?.status === 'pending' &&
          generations[0]?.count === 0,
        `placeholder=${placeholder?.status} (want failed, with the unsettled-turn envelope), other pending row=${rowOf(stray.id)?.status} (want pending), generation rows=${generations[0]?.count} (want 0)`,
      );
    },
  );
}

/**
 * Expired send keys stay through a keyed send and leave through the sweep:
 * a bounded run takes its batch budget, a key a send holds is skipped, and
 * the hourly job drains the rest while live keys stay.
 */
async function checkSendKeySweep(sql: Sql, record: RecordCheck): Promise<void> {
  const now = Date.now();
  const hour = 3_600_000;
  const prefix = `itest-send-keys-${randomUUID()}`;
  const orgs = [`${prefix}-org-a`, `${prefix}-org-b`];
  const expired: Array<{ orgId: string; scopeKey: string }> = [];
  const live: string[] = [];
  const fresh = `${prefix}-fresh`;
  const seed = async (
    orgId: string,
    scopeKey: string,
    expiresAt: number,
  ): Promise<void> => {
    await sql`
      INSERT INTO app.chat_send_idempotency (
        org_id, scope_key, request_hash, thread_id, message_id, response,
        received_at_ms, expires_at_ms
      ) VALUES (
        ${orgId}, ${scopeKey}, 'itest-request', 'itest-thread',
        'itest-message', ${sql.json({ status: 'accepted' })},
        ${expiresAt - 24 * hour}, ${expiresAt}
      )
    `;
  };
  const surviving = async (): Promise<Set<string>> => {
    const rows = await sql<{ scopeKey: string }[]>`
      SELECT scope_key AS "scopeKey" FROM app.chat_send_idempotency
      WHERE org_id IN ${sql(orgs)}
    `;
    return new Set(rows.map((row) => row.scopeKey));
  };
  await withCleanup(
    [
      [
        'deletes its keys',
        () =>
          sql`DELETE FROM app.chat_send_idempotency WHERE org_id IN ${sql(orgs)}`,
      ],
    ],
    async () => {
      for (const orgId of orgs) {
        for (let index = 0; index < 3; index += 1) {
          const scopeKey = `${orgId}-expired-${index}`;
          await seed(orgId, scopeKey, now - hour);
          expired.push({ orgId, scopeKey });
        }
        await seed(orgId, `${orgId}-live`, now + hour);
        live.push(`${orgId}-live`);
      }
      const [orgA = ''] = orgs;

      // A keyed send claims and remembers its own key, and sweeps nothing.
      await sql.begin(async (tx) => {
        const claim = await claimSendIdempotency(tx, {
          organizationId: orgA,
          scopeKey: fresh,
          requestHash: 'itest-request',
          threadId: 'itest-thread',
          now,
        });
        if (claim.kind !== 'claimed') {
          throw new Error(`the fresh key's claim answered ${claim.kind}`);
        }
        await rememberAcceptedSend(tx, {
          organizationId: orgA,
          scopeKey: fresh,
          messageId: 'itest-message',
          response: { status: 'accepted' },
        });
      });
      const afterSend = await surviving();
      const expiredAfterSend = expired.filter((key) =>
        afterSend.has(key.scopeKey),
      ).length;
      record(
        'chat turn writes: a keyed send leaves its organization’s expired keys to the sweep',
        expiredAfterSend === expired.length && afterSend.has(fresh),
        `expired keys kept=${expiredAfterSend} (want ${expired.length}), the send's own key stored=${afterSend.has(fresh)}`,
      );

      // A run is bounded: two batches of two take four keys though at least
      // six are due. Other lanes' keys could be due as well, so the proof is
      // the count, not which four went.
      const bounded = await sweepExpiredSendKeys(sql, {
        batch: 2,
        maxBatches: 2,
      });
      const afterBounded = await surviving();
      const left = expired.filter((key) => afterBounded.has(key.scopeKey));
      record(
        'chat turn writes: a send-key sweep stops at its batch budget',
        bounded.deleted === 4 && !bounded.drained && left.length >= 1,
        `deleted=${bounded.deleted} (want 4), drained=${bounded.drained} (want false), seeded expired keys left=${left.length} (want >= 1)`,
      );

      // A key a send holds (a claim taking it over) is skipped, not waited
      // on: the sweep finishes while the lock is held, and the key stays.
      const [held] = left;
      if (held === undefined) {
        throw new Error('no expired key was left to hold');
      }
      let skipped: SendKeySweep | undefined;
      await sql.begin(async (tx) => {
        await tx`
          SELECT scope_key FROM app.chat_send_idempotency
          WHERE org_id = ${held.orgId} AND scope_key = ${held.scopeKey}
          FOR UPDATE
        `;
        skipped = await sweepExpiredSendKeys(sql);
      });
      const afterHeld = await surviving();
      const othersLeft = expired.filter(
        (key) => key.scopeKey !== held.scopeKey && afterHeld.has(key.scopeKey),
      ).length;
      record(
        'chat turn writes: a send-key sweep skips a key a send holds',
        skipped?.drained === true &&
          afterHeld.has(held.scopeKey) &&
          othersLeft === 0,
        `drained=${skipped?.drained} (want true), held key kept=${afterHeld.has(held.scopeKey)}, other expired keys left=${othersLeft} (want 0)`,
      );

      // The hourly job takes what is left, and only what has expired.
      const handler = createTaskList({ sql })['chat.send_idempotency_gc'];
      if (handler === undefined) {
        throw new Error('no chat.send_idempotency_gc handler in the task list');
      }
      await handler({});
      const afterJob = await surviving();
      record(
        'chat turn writes: the hourly job deletes the expired send keys and keeps the live ones',
        !afterJob.has(held.scopeKey) &&
          live.every((scopeKey) => afterJob.has(scopeKey)) &&
          afterJob.has(fresh),
        `held key gone=${!afterJob.has(held.scopeKey)}, live keys kept=${live.filter((scopeKey) => afterJob.has(scopeKey)).length} of ${live.length}, fresh key kept=${afterJob.has(fresh)}`,
      );
    },
  );
}
