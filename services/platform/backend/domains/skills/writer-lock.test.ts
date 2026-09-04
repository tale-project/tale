// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { skillWriterLockKey, withSkillWriterLock } from './writer-lock.ts';

/**
 * The regression under test: `writeSkillBundleFiles` documents that callers
 * serialize writers per (org, slug), but only the upload lane took the
 * advisory lock — the editor's save and delete wrote unlocked, so a save
 * landing between an upload's aside-rename and commit-rename stranded the
 * previous bundle. Every door now goes through this one helper; the tests
 * pin the key and the protocol (lock first, inside one transaction).
 */

interface Recorded {
  text: string;
  values: unknown[];
}

/** A `sql` double whose `begin` hands the callback a recording tag. */
function fakeSql(): { sql: Sql; statements: Recorded[]; events: string[] } {
  const statements: Recorded[] = [];
  const events: string[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    events.push('lock');
    return Promise.resolve([]);
  };
  const begin = async (
    callback: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    events.push('begin');
    try {
      const out = await callback(tx);
      events.push('commit');
      return out;
    } catch (error) {
      events.push('rollback');
      throw error;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: { begin } as unknown as Sql, statements, events };
}

describe('withSkillWriterLock', () => {
  it('keys the lock exactly as the upload lane always did', () => {
    expect(skillWriterLockKey('org-1', 'house-voice')).toBe(
      'skill:org-1:house-voice',
    );
  });

  it('takes the advisory lock before the work runs, inside one transaction', async () => {
    const { sql, statements, events } = fakeSql();

    const result = await withSkillWriterLock(
      sql,
      'org-1',
      'house-voice',
      async () => {
        events.push('work');
        return 'written';
      },
    );

    expect(result).toBe('written');
    expect(events).toEqual(['begin', 'lock', 'work', 'commit']);
    expect(statements[0]?.text).toMatch(
      /^SELECT pg_advisory_xact_lock\(\s*hashtext\(\?\)\s*\)$/,
    );
    expect(statements[0]?.values).toEqual(['skill:org-1:house-voice']);
  });

  it('rolls the transaction back and rethrows when the work fails', async () => {
    const { sql, events } = fakeSql();

    await expect(
      withSkillWriterLock(sql, 'org-1', 'house-voice', async () => {
        throw new Error('disk on fire');
      }),
    ).rejects.toThrow('disk on fire');
    expect(events).toEqual(['begin', 'lock', 'rollback']);
  });
});
