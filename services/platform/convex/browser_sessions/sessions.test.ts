import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
    query: (config: Record<string, unknown>) => config,
  };
});

const {
  claimBrowserSession,
  reportBrowserSessionResult,
  sweepBrowserSessions,
} = await import('./sessions');

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };
const claim = (claimBrowserSession as unknown as Handler).handler;
const report = (reportBrowserSessionResult as unknown as Handler).handler;
const sweep = (sweepBrowserSessions as unknown as Handler).handler;

interface Row {
  _id: string;
  domain: string;
  cookiesEncrypted: string;
  visitorData?: string;
  status: 'healthy' | 'cooling' | 'expired';
  expiresAt: number;
  lastUsedAt?: number;
  failureCount?: number;
}

function makeCtx(rows: Row[]) {
  const store = rows.map((r) => ({ ...r }));
  const ctx = {
    db: {
      query: () => ({
        withIndex: (name: string, fn: (q: unknown) => unknown) => {
          const c: Record<string, unknown> = {};
          const q = {
            eq(field: string, value: unknown) {
              c[field] = value;
              return q;
            },
          };
          fn(q);
          let rowsOut = store.filter((r) =>
            Object.entries(c).every(
              ([k, v]) => (r as Record<string, unknown>)[k] === v,
            ),
          );
          if (name === 'by_domain_and_status_and_lastUsedAt') {
            rowsOut = [...rowsOut].sort(
              (a, b) => (a.lastUsedAt ?? -1) - (b.lastUsedAt ?? -1),
            );
          }
          return {
            async *[Symbol.asyncIterator]() {
              for (const r of rowsOut) yield r;
            },
          };
        },
      }),
      get: async (id: string) => store.find((r) => r._id === id) ?? null,
      patch: async (id: string, updates: Record<string, unknown>) => {
        const t = store.find((r) => r._id === id);
        if (t) Object.assign(t, updates);
      },
      delete: async (id: string) => {
        const i = store.findIndex((r) => r._id === id);
        if (i >= 0) store.splice(i, 1);
      },
    },
  };
  return { ctx, store };
}

const HEALTHY = (over: Partial<Row>): Row => ({
  _id: 'x',
  domain: 'youtube.com',
  cookiesEncrypted: 'enc',
  status: 'healthy',
  expiresAt: Date.now() + 60_000,
  ...over,
});

describe('claimBrowserSession', () => {
  it('returns null when the domain has no session', async () => {
    const { ctx } = makeCtx([HEALTHY({ _id: 'a', domain: 'other.com' })]);
    expect(await claim(ctx, { domain: 'youtube.com' })).toBeNull();
  });

  it('picks the least-recently-used healthy session and stamps it', async () => {
    const { ctx, store } = makeCtx([
      HEALTHY({ _id: 'new', lastUsedAt: 5000 }),
      HEALTHY({ _id: 'old', lastUsedAt: 1000, visitorData: 'vd' }),
    ]);
    const claimed = await claim(ctx, { domain: 'youtube.com' });
    expect(claimed?.sessionId).toBe('old');
    expect(claimed?.cookiesEncrypted).toBe('enc');
    expect(claimed?.visitorData).toBe('vd');
    expect(store.find((r) => r._id === 'old')?.lastUsedAt).toBeGreaterThan(
      1000,
    );
  });

  it('skips expired sessions', async () => {
    const { ctx } = makeCtx([
      HEALTHY({ _id: 'stale', expiresAt: Date.now() - 1000 }),
    ]);
    expect(await claim(ctx, { domain: 'youtube.com' })).toBeNull();
  });
});

describe('reportBrowserSessionResult', () => {
  it('cools a session on the first block and burns it past the threshold', async () => {
    const { ctx, store } = makeCtx([HEALTHY({ _id: 's', failureCount: 0 })]);
    await report(ctx, { sessionId: 's', outcome: 'blocked' });
    expect(store[0].status).toBe('cooling');
    expect(store[0].failureCount).toBe(1);
    await report(ctx, { sessionId: 's', outcome: 'blocked' });
    await report(ctx, { sessionId: 's', outcome: 'blocked' });
    expect(store[0].status).toBe('expired');
    expect(store[0].failureCount).toBe(3);
  });

  it('resets the failure count on success', async () => {
    const { ctx, store } = makeCtx([
      HEALTHY({ _id: 's', failureCount: 2, status: 'cooling' }),
    ]);
    await report(ctx, { sessionId: 's', outcome: 'ok' });
    expect(store[0].failureCount).toBe(0);
  });
});

describe('sweepBrowserSessions', () => {
  it('expires past-TTL, recovers cooled, and prunes long-expired', async () => {
    const now = Date.now();
    const { ctx, store } = makeCtx([
      HEALTHY({ _id: 'live', expiresAt: now + 60_000 }),
      HEALTHY({ _id: 'over', expiresAt: now - 1000 }),
      {
        _id: 'cooled',
        domain: 'youtube.com',
        cookiesEncrypted: 'e',
        status: 'cooling',
        expiresAt: now + 60_000,
        lastUsedAt: now - 60 * 60 * 1000, // quiet > 30 min → recovers
        failureCount: 1,
      },
      {
        _id: 'gone',
        domain: 'youtube.com',
        cookiesEncrypted: 'e',
        status: 'expired',
        expiresAt: now - 8 * 24 * 60 * 60 * 1000, // > 7-day prune window
      },
    ]);
    await sweep(ctx, {});
    expect(store.find((r) => r._id === 'live')?.status).toBe('healthy');
    expect(store.find((r) => r._id === 'over')?.status).toBe('expired');
    const cooled = store.find((r) => r._id === 'cooled');
    expect(cooled?.status).toBe('healthy');
    expect(cooled?.failureCount).toBe(0);
    expect(store.find((r) => r._id === 'gone')).toBeUndefined();
  });
});
