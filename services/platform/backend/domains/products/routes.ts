import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { PRODUCT_IMAGE_MAX_BYTES } from '../../../lib/shared/product-images.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { PRODUCT_CATEGORY_MAX } from '../../core/products/field_limits.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { readBodyBounded } from '../files/bounded-body.ts';
import { FileError, openFileContent } from '../files/service.ts';
import {
  isProductImageUrl,
  readProductImage,
  uploadProductImage,
  validateProductImageBinding,
} from './images.ts';
import {
  productFieldsShape,
  productNameSchema,
  productImageUrlSchema,
} from './input-schema.ts';
import {
  assertProductAccess,
  bulkCreateProducts,
  countProducts,
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  PRODUCT_STATUSES,
  ProductError,
  type ProductScope,
  updateProduct,
} from './service.ts';

/** The shared field shape (`input-schema.ts`) — the domain's own caps, so
 * a refusal here and in the service agree — with this door's rule that a
 * create names the product. Unknown keys are stripped, as the adapters
 * expect; the REST door composes the same shape strict. */
const productInputSchema = z.object({
  ...productFieldsShape,
  name: productNameSchema,
});

const productAppInputSchema = productInputSchema.extend({
  imageUrl: z
    .union([productImageUrlSchema, z.string().refine(isProductImageUrl)])
    .nullable()
    .optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof RateLimitExceededError)
    return rateLimitedResponse(c, error);
  if (error instanceof ProductError || error instanceof FileError) {
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

  app.post('/images', async (c) => {
    try {
      const scope = scopeOf(c);
      assertProductAccess(scope, 'write');
      await checkUserRateLimit(deps.sql, 'file:upload', scope.userId);
      const bytes = await readBodyBounded(c.req.raw, PRODUCT_IMAGE_MAX_BYTES);
      return c.json(await uploadProductImage(deps.sql, scope, bytes));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/images/:fileId', async (c) => {
    try {
      const scope = scopeOf(c);
      const image = await readProductImage(
        deps.sql,
        scope,
        c.req.param('fileId'),
      );
      const content = await openFileContent(deps.sql, scope, image.storageRef, {
        head: c.req.method === 'HEAD',
        signal: c.req.raw.signal,
      });
      if (!content) return c.json({ error: 'PRODUCT_IMAGE_NOT_FOUND' }, 404);
      // Serve inline under a sandbox even for direct SVG navigation. Never
      // redirect to an object URL that lacks this response policy.
      const headers = new Headers(content.headers);
      headers.set('content-type', image.contentType);
      headers.set(
        'content-security-policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      );
      headers.set('x-content-type-options', 'nosniff');
      headers.set('cache-control', 'private, no-store');
      return new Response(content.body, { status: content.status, headers });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/', async (c) => {
    try {
      // The same query contract the contacts listing enforces: `limit` is an
      // integer in 1..200 and the keyset cursor a positive integer, refused
      // with 400 — `Number()` used to forward `-5` (Postgres: LIMIT must not
      // be negative) and `1.5` (an uncastable bigint) straight to a 500.
      const query = z
        .object({
          search: z.string().max(200).optional(),
          status: z.enum(PRODUCT_STATUSES).optional(),
          category: z.string().max(PRODUCT_CATEGORY_MAX).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursorUpdatedAt: z.coerce.number().int().positive().optional(),
          cursorId: z.string().optional(),
        })
        .safeParse({
          search: c.req.query('search'),
          status: c.req.query('status'),
          category: c.req.query('category'),
          limit: c.req.query('limit'),
          cursorUpdatedAt: c.req.query('cursorUpdatedAt'),
          cursorId: c.req.query('cursorId'),
        });
      if (!query.success) {
        return c.json({ error: 'invalid query' }, 400);
      }
      const { cursorUpdatedAt, cursorId, ...rest } = query.data;
      return c.json(
        await listProducts(deps.sql, scopeOf(c), {
          ...rest,
          cursor:
            cursorUpdatedAt !== undefined && cursorId !== undefined
              ? { updatedAt: cursorUpdatedAt, id: cursorId }
              : null,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/count', async (c) => {
    return c.json({ count: await countProducts(deps.sql, c.get('orgId')) });
  });

  app.post('/', async (c) => {
    const body = productAppInputSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      const productId = await transactSerializable(deps.sql, async (tx) => {
        await validateProductImageBinding(tx, scope, body.data.imageUrl);
        return createProduct(tx, scope, body.data);
      });
      return c.json({ productId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/bulk', async (c) => {
    const body = z
      .object({ products: z.array(productInputSchema).max(1000) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      return c.json(
        await bulkCreateProducts(deps.sql, scopeOf(c), body.data.products),
      );
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
    const body = productAppInputSchema.partial().safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = scopeOf(c);
      await transactSerializable(deps.sql, async (tx) => {
        await validateProductImageBinding(tx, scope, body.data.imageUrl);
        await updateProduct(tx, scope, c.req.param('productId'), body.data);
      });
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
