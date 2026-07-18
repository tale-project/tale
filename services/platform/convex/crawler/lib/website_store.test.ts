import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SCAN_INTERVAL_SECONDS,
  ensureWebsiteRow,
  getWebsite,
  orgHasMembership,
  saveDiscoveredUrls,
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

/**
 * Background crawl chains resolve their pool per action, so a chain that
 * crosses an org's bring-your-own-database switch continues on a pool that
 * never saw `registerWebsite` — its `website_urls` writes died on
 * `website_urls_domain_fkey` (observed once on demo v0.3.6 one minute after
 * switching an org's knowledge DB to a fresh Neon instance). The parent row
 * must be ensured inside the same transaction as the URL insert.
 */
describe('ensureWebsiteRow self-heal', () => {
  it('upserts the websites parent and the org membership idempotently', async () => {
    const { sql, unsafe } = makeFakeSql();

    await ensureWebsiteRow(sql, 'docs.example', 'acme');

    expect(unsafe).toHaveBeenCalledTimes(2);
    const [websitesSql, websitesParams] = unsafe.mock.calls[0];
    expect(String(websitesSql)).toContain('INSERT INTO public_web.websites');
    expect(String(websitesSql)).toContain('ON CONFLICT (domain) DO NOTHING');
    expect(websitesParams).toEqual([
      'docs.example',
      DEFAULT_SCAN_INTERVAL_SECONDS,
    ]);
    const [membershipSql, membershipParams] = unsafe.mock.calls[1];
    expect(String(membershipSql)).toContain(
      'INSERT INTO public_web.website_org_memberships',
    );
    expect(membershipParams).toEqual(['docs.example', 'acme']);
  });

  it('skips the membership insert when no org slug is in hand', async () => {
    const { sql, unsafe } = makeFakeSql();
    await ensureWebsiteRow(sql, 'docs.example');
    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(String(unsafe.mock.calls[0][0])).toContain('public_web.websites');
  });

  it('saveDiscoveredUrls ensures the parent before any URL insert', async () => {
    const unsafe = vi.fn().mockResolvedValue([{ count: '0' }]);
    const tx = { unsafe } as unknown as Sql;
    const sql = {
      begin: (cb: (tx: Sql) => Promise<number>) => cb(tx),
    } as unknown as Sql;

    await saveDiscoveredUrls(
      sql,
      'docs.example',
      [{ url: 'https://x/1' }],
      'acme',
    );

    const statements = unsafe.mock.calls.map((c) => String(c[0]));
    const parentIdx = statements.findIndex((s) =>
      s.includes('INSERT INTO public_web.websites'),
    );
    const urlIdx = statements.findIndex((s) =>
      s.includes('INSERT INTO public_web.website_urls'),
    );
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(urlIdx).toBeGreaterThanOrEqual(0);
    expect(parentIdx).toBeLessThan(urlIdx);
  });
});
