import type { GenericQueryCtx } from 'convex/server';

import type { UploadPolicyConfig } from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { readPolicyConfig } from './helpers';

/**
 * Machine-readable rejection reason. The client maps this to a specific,
 * actionable localized message — in particular `volume_exceeded` must tell the
 * user their quota is full and that deleting files (including failed uploads,
 * which still count) frees it, instead of the generic "upload failed" that
 * made a full quota look like a broken uploader.
 */
export type UploadRejectionCode =
  | 'extension_blocked'
  | 'extension_not_allowed'
  | 'mime_not_allowed'
  | 'file_too_large'
  | 'volume_exceeded';

interface UploadCheckResult {
  allowed: boolean;
  reason?: string;
  reasonCode?: UploadRejectionCode;
  /** For `file_too_large` / `volume_exceeded`: the configured limit in bytes. */
  limitBytes?: number;
  /** For `volume_exceeded`: bytes already counted against the user's quota. */
  usedBytes?: number;
}

/**
 * Check whether a file upload is allowed under governance upload policies.
 */
export async function checkUploadPolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  userId: string,
  fileExtension: string | undefined,
  mimeType: string | undefined,
  fileSize: number | undefined,
): Promise<UploadCheckResult> {
  const config = await readPolicyConfig<UploadPolicyConfig>(
    ctx,
    organizationId,
    'upload_policy',
  );

  if (!config || !config.enabled) {
    return { allowed: true };
  }

  const ext = fileExtension?.toLowerCase().replace(/^\./, '');

  if (ext && config.blockedExtensions?.length) {
    const blocked = config.blockedExtensions.map((e) =>
      e.toLowerCase().replace(/^\./, ''),
    );
    if (blocked.includes(ext)) {
      return {
        allowed: false,
        reason: `File type .${ext} is not allowed by organization policy`,
        reasonCode: 'extension_blocked',
      };
    }
  }

  if (ext && config.allowedExtensions?.length) {
    const allowed = config.allowedExtensions.map((e) =>
      e.toLowerCase().replace(/^\./, ''),
    );
    if (!allowed.includes(ext)) {
      return {
        allowed: false,
        reason: `File type .${ext} is not in the allowed list`,
        reasonCode: 'extension_not_allowed',
      };
    }
  }

  if (mimeType && config.allowedMimeTypes?.length) {
    const match = config.allowedMimeTypes.some((pattern) => {
      if (pattern.endsWith('/*')) {
        return mimeType.startsWith(pattern.replace('/*', '/'));
      }
      return mimeType === pattern;
    });
    if (!match) {
      return {
        allowed: false,
        reason: `MIME type ${mimeType} is not allowed by organization policy`,
        reasonCode: 'mime_not_allowed',
      };
    }
  }

  if (fileSize != null) {
    // Per-MIME override wins over the global `maxFileSizeBytes` when set.
    // Longest-prefix match — e.g. `audio/mpeg` matches `audio/` override
    // before falling back to the generic limit.
    let limit: number | undefined = config.maxFileSizeBytes ?? undefined;
    if (mimeType && config.maxFileSizeLimits?.length) {
      const match = [...config.maxFileSizeLimits]
        .filter((l) => mimeType.startsWith(l.mimeTypePrefix))
        .sort((a, b) => b.mimeTypePrefix.length - a.mimeTypePrefix.length)[0];
      if (match) limit = match.maxBytes;
    }
    if (limit != null && fileSize > limit) {
      const maxMB = Math.round(limit / (1024 * 1024));
      return {
        allowed: false,
        reason: `File size exceeds the ${maxMB} MB limit`,
        reasonCode: 'file_too_large',
        limitBytes: limit,
      };
    }
  }

  if (config.maxTotalVolumeBytesPerUser != null) {
    let totalVolume = 0;
    for await (const meta of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', organizationId).eq('uploadedBy', userId),
      )) {
      if (meta.size != null) {
        totalVolume += meta.size;
      }
    }

    if (totalVolume + (fileSize ?? 0) > config.maxTotalVolumeBytesPerUser) {
      const maxGB = Math.round(
        config.maxTotalVolumeBytesPerUser / (1024 * 1024 * 1024),
      );
      return {
        allowed: false,
        reason: `Total upload volume would exceed the ${maxGB} GB limit`,
        reasonCode: 'volume_exceeded',
        usedBytes: totalVolume,
        limitBytes: config.maxTotalVolumeBytesPerUser,
      };
    }
  }

  return { allowed: true };
}
