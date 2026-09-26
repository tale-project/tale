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

const { listProducts, bulkCreateProducts } = vi.hoisted(() => ({
  listProducts: vi.fn(),
  bulkCreateProducts: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return { ...actual, listProducts, bulkCreateProducts };
});

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
});
