// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { listWebsitesForScanScheduling } from './service.ts';

/**
 * The scheduler's projection must reach every row. The 0.4 `take(500)` was
 * a per-query Convex cap; ported as `LIMIT 500` oldest-first it silently
 * dropped every site past the 500th from periodic scanning. The listing
 * now walks keyset pages over (created_at_ms, id) until a short page.
 */

interface Captured {
  text: string;
  values: unknown[];
}

function row(index: number) {
  return {
    id: `w-${String(index).padStart(4, '0')}`,
    domain: `site-${index}.example`,
    organizationId: index % 2 === 0 ? 'org-a' : 'org-b',
    scanInterval: '1d',
    lastScannedAt: null,
    status: 'active',
    createdAt: 1_700_000_000_000 + index,
    metadata: null,
  };
}

/** Tagged-template Sql double answering one scripted page per query. */
function fakeSql(pages: ReturnType<typeof row>[][]): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const remaining = [...pages];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('$?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(remaining.shift() ?? []);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

describe('listWebsitesForScanScheduling', () => {
  it('walks keyset pages until a short page and projects every row', async () => {
    const first = Array.from({ length: 500 }, (_, i) => row(i));
    const second = [row(500), row(501)];
    const { sql, queries } = fakeSql([first, second]);

    const sites = await listWebsitesForScanScheduling(sql);

    expect(sites).toHaveLength(502);
    expect(sites[0]?.domain).toBe('site-0.example');
    expect(sites[501]?.domain).toBe('site-501.example');
    expect(queries).toHaveLength(2);
    // The first page carries no cursor; the second resumes strictly after
    // the last row of the first (created_at_ms, id).
    expect(queries[0]?.values[0]).toBe(true);
    expect(queries[1]?.values[0]).toBe(false);
    expect(queries[1]?.values[1]).toBe(first[499]?.createdAt);
    expect(queries[1]?.values[2]).toBe(first[499]?.id);
    expect(queries[1]?.text).toContain('(created_at_ms, id) > ($?, $?)');
  });

  it('stops after one short page', async () => {
    const { sql, queries } = fakeSql([[row(1), row(2)]]);

    const sites = await listWebsitesForScanScheduling(sql);

    expect(sites.map((s) => s.domain)).toEqual([
      'site-1.example',
      'site-2.example',
    ]);
    expect(queries).toHaveLength(1);
  });

  it('stops after an exactly-full page followed by an empty one', async () => {
    const full = Array.from({ length: 500 }, (_, i) => row(i));
    const { sql, queries } = fakeSql([full, []]);

    const sites = await listWebsitesForScanScheduling(sql);

    expect(sites).toHaveLength(500);
    expect(queries).toHaveLength(2);
  });
});
