import { fileTypeFromBuffer } from 'file-type';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  buildProductImageUrl,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_TYPES,
} from '../../../lib/shared/product-images.ts';
import { svgHasActiveContent } from '../../core/branding/file_utils.ts';
import {
  deleteOrgBlobRefs,
  putOrgBlobBytes,
  registerUploadedBytes,
} from '../files/service.ts';
import {
  assertProductAccess,
  ProductError,
  type ProductScope,
} from './service.ts';

const IMAGE_ID = z.uuid();
const SOURCE = 'product-image';

/** Origin-relative like branding images: cookies follow the host being used. */
export function productImageUrl(
  organizationId: string,
  fileId: string,
): string {
  return buildProductImageUrl(
    organizationId,
    fileId,
    process.env.BASE_PATH ?? '',
  );
}

/** Only the canonical app path is a binding. External URLs remain external. */
export function productImageId(
  value: string,
  organizationId: string,
): string | null {
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const parsed = new URL(value, 'http://product-image.invalid');
  const fileId = parsed.pathname.split('/').at(-1);
  if (!IMAGE_ID.safeParse(fileId).success || fileId === undefined) return null;
  return value === productImageUrl(organizationId, fileId) ? fileId : null;
}

export function isProductImageUrl(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  const parsed = new URL(value, 'http://product-image.invalid');
  const orgId = parsed.searchParams.get('orgId');
  return orgId !== null && productImageId(value, orgId) !== null;
}

function missingImage(): ProductError {
  return new ProductError(
    'PRODUCT_IMAGE_NOT_FOUND',
    'Product image not found',
    404,
  );
}

interface ProductImage {
  id: string;
  storageRef: string;
  uploadedBy: string | null;
  contentType: string;
}

/** A product image never borrows a document, private chat, or mail attachment. */
export async function readProductImage(
  db: Sql | TransactionSql,
  scope: ProductScope,
  fileId: string,
  lock = false,
): Promise<ProductImage> {
  assertProductAccess(scope, 'read');
  if (!IMAGE_ID.safeParse(fileId).success) throw missingImage();
  const rows = await db<ProductImage[]>`
    SELECT id, storage_ref AS "storageRef", uploaded_by AS "uploadedBy",
           content_type AS "contentType"
    FROM app.file_metadata
    WHERE id = ${fileId} AND org_id = ${scope.organizationId}
      AND source = ${SOURCE} AND size > 0 AND size <= ${PRODUCT_IMAGE_MAX_BYTES}
      AND document_id IS NULL AND thread_id IS NULL AND conversation_id IS NULL
    ${db.unsafe(lock ? 'FOR UPDATE' : '')}
  `;
  const image = rows[0];
  if (!image || !PRODUCT_IMAGE_TYPES.includes(image.contentType))
    throw missingImage();
  if (image.uploadedBy === scope.userId) return image;
  const bound = await db<{ id: string }[]>`
    SELECT id FROM app.products
    WHERE org_id = ${scope.organizationId}
      AND image_url = ${productImageUrl(scope.organizationId, image.id)}
    LIMIT 1
  `;
  if (!bound[0]) throw missingImage();
  return image;
}

/** Run inside the product write transaction, before recording the URL. */
export async function validateProductImageBinding(
  tx: TransactionSql,
  scope: ProductScope,
  imageUrl: string | null | undefined,
): Promise<void> {
  if (imageUrl == null || !imageUrl.startsWith('/')) return;
  const fileId = productImageId(imageUrl, scope.organizationId);
  if (fileId === null) throw missingImage();
  await readProductImage(tx, scope, fileId, true);
}

async function imageFormat(
  bytes: Uint8Array,
): Promise<{ mime: string; ext: string }> {
  if (bytes.length === 0 || bytes.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new ProductError(
      'PRODUCT_IMAGE_INVALID',
      'Image must be between 1 byte and 5 MiB',
    );
  }
  const type = await fileTypeFromBuffer(bytes).catch(() => undefined);
  if (
    type &&
    type.mime !== 'image/svg+xml' &&
    PRODUCT_IMAGE_TYPES.includes(type.mime)
  )
    return type;
  const svg = new TextDecoder('utf-8', { fatal: true });
  let text: string;
  try {
    text = svg.decode(bytes);
  } catch {
    throw new ProductError('PRODUCT_IMAGE_INVALID', 'Unsupported image bytes');
  }
  if (/<svg(?:\s|>)/i.test(text) && !svgHasActiveContent(text)) {
    return { mime: 'image/svg+xml', ext: 'svg' };
  }
  throw new ProductError(
    'PRODUCT_IMAGE_INVALID',
    'Unsupported or active image content',
  );
}

/** Register server-validated bytes immediately; no unregistered raw ref escapes. */
export async function uploadProductImage(
  sql: Sql,
  scope: ProductScope,
  bytes: Uint8Array,
): Promise<{ imageUrl: string }> {
  assertProductAccess(scope, 'write');
  const type = await imageFormat(bytes);
  const storageRef = await putOrgBlobBytes(sql, scope.organizationId, {
    bytes,
    contentType: type.mime,
  });
  try {
    const { fileId } = await registerUploadedBytes(sql, {
      organizationId: scope.organizationId,
      storageRef,
      fileName: `product-image.${type.ext}`,
      contentType: type.mime,
      size: bytes.length,
      source: SOURCE,
      uploadedBy: scope.userId,
      skipRagIndexing: true,
    });
    return { imageUrl: productImageUrl(scope.organizationId, fileId) };
  } catch (error) {
    await deleteOrgBlobRefs(sql, scope.organizationId, [storageRef]);
    throw error;
  }
}
