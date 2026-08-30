import type { Sql, TransactionSql } from 'postgres';

import { authorizeRls } from '../../auth/access.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Products — the per-org catalog. A product's NAME is its identity (no
 * slug), so per-org case-insensitive uniqueness is a real expression index
 * in 0.5 (the 0.4 full-table probe dies); the probe remains only for the
 * friendly `DUPLICATE_PRODUCT_NAME` error. Role gate = the `products` matrix
 * row. REST/connector ingest lanes land with the machine door.
 */

export const PRODUCT_NAME_MAX = 255;
export const PRODUCT_DESCRIPTION_MAX = 4000;
export const PRODUCT_CATEGORY_MAX = 100;
export const PRODUCT_CURRENCY_MAX = 3;
export const PRODUCT_IMAGE_URL_MAX = 2048;

export const PRODUCT_STATUSES = [
  'active',
  'inactive',
  'draft',
  'archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export class ProductError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'ProductError';
    this.code = code;
    this.status = status;
  }
}

export interface ProductScope {
  organizationId: string;
  userId: string;
  email?: string;
  role: string;
}

function assertProductAccess(
  scope: ProductScope,
  action: 'read' | 'write',
): void {
  if (!authorizeRls(scope.role, 'products', action)) {
    throw new ProductError('RBAC_FORBIDDEN', 'Insufficient role', 403);
  }
}

export interface ProductTranslation {
  language: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  lastUpdated: number;
}

export interface ProductRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  stock: number | null;
  price: number | null;
  currency: string | null;
  category: string | null;
  tags: string[];
  status: ProductStatus | null;
  translations: ProductTranslation[] | null;
  externalId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

const PRODUCT_COLUMNS = `
  id, org_id AS "organizationId", name, description, image_url AS "imageUrl",
  stock, price, currency, category, tags, status, translations,
  external_id AS "externalId", metadata,
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

export interface ProductInput {
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  status?: ProductStatus;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

function validateProductFields(input: Partial<ProductInput>): void {
  if (
    (input.name !== undefined &&
      (input.name.trim().length === 0 ||
        input.name.length > PRODUCT_NAME_MAX)) ||
    (input.description?.length ?? 0) > PRODUCT_DESCRIPTION_MAX ||
    (input.category?.length ?? 0) > PRODUCT_CATEGORY_MAX ||
    (input.currency?.length ?? 0) > PRODUCT_CURRENCY_MAX ||
    (input.imageUrl?.length ?? 0) > PRODUCT_IMAGE_URL_MAX
  ) {
    throw new ProductError('PRODUCT_FIELDS_INVALID', 'Invalid product fields');
  }
}

async function assertUniqueName(
  tx: TransactionSql | Sql,
  organizationId: string,
  name: string,
  excludeId?: string,
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.products
    WHERE org_id = ${organizationId} AND lower(name) = ${name.trim().toLowerCase()}
      AND (${excludeId ?? null}::text IS NULL OR id <> ${excludeId ?? null})
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new ProductError(
      'DUPLICATE_PRODUCT_NAME',
      `A product named "${name.trim()}" already exists.`,
    );
  }
}

export async function createProduct(
  tx: TransactionSql,
  scope: ProductScope,
  input: ProductInput,
): Promise<string> {
  assertProductAccess(scope, 'write');
  validateProductFields(input);
  const name = input.name.trim();
  await assertUniqueName(tx, scope.organizationId, name);
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.products (
      org_id, name, description, image_url, stock, price, currency,
      category, tags, status, external_id, metadata, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${name}, ${input.description ?? null},
      ${input.imageUrl ?? null}, ${input.stock ?? null}, ${input.price ?? null},
      ${input.currency ?? null}, ${input.category ?? null}, ${input.tags ?? []},
      ${input.status ?? null}, ${input.externalId ?? null},
      ${input.metadata === undefined ? null : tx.json(toJson(input.metadata))},
      ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new ProductError('PRODUCT_CREATE_FAILED', 'Insert failed');
  }
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'product.created',
    category: 'data',
    resourceType: 'product',
    resourceId: id,
    resourceName: name,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'product',
    entityId: id,
  });
  return id;
}

async function loadProductOrThrow(
  sql: Sql | TransactionSql,
  organizationId: string,
  productId: string,
): Promise<ProductRow> {
  const rows = await sql<ProductRow[]>`
    SELECT ${sql.unsafe(PRODUCT_COLUMNS)} FROM app.products
    WHERE id = ${productId} AND org_id = ${organizationId} LIMIT 1
  `;
  const product = rows[0];
  if (!product) {
    throw new ProductError('PRODUCT_NOT_FOUND', 'Product not found', 404);
  }
  return product;
}

export async function updateProduct(
  tx: TransactionSql,
  scope: ProductScope,
  productId: string,
  patch: Partial<ProductInput>,
): Promise<void> {
  assertProductAccess(scope, 'write');
  validateProductFields(patch);
  const product = await loadProductOrThrow(tx, scope.organizationId, productId);
  const name = patch.name === undefined ? product.name : patch.name.trim();
  if (patch.name !== undefined) {
    await assertUniqueName(tx, scope.organizationId, name, productId);
  }
  await tx`
    UPDATE app.products SET
      name = ${name},
      description = ${patch.description === undefined ? product.description : patch.description},
      image_url = ${patch.imageUrl === undefined ? product.imageUrl : patch.imageUrl},
      stock = ${patch.stock === undefined ? product.stock : patch.stock},
      price = ${patch.price === undefined ? product.price : patch.price},
      currency = ${patch.currency === undefined ? product.currency : patch.currency},
      category = ${patch.category === undefined ? product.category : patch.category},
      tags = ${patch.tags ?? product.tags},
      status = ${patch.status === undefined ? product.status : patch.status},
      metadata = ${patch.metadata === undefined ? (product.metadata === null ? null : tx.json(toJson(product.metadata))) : tx.json(toJson(patch.metadata))},
      updated_at_ms = ${Date.now()}
    WHERE id = ${productId}
  `;
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'product.updated',
    category: 'data',
    resourceType: 'product',
    resourceId: productId,
    resourceName: name,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'product',
    entityId: productId,
  });
}

/** Upsert one language's translation entry on the translations array. */
export async function upsertProductTranslation(
  tx: TransactionSql,
  scope: ProductScope,
  productId: string,
  translation: Omit<ProductTranslation, 'lastUpdated'>,
): Promise<void> {
  assertProductAccess(scope, 'write');
  validateProductFields(translation);
  const product = await loadProductOrThrow(tx, scope.organizationId, productId);
  const translations = (product.translations ?? []).filter(
    (entry) => entry.language !== translation.language,
  );
  translations.push({ ...translation, lastUpdated: Date.now() });
  await tx`
    UPDATE app.products SET
      translations = ${tx.json(toJson(translations))},
      updated_at_ms = ${Date.now()}
    WHERE id = ${productId}
  `;
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'product',
    entityId: productId,
  });
}

export async function deleteProduct(
  tx: TransactionSql,
  scope: ProductScope,
  productId: string,
): Promise<void> {
  assertProductAccess(scope, 'write');
  const product = await loadProductOrThrow(tx, scope.organizationId, productId);
  await tx`DELETE FROM app.products WHERE id = ${productId}`;
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'product.deleted',
    category: 'data',
    resourceType: 'product',
    resourceId: productId,
    resourceName: product.name,
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: scope.organizationId,
    entity: 'product',
    entityId: productId,
  });
}

export async function getProduct(
  sql: Sql,
  scope: ProductScope,
  productId: string,
): Promise<ProductRow> {
  assertProductAccess(scope, 'read');
  return loadProductOrThrow(sql, scope.organizationId, productId);
}

export async function listProducts(
  sql: Sql,
  scope: ProductScope,
  options: {
    search?: string;
    status?: ProductStatus;
    category?: string;
    cursor?: { updatedAt: number; id: string } | null;
    limit?: number;
  } = {},
): Promise<{
  items: ProductRow[];
  nextCursor: { updatedAt: number; id: string } | null;
}> {
  assertProductAccess(scope, 'read');
  const limit = Math.min(options.limit ?? 50, 200);
  const search = options.search?.trim() ? `%${options.search.trim()}%` : null;
  const cursor = options.cursor ?? null;
  const rows = await sql<ProductRow[]>`
    SELECT ${sql.unsafe(PRODUCT_COLUMNS)} FROM app.products
    WHERE org_id = ${scope.organizationId}
      AND (${search}::text IS NULL OR name ILIKE ${search}
        OR coalesce(description, '') ILIKE ${search})
      AND (${options.status ?? null}::text IS NULL OR status = ${options.status ?? null})
      AND (${options.category ?? null}::text IS NULL OR category = ${options.category ?? null})
      AND (${cursor?.updatedAt ?? null}::bigint IS NULL
        OR updated_at_ms < ${cursor?.updatedAt ?? null}
        OR (updated_at_ms = ${cursor?.updatedAt ?? null} AND id < ${cursor?.id ?? null}))
    ORDER BY updated_at_ms DESC, id DESC
    LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      rows.length > limit && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : null,
  };
}

/** How many rows the org has (the table header's total; the 0.4
 * `approxCountProducts` probe, answered exactly rather than by
 * walking a capped page). Products have no trash — a retired one is
 * `archived`, and the table counts it like any other row. */
export async function countProducts(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.products
    WHERE org_id = ${organizationId}
  `;
  return Number(rows[0]?.count ?? '0');
}

// ---------------------------------------------------------------- bulk

export interface BulkCreateProductsResult {
  success: number;
  failed: number;
  errors: {
    index: number;
    error: string;
    errorCode: string;
    product: ProductInput;
  }[];
}

/**
 * Bulk import — the 0.4 `bulkCreateProducts` semantics: each row runs in its
 * OWN transaction so a refused one (duplicate name, invalid field) never
 * aborts the rest, and the importer gets a per-row account of what failed
 * instead of an all-or-nothing error.
 */
export async function bulkCreateProducts(
  sql: Sql,
  scope: ProductScope,
  products: ProductInput[],
): Promise<BulkCreateProductsResult> {
  assertProductAccess(scope, 'write');
  const result: BulkCreateProductsResult = {
    success: 0,
    failed: 0,
    errors: [],
  };
  for (const [index, product] of products.entries()) {
    try {
      await sql.begin((tx) => createProduct(tx, scope, product));
      result.success += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        index,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: error instanceof ProductError ? error.code : 'unknown',
        product,
      });
    }
  }
  return result;
}
