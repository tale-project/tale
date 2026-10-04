import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  createKnowledgeEntry,
  getKnowledgeEntryVersions,
  KnowledgeEntryError,
  updateKnowledgeEntry,
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

async function raceWrites(
  sql: Sql,
  firstWrite: (db: Sql) => Promise<KnowledgeEntryWritten>,
  secondWrite: (db: Sql) => Promise<KnowledgeEntryWritten>,
): Promise<PromiseSettledResult<KnowledgeEntryWritten>[]> {
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
        (strings.join('').includes('SELECT id, topic, document_id') ||
          strings.join('').includes('SELECT ke.id, ke.status'))
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
      return (
        callback: (tx: TransactionSql) => Promise<KnowledgeEntryWritten>,
      ) =>
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
  let second: Promise<KnowledgeEntryWritten> | undefined;
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
    return await Promise.allSettled([first, second]);
  } finally {
    admitFirst.release();
    prepared.release();
    proceed.release();
    await Promise.allSettled(second === undefined ? [first] : [first, second]);
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
