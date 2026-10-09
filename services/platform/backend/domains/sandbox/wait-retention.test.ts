// @vitest-environment node

/**
 * The sweep of what waiting for sandbox room leaves behind, against scripted
 * SQL: the statement shapes and the batch loop. The rows each statement
 * deletes on a real database are the integration lane's
 * (`checkWatchdogs` in `backend/integration-check.ts`).
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { sweepRoomWaitLeftovers } from './wait-retention.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted `sql`: each op-row and session-row DELETE pops its next answer;
 * every statement is recorded. */
function fakeSql(script: { ops?: number[]; sessions?: number[] }): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const rows = (count: number | undefined) =>
    Array.from({ length: count ?? 0 }, (_, index) => ({ id: `row-${index}` }));
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('DELETE FROM app.sandbox_session_ops')) {
      return Promise.resolve(rows(script.ops?.shift()));
    }
    if (text.includes('DELETE FROM app.sandbox_sessions')) {
      return Promise.resolve(rows(script.sessions?.shift()));
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- scripted postgres tag
  return { sql: fn as unknown as Sql, statements };
}

const sessionDeletes = (statements: Statement[]) =>
  statements.filter((statement) =>
    statement.text.includes('DELETE FROM app.sandbox_sessions'),
  );

describe('sweepRoomWaitLeftovers', () => {
  it('deletes a collected failed row a day after its collection', async () => {
    const now = 10_000_000_000;
    const { sql, statements } = fakeSql({});

    await sweepRoomWaitLeftovers(sql, { now });

    const [statement] = sessionDeletes(statements);
    expect(statement?.text).toContain("s.status = 'failed'");
    expect(statement?.text).toContain('s.destroyed_at_ms IS NOT NULL');
    expect(statement?.values).toContain(now - 24 * 60 * 60 * 1000);
  });

  // Collecting a failed create of an agent session keeps its workspace, and
  // the cleanup finds a project agent's workspace through its rows: the
  // newest row naming the id is what the unused rule and the agent and
  // member removals reach it by.
  it("keeps a project agent's newest row of its session id, deleting one only behind a newer row", async () => {
    const { sql, statements } = fakeSql({});

    await sweepRoomWaitLeftovers(sql, { now: 10_000_000_000 });

    const text = sessionDeletes(statements)[0]?.text.replace(/\s+/g, ' ');
    expect(text).toContain(
      "AND ( s.owner_type <> 'project_agent' OR EXISTS ( SELECT 1 FROM app.sandbox_sessions newer WHERE newer.session_id = s.session_id AND (newer.created_at_ms, newer.id) > (s.created_at_ms, s.id) ) )",
    );
  });

  it('deletes batch after batch until one comes back short, and counts the rows', async () => {
    const { sql, statements } = fakeSql({ ops: [2, 1], sessions: [2, 2, 0] });

    await expect(
      sweepRoomWaitLeftovers(sql, { now: 10_000_000_000, batch: 2 }),
    ).resolves.toEqual({ ops: 3, sessions: 4 });

    expect(sessionDeletes(statements)).toHaveLength(3);
  });
});
