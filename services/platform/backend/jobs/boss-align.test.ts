// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { alignQueuePolicies } from './boss.ts';

describe('alignQueuePolicies', () => {
  it('sets org.scaffold to short when the row still says otherwise', async () => {
    const seen: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      seen.push(strings.join(''));
      return Promise.resolve([]);
    }) as unknown as Sql;

    await alignQueuePolicies(sql);
    expect(seen[0]).toContain('org.scaffold');
    expect(seen[0]).toContain("'short'");
  });

  it('swallows a missing pgboss schema instead of failing boot', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sql = (() =>
      Promise.reject(
        new Error('relation "pgboss.queue" does not exist'),
      )) as unknown as Sql;

    await expect(alignQueuePolicies(sql)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
