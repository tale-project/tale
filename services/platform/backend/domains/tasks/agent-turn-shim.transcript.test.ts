// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { TimelinePart } from '../../../lib/harnesses/timeline';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

/**
 * The op row's live transcript: a flush is FOLDED into the stored
 * `live_timeline`, read under the row lock in the transaction that writes
 * the merge — never picked against it by length. The real-Postgres proof
 * (the conflict clause, concurrent flushes all landing) rides
 * `integration-check.ts` (`checkSessionOpTranscriptMerge`); this pins the
 * handler's shape and what it writes.
 */

interface Statement {
  text: string;
  values: unknown[];
  inTransaction: boolean;
}

/** A root `sql` whose `begin` runs the callback on the same tag. Each locked
 * read answers the next entry of `reads`; `json` marks its value, so a test
 * can read back the transcript each write carried. */
function fakeSql(reads: Array<Array<{ liveTimeline: TimelinePart[] | null }>>) {
  const statements: Statement[] = [];
  let inTransaction = false;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text: query, values, inTransaction });
    return Promise.resolve(
      query.startsWith('SELECT') ? (reads.shift() ?? []) : [{ id: 'op-1' }],
    );
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
  });
  const sql = Object.assign(tx, {
    begin: async (callback: (tx: TransactionSql) => unknown) => {
      inTransaction = true;
      try {
        return await callback(tx as unknown as TransactionSql);
      } finally {
        inTransaction = false;
      }
    },
  });
  return { sql: sql as unknown as Sql, statements };
}

/** The transcript each op upsert carried, in order (`null` = none). */
function writtenTranscripts(statements: readonly Statement[]): unknown[] {
  return statements
    .filter((statement) => statement.text.startsWith('INSERT'))
    .map((statement) => {
      const marked = statement.values.find(
        (value): value is { json: unknown } =>
          typeof value === 'object' && value !== null && 'json' in value,
      );
      return marked?.json ?? null;
    });
}

function flush(sql: Sql, liveTimeline?: TimelinePart[]): Promise<unknown> {
  const upsert =
    agentTurnShimHandlers(sql)['sandbox/session_mutations:upsertSessionOp'];
  if (upsert === undefined) throw new Error('no upsertSessionOp handler');
  return upsert({
    organizationId: 'org-1',
    sessionId: 'session-1',
    execId: 'exec-1',
    kind: 'task-agent',
    status: 'running',
    ...(liveTimeline !== undefined ? { liveTimeline } : {}),
  });
}

function tool(id: string, state = 'output-available'): TimelinePart {
  return {
    type: 'tool-Bash',
    state,
    toolCallId: id,
    input: { command: `run ${id}` },
  };
}

function text(words: string): TimelinePart {
  return { type: 'text', text: words };
}

describe('upsertSessionOp — the live transcript', () => {
  it('reads the stored transcript FOR UPDATE in the transaction that writes the merge', async () => {
    const db = fakeSql([[{ liveTimeline: [tool('t1')] }]]);
    expect(await flush(db.sql, [tool('t2')])).toBe('op-1');
    expect(
      db.statements.map((statement) => [
        statement.text.split(' ')[0],
        statement.inTransaction,
      ]),
    ).toEqual([
      ['SELECT', true],
      ['INSERT', true],
    ]);
    expect(db.statements[0]?.text).toMatch(/FOR UPDATE$/);
    expect(db.statements[1]?.text).toContain(
      'live_timeline = coalesce(EXCLUDED.live_timeline, app.sandbox_session_ops.live_timeline)',
    );
    expect(writtenTranscripts(db.statements)).toEqual([
      [tool('t1'), tool('t2')],
    ]);
  });

  it('keeps the union when a disjoint segment of equal length arrives', async () => {
    // A fresh window whose ring buffer no longer holds the turn's head: as
    // long as the stored transcript, sharing none of its entries. A length
    // pick swapped the stored three for these three.
    const db = fakeSql([
      [{ liveTimeline: [text('Reading the brief'), tool('t1'), tool('t2')] }],
    ]);
    await flush(db.sql, [
      tool('t3'),
      text('Drafting the report'),
      tool('t4', 'input-available'),
    ]);
    expect(writtenTranscripts(db.statements)).toEqual([
      [
        text('Reading the brief'),
        tool('t1'),
        tool('t2'),
        tool('t3'),
        text('Drafting the report'),
        tool('t4', 'input-available'),
      ],
    ]);
  });

  it('deduplicates an overlapping segment, updating what it shares in place', async () => {
    const db = fakeSql([
      [
        {
          liveTimeline: [
            text('Reading the brief'),
            tool('t1'),
            text('Writing'),
            tool('t2', 'input-available'),
          ],
        },
      ],
    ]);
    await flush(db.sql, [
      tool('t1'),
      text('Writing the summary'),
      tool('t2'),
      tool('t3', 'input-available'),
    ]);
    expect(writtenTranscripts(db.statements)).toEqual([
      [
        text('Reading the brief'),
        tool('t1'),
        text('Writing the summary'),
        tool('t2'),
        tool('t3', 'input-available'),
      ],
    ]);
  });

  it('does not regress the stored transcript on a stale, shorter flush', async () => {
    const stored = [
      text('Reading the brief'),
      tool('t1'),
      text('Writing'),
      tool('t2'),
      tool('t3'),
    ];
    const db = fakeSql([[{ liveTimeline: stored }]]);
    await flush(db.sql, [text('Reading the brief'), tool('t1')]);
    expect(writtenTranscripts(db.statements)).toEqual([stored]);
  });

  it('writes without a transcript in one statement, leaving the stored one alone', async () => {
    const db = fakeSql([]);
    await flush(db.sql);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]?.text.split(' ')[0]).toBe('INSERT');
    expect(db.statements[0]?.inTransaction).toBe(false);
    expect(writtenTranscripts(db.statements)).toEqual([null]);
  });

  it('claims a missing row before merging, so a concurrent first write is folded in, not overwritten', async () => {
    // Nothing to lock on the first read; by the claim, a concurrent first
    // flush has inserted the row with its own transcript.
    const db = fakeSql([[], [{ liveTimeline: [tool('theirs')] }]]);
    await flush(db.sql, [tool('mine')]);
    expect(
      db.statements.map((statement) => statement.text.split(' ')[0]),
    ).toEqual(['SELECT', 'INSERT', 'SELECT', 'INSERT']);
    expect(db.statements.every((statement) => statement.inTransaction)).toBe(
      true,
    );
    expect(writtenTranscripts(db.statements)).toEqual([
      null,
      [tool('theirs'), tool('mine')],
    ]);
  });
});
