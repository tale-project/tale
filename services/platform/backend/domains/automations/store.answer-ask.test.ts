// @vitest-environment node
/**
 * Unit lock for the run scope of `answerAsk`: the REST door names the run
 * in its URL, and the locked read must carry that run — an ask of another
 * run is "not found", never answered. Regression guard for the one SQL
 * fragment that keeps the two doors apart.
 */
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { answerAsk } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?').replace(/\s+/g, ' '), values });
    return Promise.resolve([]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.begin = (callback: (tx: unknown) => Promise<unknown>) => callback(fn);
  return { sql: fn as unknown as Sql, statements };
}

const args = {
  organizationId: 'org-1',
  askId: 'ask-1',
  answer: 'The February rate.',
  answeredBy: 'user-9',
};

describe('answerAsk', () => {
  it('locks the ask under the run the caller named — another run’s ask is not found', async () => {
    const { sql, statements } = fakeSql();
    await expect(
      answerAsk(sql, { ...args, runId: 'run-B' }),
    ).rejects.toMatchObject({ code: 'HUMAN_ASK_NOT_FOUND' });
    const scoped = statements.find((st) => st.text.includes('run_id = ?'));
    expect(scoped?.values).toContain('run-B');
    const read = statements.find((st) => st.text.includes('FOR UPDATE'));
    expect(read?.values).toContain('org-1');
    expect(read?.values).toContain('ask-1');
  });

  it('reads without a run predicate when no run is named (the app door)', async () => {
    const { sql, statements } = fakeSql();
    await expect(answerAsk(sql, args)).rejects.toMatchObject({
      code: 'HUMAN_ASK_NOT_FOUND',
    });
    expect(statements.some((st) => st.text.includes('run_id = ?'))).toBe(false);
  });
});
