import type { GenericQueryCtx } from 'convex/server';

import type { UploadPolicyConfig } from '../../lib/shared/schemas/governance';
import type { DataModel } from '../_generated/dataModel';
import { readPolicyConfig } from './helpers';

interface UploadCheckResult {
  allowed: boolean;
  reason?: string;
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
      };
    }
  }

  return { allowed: true };
}
