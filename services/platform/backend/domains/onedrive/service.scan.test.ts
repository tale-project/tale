// @vitest-environment node

/**
 * Unit lock for the cloud-sync scan's shape (the OneDrive and Google Drive
 * engines share it): the scan is a keyset walk over EVERY syncable config —
 * pages in id order, not a cap. The 0.4-era `LIMIT 1000 ORDER BY
 * created_at_ms` handed every config past the thousandth to never: newest
 * syncs sat `active` with no job, no error and no log.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { ONEDRIVE_SYNC_ADAPTER, runSyncScanWith } from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

function configRow(id: string): { id: string; organizationId: string } {
  return { id, organizationId: 'org_1' };
}

/** Scripted `sql`: each page query pops the next page. */
function fakeScan(pages: { id: string; organizationId: string }[][]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(pages.shift() ?? []);
  };
  fn.unsafe = (text: string): { text: string } => ({ text });
  return { sql: fn as unknown as Sql, statements };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('runSyncScanWith', () => {
  it('walks every page by keyset and enqueues one job per config', async () => {
    const fake = fakeScan([
      [configRow('c1'), configRow('c2'), configRow('c3')],
      [configRow('c4'), configRow('c5')],
    ]);

    const enqueued = await runSyncScanWith(fake.sql, ONEDRIVE_SYNC_ADAPTER, {
      pageSize: 3,
    });

    expect(enqueued).toBe(5);
    expect(addJobInTx).toHaveBeenCalledTimes(5);
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      expect(addJobInTx).toHaveBeenCalledWith(
        fake.sql,
        ONEDRIVE_SYNC_ADAPTER.configJobName,
        { organizationId: 'org_1', configId: id },
        { singletonKey: `${ONEDRIVE_SYNC_ADAPTER.singletonPrefix}${id}` },
      );
    }

    const pageQueries = fake.statements.filter((s) =>
      s.text.includes('SELECT'),
    );
    expect(pageQueries).toHaveLength(2);
    for (const query of pageQueries) {
      expect(query.text).toContain("status IN ('active', 'error')");
      expect(query.text).toContain('ORDER BY id');
      expect(query.text).not.toContain('created_at_ms');
      expect(query.values).toContain(3);
    }
    // The second page starts after the last id of the first.
    expect(pageQueries[0]?.values).toContain(null);
    expect(pageQueries[1]?.values).toContain('c3');
  });

  it('stops after a short page', async () => {
    const fake = fakeScan([[configRow('c1')]]);

    const enqueued = await runSyncScanWith(fake.sql, ONEDRIVE_SYNC_ADAPTER, {
      pageSize: 3,
    });

    expect(enqueued).toBe(1);
    expect(
      fake.statements.filter((s) => s.text.includes('SELECT')),
    ).toHaveLength(1);
  });
});
