/**
 * Products REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/products          — List products (paginated)
 *   POST   /api/v1/products          — Create product
 *   GET    /api/v1/products/:id      — Get product by ID
 *   PATCH  /api/v1/products/:id      — Update product
 *   DELETE /api/v1/products/:id      — Delete product
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parseIntParam,
  withRestAuth,
} from '../lib/rest/helpers';
import { toId } from '../lib/type_cast_helpers';

const PREFIX = '/api/v1/products/';

export const listProducts = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') ?? null;
    const limit = parseIntParam(url, 'limit', 25);
    const status = url.searchParams.get('status') ?? undefined;
    const category = url.searchParams.get('category') ?? undefined;

    const result = await rc.ctx.runQuery(
      internal.products.internal_queries.queryProducts,
      {
        organizationId: rc.org.organizationId,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- user input validated at runtime
        status: status as 'active' | 'draft' | 'archived' | undefined,
        category,
        paginationOpts: { numItems: limit, cursor },
      },
    );

    return jsonOk(result);
  },
);

export const createProduct = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const body = await request.json();

    const result = await rc.ctx.runMutation(
      internal.products.internal_mutations.ingestProduct,
      {
        organizationId: rc.org.organizationId,
        name: body.name,
        description: body.description,
        imageUrl: body.imageUrl,
        stock: body.stock,
        price: body.price,
        currency: body.currency,
        category: body.category,
        tags: body.tags,
        status: body.status,
        externalId: body.externalId,
        metadata: body.metadata,
      },
    );

    return jsonCreated(result);
  },
);

export const getProduct = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id } = extractPathParts(url, PREFIX);

  if (!id) {
    return jsonError('Missing product ID', 400);
  }

  const product = await rc.ctx.runQuery(
    internal.products.internal_queries.getProductById,
    { productId: toId<'products'>(id) },
  );

  if (!product) {
    return jsonError('Product not found', 404);
  }

  return jsonOk(product);
});

export const patchProduct = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing product ID', 400);
    }

    const body = await request.json();

    await rc.ctx.runMutation(
      internal.products.internal_mutations.updateProducts,
      {
        productId: toId<'products'>(id),
        updates: {
          name: body.name,
          description: body.description,
          imageUrl: body.imageUrl,
          stock: body.stock,
          price: body.price,
          currency: body.currency,
          category: body.category,
          tags: body.tags,
          status: body.status,
          externalId: body.externalId,
          metadata: body.metadata,
        },
      },
    );

    return jsonNoContent();
  },
);

export const deleteProduct = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id } = extractPathParts(url, PREFIX);

    if (!id) {
      return jsonError('Missing product ID', 400);
    }

    await rc.ctx.runMutation(
      internal.products.internal_mutations.deleteProduct,
      { productId: toId<'products'>(id) },
    );

    return jsonNoContent();
  },
);
