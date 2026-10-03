// @vitest-environment node

/**
 * The Websites table follows a scan through realtime hints. The regression
 * under test: the websites domain emitted none, so with the list's
 * five-minute freshness a site just added sat on "Scanning · 0" until the
 * page was reloaded — a crawl that was landing pages looked dead.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
}));
vi.mock('../../core/knowledge/crawl.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/crawl.ts')>()),
  deregisterDomain: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));
vi.mock('../../../lib/net/crawl-host-policy.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/net/crawl-host-policy.ts')
  >()),
  crawlTargetResolutionRefusal: vi.fn(async () => null),
}));

import {
  createWebsiteRow,
  deregisterAndDeleteWebsite,
  patchWebsite,
  type WebsiteRow,
} from './service.ts';

const row = (overrides: Partial<WebsiteRow> = {}): WebsiteRow => ({
  id: 'w-1',
  organizationId: 'org-1',
  domain: 'example.com',
  kind: 'site',
  title: null,
  description: null,
  scanInterval: '6h',
  lastScannedAt: null,
  status: 'scanning',
  pageCount: 0,
  crawledPageCount: 0,
  failedPageCount: 0,
  metadata: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** A platform-database double: `before` answers the read, `after` the write. */
function fakeSql(
  before: WebsiteRow,
  after: WebsiteRow = before,
): { sql: Sql; hints: unknown[][] } {
  const hints: unknown[][] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.startsWith('INSERT INTO app_realtime.outbox')) {
      hints.push(values);
      return Promise.resolve([]);
    }
    if (text.startsWith('UPDATE app.websites')) return Promise.resolve([after]);
    if (text.startsWith('INSERT INTO app.websites')) {
      return Promise.resolve([{ id: after.id }]);
    }
    if (text.startsWith('DELETE FROM app.websites')) {
      return Promise.resolve([
        { domain: before.domain, organizationId: before.organizationId },
      ]);
    }
    return Promise.resolve([before]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, hints };
}

const WEBSITE_HINT = ['org-1', null, 'website', 'w-1'];

describe('website row hints', () => {
  it('hints when a scan moves what the list shows', async () => {
    const { sql, hints } = fakeSql(
      row(),
      row({ status: 'active', pageCount: 12, crawledPageCount: 12 }),
    );
    await patchWebsite(sql, {
      websiteId: 'w-1',
      status: 'active',
      pageCount: 12,
      crawledPageCount: 12,
    });
    expect(hints).toEqual([WEBSITE_HINT]);
  });

  it('hints when the scan error a reader sees changes', async () => {
    const { sql, hints } = fakeSql(
      row({ status: 'error', metadata: { lastSyncError: 'old' } }),
      row({ status: 'error', metadata: { lastSyncError: 'new' } }),
    );
    await patchWebsite(sql, {
      websiteId: 'w-1',
      metadata: { lastSyncError: 'new' },
    });
    expect(hints).toEqual([WEBSITE_HINT]);
  });

  it('stays quiet for a sync that only stamped its own clock', async () => {
    const { sql, hints } = fakeSql(
      row({ status: 'active', metadata: { lastStatusSyncAt: 1 } }),
      row({ status: 'active', metadata: { lastStatusSyncAt: 2 } }),
    );
    await patchWebsite(sql, {
      websiteId: 'w-1',
      metadata: { lastStatusSyncAt: 2 },
    });
    expect(hints).toEqual([]);
  });

  it('hints when a row is created and when it is deleted', async () => {
    const created = fakeSql(row());
    await createWebsiteRow(created.sql, {
      organizationId: 'org-1',
      domain: 'example.com',
      scanInterval: '6h',
      status: 'scanning',
    });
    expect(created.hints).toEqual([WEBSITE_HINT]);

    const deleted = fakeSql(row());
    await deregisterAndDeleteWebsite(deleted.sql, row());
    expect(deleted.hints).toEqual([WEBSITE_HINT]);
  });
});
