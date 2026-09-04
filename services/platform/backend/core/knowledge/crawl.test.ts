// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  admitUrls,
  admitUrlsStatement,
  registerUrlList,
  reviveListedUrls,
  URL_INSERT_BATCH,
} from './crawl';

/**
 * A page that answered 404 once used to be gone for good: the crawler marked
 * its row `deleted`, and every door that re-admits URLs — discovery, rendered
 * links, the operator's own list — skipped rows that already existed. These
 * tests pin the ONE admission statement all doors now speak and its revival
 * semantics; the real-Postgres proof rides the integration check.
 *
 * The database is a recording double: what matters is which statements run
 * and with which parameters, not that PostgreSQL executes them.
 */

interface FakeDb {
  sql: Sql;
  calls: { text: string; params: unknown[] }[];
}

function fakeDb(rowsPerCall: (text: string) => unknown[] = () => []): FakeDb {
  const calls: { text: string; params: unknown[] }[] = [];
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    calls.push({ text, params });
    return Promise.resolve(rowsPerCall(text));
  };
  const sql = { unsafe } as unknown as Sql;
  return { sql, calls };
}

describe('admitUrlsStatement', () => {
  it('numbers one placeholder per URL after the domain', () => {
    const statement = admitUrlsStatement(3, false);
    expect(statement).toContain("($1, $2, 'discovered', NOW(), FALSE)");
    expect(statement).toContain("($1, $3, 'discovered', NOW(), FALSE)");
    expect(statement).toContain("($1, $4, 'discovered', NOW(), FALSE)");
    expect(statement).not.toContain('$5');
  });

  it('revives a deleted row to discovered with its failures cleared', () => {
    const statement = admitUrlsStatement(1, false);
    expect(statement).toContain('ON CONFLICT (domain, url) DO UPDATE');
    expect(statement).toContain(
      "status = CASE WHEN u.status = 'deleted' THEN 'discovered' ELSE u.status END",
    );
    expect(statement).toContain(
      "fail_count = CASE WHEN u.status = 'deleted' THEN 0 ELSE u.fail_count END",
    );
    expect(statement).toContain("WHERE u.status = 'deleted'");
    expect(statement).toContain('RETURNING u.url');
  });

  it('only ever widens the listed flag, and touches live rows for that alone', () => {
    const statement = admitUrlsStatement(1, true);
    expect(statement).toContain("($1, $2, 'discovered', NOW(), TRUE)");
    expect(statement).toContain('listed = u.listed OR EXCLUDED.listed');
    expect(statement).toContain('OR (EXCLUDED.listed AND NOT u.listed)');
  });
});

describe('admitUrls', () => {
  it('collapses duplicates — a multi-row upsert cannot touch one key twice', async () => {
    const db = fakeDb();
    await admitUrls(
      db.sql,
      'example.test',
      ['https://example.test/a', 'https://example.test/a'],
      { listed: false },
    );
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.params).toEqual([
      'example.test',
      'https://example.test/a',
    ]);
  });

  it('batches at URL_INSERT_BATCH and sums what each batch admitted', async () => {
    const db = fakeDb((text) =>
      // Every batch reports two rows inserted or revived.
      text.includes('INSERT') ? [{ url: 'x' }, { url: 'y' }] : [],
    );
    const urls = Array.from(
      { length: URL_INSERT_BATCH + 1 },
      (_, index) => `https://example.test/p${index}`,
    );
    const admitted = await admitUrls(db.sql, 'example.test', urls, {
      listed: false,
    });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]?.params).toHaveLength(URL_INSERT_BATCH + 1);
    expect(db.calls[1]?.params).toHaveLength(2);
    expect(admitted).toBe(4);
  });

  it('issues nothing for an empty list', async () => {
    const db = fakeDb();
    expect(await admitUrls(db.sql, 'example.test', [], { listed: true })).toBe(
      0,
    );
    expect(db.calls).toHaveLength(0);
  });
});

describe('registerUrlList', () => {
  it('admits the listed URLs through the shared door, marked listed', async () => {
    const db = fakeDb();
    await registerUrlList(
      db.sql,
      'acme',
      'example.test',
      ['https://example.test/a', 'https://example.test/b'],
      3600,
    );
    const admit = db.calls.find((call) => call.text.includes('website_urls'));
    expect(admit).toBeDefined();
    expect(admit?.text).toBe(admitUrlsStatement(2, true));
    expect(admit?.params).toEqual([
      'example.test',
      'https://example.test/a',
      'https://example.test/b',
    ]);
  });
});

describe('reviveListedUrls', () => {
  it('puts only the listed, deleted rows of the domain back on the frontier', async () => {
    const db = fakeDb(() => [{ url: 'a' }, { url: 'b' }]);
    const revived = await reviveListedUrls(db.sql, 'example.test');
    expect(revived).toBe(2);
    const call = db.calls[0];
    expect(call?.text).toContain("SET status = 'discovered', fail_count = 0");
    expect(call?.text).toContain(
      "WHERE domain = $1 AND listed AND status = 'deleted'",
    );
    expect(call?.params).toEqual(['example.test']);
  });
});
