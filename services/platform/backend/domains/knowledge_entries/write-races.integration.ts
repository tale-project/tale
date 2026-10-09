import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  createKnowledgeEntry,
  getKnowledgeEntryVersions,
  KnowledgeEntryError,
  updateKnowledgeEntry,
  upsertKnowledgeEntryByTopic,
  type AgentKnowledgeEntryWrite,
  type KnowledgeEntryWritten,
} from './service.ts';

interface Writer {
  organizationId: string;
  userId: string;
  role: string;
}

function gate() {
  let release = () => {};
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

/** The reads each write path decides on before its transaction — the
 * topic's entry (a person's create, an agent's write by topic) and the row
 * a person's edit names. */
const PRECHECK_READS = [
  'SELECT id, topic, document_id',
  'SELECT ke.id, ke.status',
];

async function raceWrites<A, B = A>(
  sql: Sql,
  firstWrite: (db: Sql) => Promise<A>,
  secondWrite: (db: Sql) => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const prepared = gate();
  const proceed = gate();
  const prechecked = gate();
  const admitFirst = gate();
  let prechecks = 0;
  let transactions = 0;
  let firstPid = 0;
  let secondPrepared = false;
  const raced = new Proxy(sql, {
    apply(query, thisArg, args: unknown[]) {
      const strings = args[0];
      if (
        Array.isArray(strings) &&
        PRECHECK_READS.some((read) => strings.join('').includes(read))
      ) {
        const ordinal = ++prechecks;
        return (async () => {
          const rows: unknown = await Reflect.apply(query, thisArg, args);
          if (ordinal === 1) {
            prechecked.release();
            await admitFirst.reached;
          } else {
            admitFirst.release();
            await prepared.reached;
          }
          return rows;
        })();
      }
      return Reflect.apply(query, thisArg, args);
    },
    get(target, property, receiver) {
      if (property !== 'begin') return Reflect.get(target, property, receiver);
      return (callback: (tx: TransactionSql) => Promise<unknown>) =>
        target.begin(async (tx) => {
          const ordinal = ++transactions;
          const [session] = await tx<{ pid: number }[]>`
            SELECT pg_backend_pid() AS pid
          `;
          if (ordinal === 1) firstPid = session?.pid ?? 0;
          const interleaved = new Proxy(tx, {
            apply(query, thisArg, args: unknown[]) {
              const strings = args[0];
              if (
                Array.isArray(strings) &&
                strings.join('').includes('INSERT INTO app.knowledge_entries')
              ) {
                if (ordinal === 1) prepared.release();
                else secondPrepared = true;
                return proceed.reached.then(() =>
                  Reflect.apply(query, thisArg, args),
                );
              }
              return Reflect.apply(query, thisArg, args);
            },
          });
          return callback(interleaved);
        });
    },
  });
  const first = firstWrite(raced);
  const settledFirst = Promise.allSettled([first]);
  let second: Promise<B> | undefined;
  try {
    await Promise.race([
      prechecked.reached,
      settledFirst.then(() => {
        throw new Error('first writer failed before its precheck');
      }),
    ]);
    second = secondWrite(raced);
    const settledSecond = Promise.allSettled([second]);
    await Promise.race([
      prepared.reached,
      settledFirst.then(() => {
        throw new Error('first writer failed before its insert');
      }),
      settledSecond.then(() => {
        throw new Error('second writer failed before its precheck');
      }),
    ]);
    let secondFinished = false;
    void settledSecond.then(() => {
      secondFinished = true;
    });
    const deadline = Date.now() + 10_000;
    let blocked = false;
    while (Date.now() < deadline) {
      if (secondPrepared || secondFinished) break;
      const [row] = await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database()
            AND ${firstPid}::int = ANY(pg_blocking_pids(pid))
        ) AS blocked
      `;
      blocked = row?.blocked ?? false;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      blocked || secondPrepared,
      'the second real transaction must reach the insert or wait for the first',
    );
    proceed.release();
    const [firstSettled] = await Promise.allSettled([first]);
    const [secondSettled] = await Promise.allSettled([second]);
    return [firstSettled, secondSettled];
  } finally {
    admitFirst.release();
    prepared.release();
    proceed.release();
    await Promise.allSettled([first]);
    if (second !== undefined) await Promise.allSettled([second]);
  }
}

function winnerAndConflict(
  results: PromiseSettledResult<KnowledgeEntryWritten>[],
  code: string,
): KnowledgeEntryWritten {
  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1, 'exactly one concurrent writer commits');
  assert.equal(losers.length, 1, 'exactly one concurrent writer conflicts');
  const loser: unknown = losers[0]?.reason;
  assert.ok(loser instanceof KnowledgeEntryError);
  assert.equal(loser.status, 409);
  assert.equal(loser.code, code);
  const winner = winners[0]?.value;
  assert.ok(winner);
  return winner;
}

export async function checkConcurrentEntryCreation(
  sql: Sql,
  writer: Writer,
): Promise<void> {
  const topic = `Refund policy ${randomUUID()}`;
  const results = await raceWrites(
    sql,
    (db) => createKnowledgeEntry(db, { ...writer, topic, content: '30 days' }),
    (db) =>
      createKnowledgeEntry(db, {
        ...writer,
        topic: topic.toUpperCase(),
        content: '60 days',
      }),
  );
  const winner = winnerAndConflict(results, 'KNOWLEDGE_ENTRY_DUPLICATE');
  const entries = await sql<{ id: string; documentId: string }[]>`
    SELECT id, document_id AS "documentId" FROM app.knowledge_entries
    WHERE org_id = ${writer.organizationId} AND topic_key = ${topic.toLowerCase()}
      AND status = 'active' AND deleted_at_ms IS NULL
  `;
  assert.deepEqual([...entries], [winner]);
  const documents = await sql<{ id: string }[]>`
    SELECT id FROM app.documents
    WHERE org_id = ${writer.organizationId} AND lower(title) = ${`${topic}.md`.toLowerCase()}
  `;
  assert.deepEqual([...documents], [{ id: winner.documentId }]);
  await assert.rejects(
    createKnowledgeEntry(sql, { ...writer, topic, content: '90 days' }),
    { code: 'KNOWLEDGE_ENTRY_DUPLICATE', status: 409 },
  );
}

export async function checkConcurrentEntryUpdates(
  sql: Sql,
  writer: Writer,
  readBlob: (ref: string) => Promise<string>,
  rename = false,
): Promise<void> {
  const topic = `Support hours ${randomUUID()}`;
  const initial = await createKnowledgeEntry(sql, {
    ...writer,
    topic,
    content: '9–5',
  });
  const results = await raceWrites(
    sql,
    (db) =>
      updateKnowledgeEntry(db, {
        ...writer,
        entryId: initial.id,
        topic: rename ? `${topic} weekdays` : topic,
        content: '9–6',
      }),
    (db) =>
      updateKnowledgeEntry(db, {
        ...writer,
        entryId: initial.id,
        topic: rename ? `${topic} weekends` : topic,
        content: '10–7',
      }),
  );
  const winner = winnerAndConflict(results, 'KNOWLEDGE_ENTRY_SUPERSEDED');
  assert.equal(winner.documentId, initial.documentId);
  const versions = await getKnowledgeEntryVersions(
    sql,
    writer.organizationId,
    initial.id,
  );
  assert.equal(versions.length, 2);
  const current = versions[0];
  assert.ok(current);
  assert.equal(current.id, winner.id);
  assert.equal(current.status, 'active');
  assert.equal(versions[1]?.status, 'superseded');
  assert.equal(versions[1]?.supersededBy, winner.id);
  assert.ok(versions[1]?.supersededAt);
  const [document] = await sql<{ fileRef: string }[]>`
    SELECT file_ref AS "fileRef" FROM app.documents WHERE id = ${winner.documentId}
  `;
  assert.ok(document);
  assert.equal(await readBlob(document.fileRef), current.content);
  assert.deepEqual(
    await updateKnowledgeEntry(sql, {
      ...writer,
      entryId: winner.id,
      topic: current.topic,
      content: current.content,
    }),
    winner,
  );
  assert.equal(
    (await getKnowledgeEntryVersions(sql, writer.organizationId, winner.id))
      .length,
    2,
  );
  await assert.rejects(
    updateKnowledgeEntry(sql, {
      ...writer,
      entryId: initial.id,
      topic,
      content: 'Later',
    }),
    { code: 'KNOWLEDGE_ENTRY_SUPERSEDED', status: 409 },
  );
  if (rename) {
    const reused = await createKnowledgeEntry(sql, {
      ...writer,
      topic,
      content: 'New independent fact',
    });
    assert.notEqual(reused.documentId, winner.documentId);
    assert.equal(
      (await getKnowledgeEntryVersions(sql, writer.organizationId, initial.id))
        .length,
      2,
    );
  }
}

export async function checkConcurrentEntryRenameAndCreate(
  sql: Sql,
  writer: Writer,
): Promise<void> {
  const topic = `Office ${randomUUID()}`;
  const initial = await createKnowledgeEntry(sql, {
    ...writer,
    topic,
    content: 'Old address',
  });
  const destination = `${topic} address`;
  const results = await raceWrites(
    sql,
    (db) =>
      updateKnowledgeEntry(db, {
        ...writer,
        entryId: initial.id,
        topic: destination,
        content: 'New address',
      }),
    (db) =>
      createKnowledgeEntry(db, {
        ...writer,
        topic: destination.toUpperCase(),
        content: 'Other address',
      }),
  );
  const winner = winnerAndConflict(results, 'KNOWLEDGE_ENTRY_DUPLICATE');
  assert.equal(winner.documentId, initial.documentId);
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.knowledge_entries
    WHERE org_id = ${writer.organizationId} AND topic_key = ${destination.toLowerCase()}
      AND status = 'active' AND deleted_at_ms IS NULL
  `;
  assert.deepEqual([...rows], [{ id: winner.id }]);
}

function settledValue<T>(result: PromiseSettledResult<T>, who: string): T {
  if (result.status === 'rejected') {
    throw new Error(`${who} failed: ${String(result.reason)}`, {
      cause: result.reason,
    });
  }
  return result.value;
}

async function activeRowsOf(
  sql: Sql,
  organizationId: string,
  topic: string,
): Promise<
  { id: string; content: string; source: string; createdBy: string }[]
> {
  return [
    ...(await sql<
      { id: string; content: string; source: string; createdBy: string }[]
    >`
      SELECT id, content, source, created_by AS "createdBy"
      FROM app.knowledge_entries
      WHERE org_id = ${organizationId} AND topic_key = ${topic.toLowerCase()}
        AND status = 'active' AND deleted_at_ms IS NULL
    `),
  ];
}

/** Two agents write one new topic at once: the first creates it, and the
 * second — naming no version, as a first write does — is refused with the
 * text that won, so it can merge instead of overwriting. One entry, one
 * document, and the audit trail names the agent that wrote. */
export async function checkConcurrentAgentCreates(
  sql: Sql,
  writer: Writer,
): Promise<void> {
  const topic = `Holiday closure ${randomUUID()}`;
  const [first, second] = await raceWrites<AgentKnowledgeEntryWrite>(
    sql,
    (db) =>
      upsertKnowledgeEntryByTopic(db, {
        organizationId: writer.organizationId,
        actorId: 'race-agent-a',
        topic,
        content: 'Closed 24–26 December',
      }),
    (db) =>
      upsertKnowledgeEntryByTopic(db, {
        organizationId: writer.organizationId,
        actorId: 'race-agent-b',
        topic: topic.toUpperCase(),
        content: 'Closed 24 December to 1 January',
      }),
  );
  const winner = settledValue(first, 'the first agent');
  assert.equal(winner.outcome, 'created');
  assert.ok(winner.outcome === 'created');
  assert.deepEqual(settledValue(second, 'the second agent'), {
    outcome: 'refused',
    reason: 'version_required',
    current: {
      versionId: winner.versionId,
      topic,
      content: 'Closed 24–26 December',
      updatedAt: (
        await getKnowledgeEntryVersions(
          sql,
          writer.organizationId,
          winner.versionId,
        )
      )[0]?.createdAt,
    },
  });
  assert.deepEqual(await activeRowsOf(sql, writer.organizationId, topic), [
    {
      id: winner.versionId,
      content: 'Closed 24–26 December',
      source: 'agent',
      createdBy: 'race-agent-a',
    },
  ]);
  const documents = await sql<{ id: string }[]>`
    SELECT id FROM app.documents
    WHERE org_id = ${writer.organizationId} AND lower(title) = ${`${topic}.md`.toLowerCase()}
  `;
  assert.deepEqual([...documents], [{ id: winner.documentId }]);
  const audits = await sql<
    { action: string; actorId: string; viaAgent: unknown }[]
  >`
    SELECT action, actor_id AS "actorId", metadata->'viaAgent' AS "viaAgent"
    FROM app.audit_logs
    WHERE org_id = ${writer.organizationId}
      AND resource_type = 'knowledge_entry'
      AND resource_id = ${winner.versionId}
  `;
  assert.deepEqual(
    [...audits],
    [
      {
        action: 'knowledge_entry.created',
        actorId: 'race-agent-a',
        viaAgent: true,
      },
    ],
  );
}

/** An agent and a person change one fact at once, each onto the version
 * they read. Whoever commits first wins: the person's later edit gets the
 * normal 409, and the agent's later write is refused with the person's
 * text. Either way the chain holds two versions and one active row. */
export async function checkConcurrentAgentAndPersonEdits(
  sql: Sql,
  writer: Writer,
): Promise<void> {
  const agentFirst = `Return window ${randomUUID()}`;
  const before = await createKnowledgeEntry(sql, {
    ...writer,
    topic: agentFirst,
    content: '30 days',
  });
  const [agentWon, personLost] = await raceWrites<
    AgentKnowledgeEntryWrite,
    KnowledgeEntryWritten
  >(
    sql,
    (db) =>
      upsertKnowledgeEntryByTopic(db, {
        organizationId: writer.organizationId,
        actorId: 'race-agent-a',
        topic: agentFirst,
        content: '45 days',
        expectedVersionId: before.id,
      }),
    (db) =>
      updateKnowledgeEntry(db, {
        ...writer,
        entryId: before.id,
        topic: agentFirst,
        content: '60 days',
      }),
  );
  const agentWrite = settledValue(agentWon, 'the agent');
  assert.equal(agentWrite.outcome, 'updated');
  assert.ok(agentWrite.outcome === 'updated');
  assert.equal(agentWrite.previousVersionId, before.id);
  assert.equal(agentWrite.documentId, before.documentId);
  assert.equal(personLost.status, 'rejected');
  const personError: unknown =
    personLost.status === 'rejected' ? personLost.reason : undefined;
  assert.ok(personError instanceof KnowledgeEntryError);
  assert.equal(personError.code, 'KNOWLEDGE_ENTRY_SUPERSEDED');
  assert.deepEqual(await activeRowsOf(sql, writer.organizationId, agentFirst), [
    {
      id: agentWrite.versionId,
      content: '45 days',
      source: 'agent',
      createdBy: 'race-agent-a',
    },
  ]);
  assert.equal(
    (await getKnowledgeEntryVersions(sql, writer.organizationId, before.id))
      .length,
    2,
  );

  const personFirst = `Delivery time ${randomUUID()}`;
  const read = await createKnowledgeEntry(sql, {
    ...writer,
    topic: personFirst,
    content: '3 days',
  });
  const [personWon, agentLost] = await raceWrites<
    KnowledgeEntryWritten,
    AgentKnowledgeEntryWrite
  >(
    sql,
    (db) =>
      updateKnowledgeEntry(db, {
        ...writer,
        entryId: read.id,
        topic: personFirst,
        content: '5 days',
      }),
    (db) =>
      upsertKnowledgeEntryByTopic(db, {
        organizationId: writer.organizationId,
        actorId: 'race-agent-b',
        topic: personFirst,
        content: '2 days',
        expectedVersionId: read.id,
      }),
  );
  const personWrite = settledValue(personWon, 'the person');
  const refused = settledValue(agentLost, 'the agent');
  assert.equal(refused.outcome, 'refused');
  assert.ok(refused.outcome === 'refused');
  assert.equal(refused.reason, 'version_conflict');
  assert.equal(refused.current?.versionId, personWrite.id);
  assert.equal(refused.current?.content, '5 days');
  assert.deepEqual(
    await activeRowsOf(sql, writer.organizationId, personFirst),
    [
      {
        id: personWrite.id,
        content: '5 days',
        source: 'manual',
        createdBy: writer.userId,
      },
    ],
  );
}

/** Agents' writes draw on a budget of their own: with it spent, a write is
 * answered with a time to wait and stores nothing, while the budget
 * people's edits share is untouched. */
export async function checkAgentWriteBudget(
  sql: Sql,
  writer: Writer,
): Promise<void> {
  const key = `org:${writer.organizationId}`;
  const topic = `Budget probe ${randomUUID()}`;
  const [shared] = await sql<{ value: number }[]>`
    SELECT value FROM app.rate_limits
    WHERE name = 'knowledge:mutate' AND key = ${key}
  `;
  await sql`
    INSERT INTO app.rate_limits (name, key, value, ts)
    VALUES ('knowledge:agent-write', ${key}, 0, ${Date.now()})
    ON CONFLICT (name, key) DO UPDATE SET value = 0, ts = EXCLUDED.ts
  `;
  try {
    const answer = await upsertKnowledgeEntryByTopic(sql, {
      organizationId: writer.organizationId,
      actorId: 'race-agent-a',
      topic,
      content: 'Never stored',
    });
    assert.equal(answer.outcome, 'rate_limited');
    assert.ok(answer.outcome === 'rate_limited');
    assert.ok(answer.retryAfterMs > 0);
    assert.deepEqual(await activeRowsOf(sql, writer.organizationId, topic), []);
    const [after] = await sql<{ value: number }[]>`
      SELECT value FROM app.rate_limits
      WHERE name = 'knowledge:mutate' AND key = ${key}
    `;
    assert.deepEqual(after, shared);
  } finally {
    await sql`
      DELETE FROM app.rate_limits
      WHERE name = 'knowledge:agent-write' AND key = ${key}
    `;
  }
}
