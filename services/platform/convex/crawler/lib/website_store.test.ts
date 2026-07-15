import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  getWebsite,
  orgHasMembership,
  updateScanStatus,
} from './website_store';

/**
 * A fake postgres.js `Sql` whose `.unsafe(query, params)` records the call and
 * resolves the given rows. Each store function now takes its pool as the first
 * argument, so passing distinct fakes proves the query lands on the pool it was
 * handed — the per-org routing guarantee — instead of a shared default.
 */
function makeFakeSql(rows: unknown[] = []): {
  sql: Sql;
  unsafe: ReturnType<typeof vi.fn>;
} {
  const unsafe = vi.fn().mockResolvedValue(rows);
  return { sql: { unsafe } as unknown as Sql, unsafe };
}

describe('website_store tenant-pool routing', () => {
  it('runs each write on the exact pool it is handed, never a shared global', async () => {
    const a = makeFakeSql();
    const b = makeFakeSql();

    await updateScanStatus(a.sql, 'a.example', 'idle');
    await updateScanStatus(b.sql, 'b.example', 'idle');

    // Each org's pool received exactly its own write — nothing crossed over.
    expect(a.unsafe).toHaveBeenCalledTimes(1);
    expect(b.unsafe).toHaveBeenCalledTimes(1);
    expect(String(a.unsafe.mock.calls[0][0])).toContain('public_web.websites');
  });

  it('orgHasMembership queries the given pool and maps rows to a boolean', async () => {
    const empty = makeFakeSql([]);
    expect(await orgHasMembership(empty.sql, 'd.example', 'acme')).toBe(false);
    expect(empty.unsafe).toHaveBeenCalledTimes(1);
    expect(String(empty.unsafe.mock.calls[0][0])).toContain(
      'public_web.website_org_memberships',
    );

    const present = makeFakeSql([{ exists: 1 }]);
    expect(await orgHasMembership(present.sql, 'd.example', 'acme')).toBe(true);
  });

  it('getWebsite returns null when the handed pool has no matching row', async () => {
    const { sql, unsafe } = makeFakeSql([]);
    expect(await getWebsite(sql, 'missing.example')).toBeNull();
    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(String(unsafe.mock.calls[0][0])).toContain('public_web.websites');
  });
});
