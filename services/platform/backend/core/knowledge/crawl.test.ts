// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { PUBLIC_WEB_SCHEMA } from '../../../lib/knowledge/types';
import {
  admitUrls,
  admitUrlsStatement,
  deregisterDomain,
  registerDomain,
  registerUrlList,
  reviveListedUrls,
  URL_INSERT_BATCH,
} from './crawl';

/**
 * Two rules of the crawl frontier, pinned on recording doubles (what matters
 * is which statements run, with which parameters, inside which transaction —
 * the real-Postgres proofs ride the integration check):
 *
 *  - A page that answered 404 once used to be gone for good: the crawler
 *    marked its row `deleted`, and every door that re-admits URLs — discovery,
 *    rendered links, the operator's own list — skipped rows that already
 *    existed. The ONE admission statement all doors now speak revives them.
 *  - Registration and removal of a domain are serialized on the domain row:
 *    each runs as ONE transaction whose first write takes the `websites` row
 *    lock and holds it until the membership write commits. As two autocommit
 *    statements, a removal's "last member?" check could run between a
 *    concurrent registration's domain upsert and its membership insert — the
 *    fresh domain row was deleted under the registration (cascading its urls
 *    and chunks) and the membership insert then failed on the foreign key.
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

interface Recorded {
  readonly text: string;
  readonly params: readonly unknown[];
  readonly inTx: boolean;
}

/** Like `fakeDb`, but also records whether a statement ran inside `begin`. */
function recorder(): { sql: Sql; sent: Recorded[]; begins: () => number } {
  const sent: Recorded[] = [];
  let begins = 0;
  const unsafeFor =
    (inTx: boolean) =>
    (text: string, params: unknown[] = []): Promise<unknown[]> => {
      sent.push({ text: text.replace(/\s+/g, ' ').trim(), params, inTx });
      return Promise.resolve([]);
    };
  const sql = {
    unsafe: unsafeFor(false),
    begin: (
      callback: (tx: { unsafe: ReturnType<typeof unsafeFor> }) => unknown,
    ): unknown => {
      begins += 1;
      return callback({ unsafe: unsafeFor(true) });
    },
  } as unknown as Sql;
  return { sql, sent, begins: () => begins };
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

describe('deregisterDomain', () => {
  it('locks the domain row, then removes the membership and the orphaned domain, in one transaction', async () => {
    const { sql, sent, begins } = recorder();

    await deregisterDomain(sql, 'acme', 'example.com');

    expect(begins()).toBe(1);
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.inTx)).toBe(true);
    expect(sent[0]?.text).toBe(
      `SELECT 1 FROM ${PUBLIC_WEB_SCHEMA}.websites WHERE domain = $1 FOR UPDATE`,
    );
    expect(sent[0]?.params).toEqual(['example.com']);
    expect(sent[1]?.text).toContain(
      `DELETE FROM ${PUBLIC_WEB_SCHEMA}.website_org_memberships`,
    );
    expect(sent[1]?.params).toEqual(['example.com', 'acme']);
    expect(sent[2]?.text).toContain(
      `DELETE FROM ${PUBLIC_WEB_SCHEMA}.websites`,
    );
    expect(sent[2]?.text).toContain('NOT EXISTS');
  });
});

describe('registerDomain', () => {
  it('upserts the domain and inserts the membership under one transaction', async () => {
    const { sql, sent, begins } = recorder();

    await registerDomain(sql, 'acme', 'example.com', 3600);

    expect(begins()).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.inTx)).toBe(true);
    expect(sent[0]?.text).toContain(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.websites`,
    );
    expect(sent[0]?.text).toContain('ON CONFLICT (domain)');
    expect(sent[1]?.text).toContain(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_org_memberships`,
    );
  });
});

describe('registerUrlList', () => {
  it('keeps the domain upsert, the membership and the URL admission in one transaction', async () => {
    const { sql, sent, begins } = recorder();

    await registerUrlList(
      sql,
      'acme',
      'example.com',
      ['https://example.com/a', 'https://example.com/b'],
      3600,
    );

    expect(begins()).toBe(1);
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.inTx)).toBe(true);
    expect(sent[0]?.text).toContain(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.websites`,
    );
    expect(sent[1]?.text).toContain(
      `INSERT INTO ${PUBLIC_WEB_SCHEMA}.website_org_memberships`,
    );
    // The URL rows go through the shared admission door, marked listed.
    expect(sent[2]?.text).toBe(
      admitUrlsStatement(2, true).replace(/\s+/g, ' ').trim(),
    );
    expect(sent[2]?.params).toEqual([
      'example.com',
      'https://example.com/a',
      'https://example.com/b',
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
