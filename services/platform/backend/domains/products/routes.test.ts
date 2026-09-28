/**
 * The products listing's query boundary. `limit` used to go through
 * `Number()` unvalidated: `?limit=-5` reached Postgres as `LIMIT -4` and
 * `?limit=1.5` as an uncastable bigint — both a 500 any org member could
 * trigger from the query string. The route now enforces the same zod contract
 * the contacts listing has always had (int 1..200, positive keyset cursor).
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import { PRODUCT_IMPORT_ROWS_MAX } from '../../core/products/field_limits.ts';

const {
  listProducts,
  bulkCreateProducts,
  deleteProduct,
  updateProduct,
  deleteOrgBlobRefs,
  order,
} = vi.hoisted(() => ({
  listProducts: vi.fn(),
  bulkCreateProducts: vi.fn(),
  deleteProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteOrgBlobRefs: vi.fn(),
  order: [] as string[],
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    listProducts,
    bulkCreateProducts,
    deleteProduct,
    updateProduct,
  };
});

vi.mock('../files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/service.ts')>()),
  deleteOrgBlobRefs,
}));

// The transaction's commit is observable: the blob reclaim must follow it.
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (
    _sql: unknown,
    run: (tx: unknown) => Promise<unknown>,
  ) => {
    const result = await run({});
    order.push('commit');
    return result;
  },
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

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { createProductRoutes } from './routes.ts';

function makeApp() {
  return createProductRoutes({ sql: {} as never, auth: {} as never });
}

describe('GET /products — the listing query boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProducts.mockResolvedValue({ items: [], nextCursor: null });
  });

  it.each(['-5', '0', '1.5', '201', 'abc'])(
    'refuses limit=%s with 400 before the service runs',
    async (limit) => {
      const res = await makeApp().request(`/?orgId=o1&limit=${limit}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid query' });
      expect(listProducts).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-integer keyset cursor with 400', async () => {
    const res = await makeApp().request(
      '/?orgId=o1&cursorUpdatedAt=-1&cursorId=p1',
    );
    expect(res.status).toBe(400);
    expect(listProducts).not.toHaveBeenCalled();
  });

  it('forwards a valid limit, status and cursor as numbers', async () => {
    const res = await makeApp().request(
      '/?orgId=o1&limit=25&status=active&cursorUpdatedAt=1700000000000&cursorId=p1',
    );
    expect(res.status).toBe(200);
    expect(listProducts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', role: 'admin' }),
      expect.objectContaining({
        limit: 25,
        status: 'active',
        cursor: { updatedAt: 1700000000000, id: 'p1' },
      }),
    );
  });

  it('lists with the service default when no limit is sent', async () => {
    const res = await makeApp().request('/?orgId=o1');
    expect(res.status).toBe(200);
    const options = listProducts.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.limit).toBeUndefined();
    expect(options.cursor).toBeNull();
  });
});

describe('POST /products — a refused body names its field', () => {
  // Regression: the door answered a bare `{ error: 'invalid body' }`, so the
  // create dialog could only say "Couldn't create product" for a price the
  // schema refuses.
  it('answers the failed field and the issues beside the code', async () => {
    const res = await makeApp().request('/?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kettle', price: 1e20 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      message: string;
      data: { issues: { path: string }[] };
    };
    expect(body.error).toBe('invalid body');
    expect(body.message).toMatch(/^price: /);
    expect(body.data.issues.map((issue) => issue.path)).toEqual(['price']);
  });

  // Regression: the image was a `z.union` of the external-URL rule and the
  // upload path, and a union that fails both ways says only "Invalid input"
  // — the one image refusal the form leaves to this door (a host that is
  // not public) reached the toast as `imageUrl: Invalid input`.
  it.each([
    ['http://localhost/cat.png', 'must name a public host — '],
    ['http://169.254.169.254/latest', 'must name a public host — '],
    ['example.com/cat.png', 'must be an absolute http(s) URL'],
    ['/images/cat.png', 'must be an absolute http(s) URL'],
  ])('names why the image %s is refused', async (imageUrl, reason) => {
    vi.stubEnv('TALE_ALLOW_PRIVATE_CRAWL_HOSTS', '');
    const res = await makeApp().request('/?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kettle', imageUrl }),
    });
    vi.unstubAllEnvs();
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      message: string;
      data: { issues: { path: string; message: string }[] };
    };
    expect(body.message.startsWith(`imageUrl: ${reason}`)).toBe(true);
    expect(body.data.issues.map((issue) => issue.path)).toEqual(['imageUrl']);
  });

  it('keeps a public image URL, trimmed', async () => {
    updateProduct.mockResolvedValueOnce([]);
    const res = await makeApp().request('/p-1?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: ' https://cdn.example.com/cat.png ' }),
    });
    expect(res.status).toBe(200);
    expect(updateProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p-1',
      expect.objectContaining({ imageUrl: 'https://cdn.example.com/cat.png' }),
    );
  });

  it('imports the valid rows and names the row and column of each refused one', async () => {
    bulkCreateProducts.mockResolvedValue({ success: 1, failed: 0, errors: [] });
    const res = await makeApp().request('/bulk?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: [
          { name: 'Kettle' },
          { name: 'Toaster', price: 'free' },
          { name: '', stock: 1 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(bulkCreateProducts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1' }),
      [{ name: 'Kettle' }],
    );
    const body = (await res.json()) as {
      success: number;
      failed: number;
      errors: { index: number; error: string; issues: { path: string }[] }[];
    };
    expect(body.success).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.errors.map((entry) => entry.index)).toEqual([1, 2]);
    expect(body.errors[0]?.error).toMatch(/^price: /);
    expect(body.errors[0]?.issues[0]?.path).toBe('price');
    expect(body.errors[1]?.error).toMatch(/^name: /);
  });

  it('reports a domain refusal at the row index the caller sent', async () => {
    bulkCreateProducts.mockResolvedValue({
      success: 0,
      failed: 1,
      errors: [
        {
          index: 0,
          error: 'exists',
          errorCode: 'DUPLICATE_PRODUCT_NAME',
          product: { name: 'Kettle' },
        },
      ],
    });
    const res = await makeApp().request('/bulk?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: [{ name: 'Toaster', price: 'free' }, { name: 'Kettle' }],
      }),
    });
    const body = (await res.json()) as { errors: { index: number }[] };
    expect(body.errors.map((entry) => entry.index)).toEqual([0, 1]);
  });

  // The import dialog refuses a longer file before sending it, reading the
  // same constant; this pins the door's half of that agreement.
  it('takes a file of PRODUCT_IMPORT_ROWS_MAX rows and refuses one more by name', async () => {
    bulkCreateProducts.mockClear();
    bulkCreateProducts.mockResolvedValue({ success: 0, failed: 0, errors: [] });
    const send = (count: number) =>
      makeApp().request('/bulk?orgId=o1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: Array.from({ length: count }, (_, i) => ({
            name: `P${i}`,
          })),
        }),
      });
    expect((await send(PRODUCT_IMPORT_ROWS_MAX)).status).toBe(200);
    const refused = await send(PRODUCT_IMPORT_ROWS_MAX + 1);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as {
      data: { issues: { path: string }[] };
    };
    expect(body.data.issues.map((issue) => issue.path)).toEqual(['products']);
    expect(bulkCreateProducts).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE and POST /products/:id — the managed image goes with the row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    deleteOrgBlobRefs.mockImplementation(async () => {
      order.push('reclaim');
    });
  });

  it('reclaims the released blobs only after the delete committed', async () => {
    deleteProduct.mockResolvedValue(['s3:o1/img']);
    const res = await makeApp().request('/p-1?orgId=o1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(expect.anything(), 'o1', [
      's3:o1/img',
    ]);
    expect(order).toEqual(['commit', 'reclaim']);
  });

  it('reclaims what an update released', async () => {
    updateProduct.mockResolvedValue(['s3:o1/old']);
    const res = await makeApp().request('/p-1?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: null }),
    });
    expect(res.status).toBe(200);
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(expect.anything(), 'o1', [
      's3:o1/old',
    ]);
    expect(order).toEqual(['commit', 'reclaim']);
  });

  it('answers a legal hold as 409 LEGAL_HOLD_ACTIVE with nothing reclaimed', async () => {
    const { LegalHoldError } = await import('../legal_holds/service.ts');
    deleteProduct.mockRejectedValue(
      new LegalHoldError('LEGAL_HOLD_ACTIVE', 'held', 409),
    );
    const res = await makeApp().request('/p-1?orgId=o1', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'LEGAL_HOLD_ACTIVE' });
    expect(deleteOrgBlobRefs).not.toHaveBeenCalled();
  });
});
