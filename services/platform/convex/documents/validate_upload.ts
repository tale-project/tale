import { ConvexError } from 'convex/values';

import {
  DOCUMENT_MAX_FILE_SIZE,
  isAllowedDocumentUpload,
  resolveFileType,
} from '../../lib/shared/file-types';
import type { MutationCtx } from '../_generated/server';
import { checkUploadPolicy } from '../governance/upload_enforcement';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';
import { convexStorageId, type BlobRef } from '../lib/storage/blob_ref';
import { extractExtension } from './extract_extension';

export interface ValidatedDocumentUpload {
  contentType: string;
  extension: string | undefined;
  size: number | undefined;
}

/**
 * Validate a blob before it becomes the current file for a document.
 *
 * Upload and replacement both commit the blob before this boundary, so every
 * refusal is structured for the client-side orphan cleanup path.
 */
export async function validateDocumentUpload(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    fileId: BlobRef;
    fileName: string;
    contentType?: string;
    fileSize?: number;
    /** Server-attested size (for an S3 blob read by a Node action). Never
     * expose this argument on a public mutation. */
    verifiedSize?: number;
  },
): Promise<ValidatedDocumentUpload> {
  try {
    await checkOrganizationRateLimit(ctx, 'file:upload', args.organizationId);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new ConvexError({
        code: 'RATE_LIMITED',
        message: error.message,
        retryAfterMs: error.retryAfter,
      });
    }
    throw error;
  }

  const contentType = resolveFileType(args.fileName, args.contentType ?? '');
  const extension = extractExtension(args.fileName);

  // Convex owns the authoritative byte count for `_storage` blobs. An `s3:`
  // ref lives in the org's bucket, where mutations cannot inspect it. Public
  // create callers therefore retain the legacy client-declared fallback;
  // controlled replacement enters through a Node action and supplies
  // `verifiedSize` from a server read.
  const rawConvexId = convexStorageId(args.fileId);
  const convexFileId =
    rawConvexId === null
      ? null
      : ctx.db.system.normalizeId('_storage', rawConvexId);
  if (rawConvexId !== null && convexFileId === null) {
    throw new ConvexError({
      code: 'UPLOAD_BLOB_INVALID',
      message: 'The uploaded file reference is invalid.',
    });
  }
  const storageMeta =
    convexFileId === null ? null : await ctx.db.system.get(convexFileId);
  if (convexFileId !== null && storageMeta === null) {
    throw new ConvexError({
      code: 'UPLOAD_BLOB_INVALID',
      message: 'The uploaded file no longer exists.',
    });
  }
  const size = storageMeta?.size ?? args.verifiedSize ?? args.fileSize;
  if (size != null && (!Number.isFinite(size) || size < 0)) {
    throw new ConvexError({
      code: 'UPLOAD_BLOB_INVALID',
      message: 'The uploaded file size is invalid.',
    });
  }
  if (size != null && size > DOCUMENT_MAX_FILE_SIZE) {
    throw new ConvexError({
      code: 'FILE_TOO_LARGE',
      message: `File exceeds the ${Math.round(
        DOCUMENT_MAX_FILE_SIZE / (1024 * 1024),
      )} MB limit`,
      reasonCode: 'file_too_large',
      limitBytes: DOCUMENT_MAX_FILE_SIZE,
    });
  }

  // Policy and quota checks must consume the authoritative size above. Running
  // them against browser metadata first lets a caller under-report a Convex
  // blob and bypass an organization-specific cap.
  const policyCheck = await checkUploadPolicy(
    ctx,
    args.organizationId,
    args.userId,
    extension,
    contentType,
    size,
  );
  if (!policyCheck.allowed) {
    throw new ConvexError({
      code: 'UPLOAD_POLICY_REJECTED',
      message: policyCheck.reason ?? 'Upload rejected by organization policy',
      reasonCode: policyCheck.reasonCode,
      ...(policyCheck.usedBytes != null && {
        usedBytes: policyCheck.usedBytes,
      }),
      ...(policyCheck.limitBytes != null && {
        limitBytes: policyCheck.limitBytes,
      }),
    });
  }

  if (!isAllowedDocumentUpload(contentType, args.fileName)) {
    throw new ConvexError({
      code: 'UNSUPPORTED_FILE_TYPE',
      message:
        'Unsupported file type. Supported formats: PDF, DOCX, ODT, XLSX, CSV, TXT, MD, JSON, YAML, PY, PPTX, images (JPEG, PNG, GIF, WEBP).',
    });
  }

  return { contentType, extension, size };
}
