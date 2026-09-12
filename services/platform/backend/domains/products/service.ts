import type { Sql, TransactionSql } from 'postgres';

import { applyJsonMergePatch } from '../../../lib/shared/utils/json-merge-patch.ts';
import { authorizeRls } from '../../auth/access.ts';
import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
} from '../../core/products/field_limits.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Products — the per-org catalog. A product's NAME is its identity (no
 * slug), so per-org case-insensitive uniqueness is a real expression index
 * in 0.5 (the 0.4 full-table probe dies); the probe remains only for the
 * friendly `DUPLICATE_PRODUCT_NAME` error. Role gate = the `products` matrix
 * row. REST/connector ingest lanes land with the machine door. The field
 * caps are `core/products/field_limits.ts`'s — the one source the doors,
 * the dialogs and the OpenAPI document read too.
 */

export const PRODUCT_STATUSES = [
  'active',
  'inactive',
  'draft',
  'archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export class ProductError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
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

/** A product write. `null` clears an optional field — the one clearing
 * rule both doors speak; `undefined` leaves it alone on an update and
 * unset on a create. */
export interface ProductInput {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  stock?: number | null;
  price?: number | null;
  currency?: string | null;
  category?: string | null;
  tags?: string[] | null;
  status?: ProductStatus | null;
  externalId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** A free-text field as the catalog stores it: trimmed, and null when
 * blank or cleared — a blank is never stored as `""`. */
function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
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
  // The column's CHECK constraint used to be the only guard: a status
  // outside the vocabulary reached Postgres and surfaced as a 500. A
  // `null` status clears the column, so it is not a vocabulary miss.
  if (
    input.status !== undefined &&
    input.status !== null &&
    !(PRODUCT_STATUSES as readonly string[]).includes(input.status)
  ) {
    throw new ProductError(
      'PRODUCT_STATUS_INVALID',
      `"status" must be one of: ${PRODUCT_STATUSES.join(', ')}`,
    );
  }
}

/** The per-org external id is the connector lane's key; a second product
 * carrying one is a 409, the same refusal the bulk contact door gives. */
async function assertUniqueExternalId(
  tx: TransactionSql | Sql,
  organizationId: string,
  externalId: string,
  excludeId?: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtextextended('product-ext:' || ${organizationId} || ':' || ${externalId}, 0)
    )
  `;
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.products
    WHERE org_id = ${organizationId} AND external_id = ${externalId}
      AND (${excludeId ?? null}::text IS NULL OR id <> ${excludeId ?? null})
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new ProductError(
      'DUPLICATE_PRODUCT_EXTERNAL_ID',
      `A product with external ID "${externalId}" already exists.`,
      409,
    );
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
    // A duplicate is a state refusal (the documented 409), like the
    // external-id twin — it used to ride the constructor's default 400.
    throw new ProductError(
      'DUPLICATE_PRODUCT_NAME',
      `A product named "${name.trim()}" already exists.`,
      409,
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
  const externalId = textOrNull(input.externalId);
  if (externalId !== null) {
    await assertUniqueExternalId(tx, scope.organizationId, externalId);
  }
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.products (
      org_id, name, description, image_url, stock, price, currency,
      category, tags, status, external_id, metadata, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${name}, ${textOrNull(input.description)},
      ${textOrNull(input.imageUrl)}, ${input.stock ?? null}, ${input.price ?? null},
      ${textOrNull(input.currency)}, ${textOrNull(input.category)}, ${input.tags ?? []},
      ${input.status ?? null}, ${externalId},
      ${input.metadata == null ? null : tx.json(toJson(input.metadata))},
      ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('PRODUCT_CREATE_FAILED: the insert answered no row');
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

/**
 * Update a product. `expectedUpdatedAt` is the contacts precondition: the
 * row is locked, the revision compared, and a stale one answers 409
 * `PRODUCT_STALE` with nothing changed. Every successful update advances
 * `updatedAt` even within one millisecond, so the next precondition can
 * tell the write apart.
 */
export async function updateProduct(
  tx: TransactionSql,
  scope: ProductScope,
  productId: string,
  patch: Partial<ProductInput> & { expectedUpdatedAt?: number },
): Promise<void> {
  assertProductAccess(scope, 'write');
  validateProductFields(patch);
  const locked = await tx<ProductRow[]>`
    SELECT ${tx.unsafe(PRODUCT_COLUMNS)} FROM app.products
    WHERE id = ${productId} AND org_id = ${scope.organizationId} LIMIT 1 FOR UPDATE
  `;
  const product = locked[0];
  if (!product) {
    throw new ProductError('PRODUCT_NOT_FOUND', 'Product not found', 404);
  }
  if (
    patch.expectedUpdatedAt !== undefined &&
    patch.expectedUpdatedAt !== product.updatedAt
  ) {
    throw new ProductError(
      'PRODUCT_STALE',
      'Product changed; reload before updating',
      409,
    );
  }
  const name = patch.name === undefined ? product.name : patch.name.trim();
  if (patch.name !== undefined) {
    await assertUniqueName(tx, scope.organizationId, name, productId);
  }
  // The patch used to drop `externalId` on the floor — the connector key a
  // caller sent was neither written nor checked. `null` (or a blank)
  // clears it, like every optional field.
  const externalId =
    patch.externalId === undefined
      ? product.externalId
      : textOrNull(patch.externalId);
  if (externalId !== null && externalId !== product.externalId) {
    await assertUniqueExternalId(
      tx,
      scope.organizationId,
      externalId,
      productId,
    );
  }
  // `metadata` is a bag of attributes and merges per RFC 7396 — sent keys
  // are set, omitted keys stay, a key sent as `null` is removed, and the
  // whole field sent as `null` clears it. Adding one key used to wipe
  // every other.
  const metadata =
    patch.metadata === undefined
      ? product.metadata
      : patch.metadata === null
        ? null
        : applyJsonMergePatch(product.metadata, patch.metadata);
  const text = (
    current: string | null,
    next: string | null | undefined,
  ): string | null => (next === undefined ? current : textOrNull(next));
  await tx`
    UPDATE app.products SET
      name = ${name},
      description = ${text(product.description, patch.description)},
      image_url = ${text(product.imageUrl, patch.imageUrl)},
      stock = ${patch.stock === undefined ? product.stock : patch.stock},
      price = ${patch.price === undefined ? product.price : patch.price},
      currency = ${text(product.currency, patch.currency)},
      category = ${text(product.category, patch.category)},
      tags = ${patch.tags === undefined ? product.tags : (patch.tags ?? [])},
      status = ${patch.status === undefined ? product.status : patch.status},
      external_id = ${externalId},
      metadata = ${metadata === null ? null : tx.json(toJson(metadata))},
      updated_at_ms = ${Math.max(Date.now(), product.updatedAt + 1)}
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
