// @vitest-environment node

/**
 * The audit log's date filters — the list's `startDate` / `endDate`, the
 * export's `filter.startDate` / `filter.endDate` and the chain walk's
 * `fromTimestamp` — are epoch milliseconds compared against `ts`. The export
 * and the walk took any number, so a fractional one reached the SQL's
 * `::bigint` cast and answered a 500; the list took any positive safe
 * integer, `9e15` included. Each door now holds them to `epochMsSchema` and
 * refuses the rest with its 400 before a row is read.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  listAuditLogs,
  buildAuditExport,
  sealAuditChainNow,
  verifyAuditChain,
  resolveOrgSlug,
  resolveObjectStore,
  s3PutObject,
  s3PresignGetUrl,
} = vi.hoisted(() => ({
  listAuditLogs: vi.fn(),
  buildAuditExport: vi.fn(),
  sealAuditChainNow: vi.fn(),
  verifyAuditChain: vi.fn(),
  resolveOrgSlug: vi.fn(),
  resolveObjectStore: vi.fn(),
  s3PutObject: vi.fn(),
  s3PresignGetUrl: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  listAuditLogs,
  buildAuditExport,
  sealAuditChainNow,
}));
vi.mock('./verify.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./verify.ts')>()),
  verifyAuditChain,
}));
vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug }));
vi.mock('../../lib/object-store.ts', () => ({ resolveObjectStore }));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3PutObject,
  s3PresignGetUrl,
  browserFacing: (store: unknown) => store,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createAuditLogRoutes } from './routes.ts';

const routes = () =>
  createAuditLogRoutes({ sql: {} as never, auth: {} as never });

const list = (query: string) => routes().request(`/?${query}`);

const post = (route: string, body: unknown) =>
  routes().request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  listAuditLogs.mockResolvedValue({ items: [], nextCursor: null });
  buildAuditExport.mockResolvedValue({
    content: '',
    fileName: 'audit-logs.csv',
    contentType: 'text/csv',
  });
  verifyAuditChain.mockResolvedValue({ ok: true });
  resolveOrgSlug.mockResolvedValue('acme');
  resolveObjectStore.mockResolvedValue({});
  s3PutObject.mockResolvedValue(undefined);
  s3PresignGetUrl.mockResolvedValue('https://store.example.test/x');
});

const FIELDS = ['startDate', 'endDate'] as const;

describe('the audit log date filters hold to the epoch bound [AUDIT-R5]', () => {
  describe.each(FIELDS)('%s', (field) => {
    it.each(['9000000000000000', String(EPOCH_MS_MAX + 1), '1.5', '0'])(
      'the list refuses %s with a 400',
      async (value) => {
        const res = await list(`${field}=${value}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid query' });
        expect(listAuditLogs).not.toHaveBeenCalled();
      },
    );

    it('the list filters up to the latest instant a Date can hold', async () => {
      const res = await list(`${field}=${EPOCH_MS_MAX}`);
      expect(res.status).toBe(200);
      expect(listAuditLogs).toHaveBeenCalledWith(
        {},
        'o1',
        expect.objectContaining({ filter: { [field]: EPOCH_MS_MAX } }),
      );
    });

    it.each([9e15, EPOCH_MS_MAX + 1, -1, 1.5])(
      'the export refuses %s with a 400',
      async (value) => {
        const res = await post('/export', {
          format: 'csv',
          filter: { [field]: value },
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid body' });
        expect(buildAuditExport).not.toHaveBeenCalled();
      },
    );

    it('the export filters up to the latest instant a Date can hold', async () => {
      const res = await post('/export', {
        format: 'csv',
        filter: { [field]: EPOCH_MS_MAX },
      });
      expect(res.status).toBe(200);
      expect(buildAuditExport).toHaveBeenCalledWith({}, 'o1', {
        format: 'csv',
        filter: { [field]: EPOCH_MS_MAX },
      });
    });
  });

  it.each([9e15, EPOCH_MS_MAX + 1, -1, 1.5])(
    'the chain walk refuses fromTimestamp %s with a 400',
    async (fromTimestamp) => {
      const res = await post('/integrity/verify', { fromTimestamp });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid body' });
      expect(verifyAuditChain).not.toHaveBeenCalled();
    },
  );

  it('the chain walk resumes from the latest instant a Date can hold', async () => {
    const res = await post('/integrity/verify', {
      fromTimestamp: EPOCH_MS_MAX,
    });
    expect(res.status).toBe(200);
    expect(verifyAuditChain).toHaveBeenCalledWith({}, 'o1', {
      fromTimestamp: EPOCH_MS_MAX,
    });
    // What waits for its seal is chained before the walk reads.
    expect(sealAuditChainNow).toHaveBeenCalledWith({}, 'o1');
    expect(sealAuditChainNow.mock.invocationCallOrder[0]).toBeLessThan(
      verifyAuditChain.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
