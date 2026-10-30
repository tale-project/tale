/**
 * A start's activation of the row its own reserve made: by row id, and only
 * while that row is still `creating`, or `active` once a sibling turn of the
 * same owner resumed it. A Destroy that lands during the create settles the
 * row, and an activation by id alone would revive it, `active` under its
 * destroyed stamp. Both lanes that create a session — the agent hosts' shim
 * and the crawler's — activate through `activateCreatedSession`. The guard
 * is SQL, so its real-Postgres proof is `lifecycle.integration.ts`; this
 * holds the statements and the shims' answers.
 */

import { describe, expect, it } from 'vitest';

import { agentTurnShimHandlers } from '../tasks/agent-turn-shim.ts';
import { crawlHandlers } from '../websites/service.ts';
import { activateCreatedSession } from './sessions.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const GUARD = "WHERE id = ? AND status IN ('creating', 'active')";

/** Answers the activation with `moved` rows and records every statement. */
function fakeSql(moved: number) {
  const statements: Statement[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(
      text.includes(GUARD)
        ? Array.from({ length: moved }, () => ({ id: 'row-a' }))
        : [],
    );
  };
  return { sql: sql as never, statements };
}

describe('activateCreatedSession', () => {
  it('moves the row by id only while it is still its create’s [SBX-R11]', async () => {
    const { sql, statements } = fakeSql(1);

    await expect(activateCreatedSession(sql, 'row-a')).resolves.toBe(true);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(GUARD);
    expect(statements[0]?.values).toContain('row-a');
  });

  it('answers false for a row settled during the create [SBX-R11]', async () => {
    const { sql } = fakeSql(0);

    await expect(activateCreatedSession(sql, 'row-a')).resolves.toBe(false);
  });
});

describe.each([
  ['the agent hosts', agentTurnShimHandlers],
  ['the crawler', crawlHandlers],
] as const)('setSessionStatus for %s', (_lane, handlers) => {
  const verb = (sql: never) => {
    const handler = handlers(sql)['sandbox/session_mutations:setSessionStatus'];
    if (handler === undefined) throw new Error('missing setSessionStatus');
    return handler;
  };

  it('fails the start when its row was settled during the create [SBX-R11]', async () => {
    const { sql, statements } = fakeSql(0);

    await expect(
      verb(sql)({ rowId: 'row-a', status: 'active' }),
    ).rejects.toThrow('was settled while its sandbox was being created');
    // Never the write by id alone, which would revive the row.
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain(GUARD);
  });

  it('activates a row that is still its create’s [SBX-R11]', async () => {
    const { sql, statements } = fakeSql(1);

    await expect(
      verb(sql)({ rowId: 'row-a', status: 'active' }),
    ).resolves.toBeNull();
    expect(statements).toHaveLength(1);
  });

  it('still settles a failed create by row id', async () => {
    const { sql, statements } = fakeSql(0);

    await expect(
      verb(sql)({ rowId: 'row-a', status: 'failed' }),
    ).resolves.toBeNull();
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('WHERE id = ?');
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['failed', 'row-a']),
    );
  });
});
