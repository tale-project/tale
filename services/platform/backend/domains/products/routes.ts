import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  PRODUCT_STATUSES,
  ProductError,
  updateProduct,
  upsertProductTranslation,
  type ProductScope,
} from './service.ts';

const productInputSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  imageUrl: z.string().max(2100).optional(),
  stock: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().max(3).optional(),
  category: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  externalId: z.string().max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const translationSchema = z.object({
  language: z.string().min(2).max(20),
  name: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(120).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ProductError) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
}

/** /api/app/products — the org product catalog. */
export function createProductRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const scopeOf = (c: Context<OrgEnv>): ProductScope => ({
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    email: c.get('sessionBundle').user.email,
    role: c.get('orgMember').role,
  });

  app.get('/', async (c) => {
    try {
      const statusParsed = z
        .enum(PRODUCT_STATUSES)
        .safeParse(c.req.query('status'));
      const cursorUpdatedAt = Number(
        c.req.query('cursorUpdatedAt') ?? Number.NaN,
      );
      const cursorId = c.req.query('cursorId');
      const limitRaw = Number(c.req.query('limit') ?? Number.NaN);
      return c.json(
        await listProducts(deps.sql, scopeOf(c), {
          ...(c.req.query('search') !== undefined
            ? { search: c.req.query('search') ?? '' }
            : {}),
          ...(statusParsed.success ? { status: statusParsed.data } : {}),
          ...(c.req.query('category') !== undefined
            ? { category: c.req.query('category') ?? '' }
            : {}),
          cursor:
            Number.isFinite(cursorUpdatedAt) && cursorId !== undefined
              ? { updatedAt: cursorUpdatedAt, id: cursorId }
              : null,
          ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/', async (c) => {
    const body = productInputSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const productId = await transactSerializable(deps.sql, (tx) =>
        createProduct(tx, scope, body.data),
      );
      return c.json({ productId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:productId', async (c) => {
    try {
      return c.json({
        product: await getProduct(
          deps.sql,
          scopeOf(c),
          c.req.param('productId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:productId', async (c) => {
    const body = productInputSchema.partial().safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProduct(tx, scope, c.req.param('productId'), body.data),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:productId/translations', async (c) => {
    const body = translationSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        upsertProductTranslation(
          tx,
          scope,
          c.req.param('productId'),
          body.data,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:productId', async (c) => {
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteProduct(tx, scope, c.req.param('productId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
