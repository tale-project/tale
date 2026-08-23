'use node';

/**
 * Stream a Google Drive file straight into the org's blob store.
 * Same streaming doctrine as OneDrive — bytes never fully materialize in
 * the caller's heap on the Convex `_storage` path.
 */

import { fetchJson } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import {
  generateBlobUpload,
  putBlob,
  type BlobRef,
} from '../lib/storage/blob_access';
import { resolveOrgObjectStore } from '../lib/storage/object_store';

export interface StreamToStorageResult {
  success: boolean;
  storageId?: BlobRef;
  mimeType?: string;
  size?: number;
  error?: string;
}

export async function streamItemToStorage(
  ctx: ActionCtx,
  args: {
    itemId: string;
    token: string;
    organizationId: string;
  },
): Promise<StreamToStorageResult> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.itemId)}?alt=media&supportsAllDrives=true`;

  try {
    const download = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
    });

    if (!download.ok) {
      const errorText = await download.text();
      return {
        success: false,
        error: `Failed to download file: ${download.status} ${errorText}`,
      };
    }
    if (!download.body) {
      return { success: false, error: 'Download response had no body' };
    }

    const mimeType =
      download.headers.get('content-type') || 'application/octet-stream';
    const contentLength = download.headers.get('content-length');
    const declaredSize = contentLength ? Number(contentLength) : undefined;

    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    const store =
      orgSlug === null ? null : await resolveOrgObjectStore(orgSlug);

    if (orgSlug === null || store === null || store.backend === 'convex') {
      const storageId = await streamToConvexStorage(
        ctx,
        download.body,
        mimeType,
        contentLength,
      );
      return { success: true, storageId, mimeType, size: declaredSize };
    }

    if (contentLength !== null) {
      const handoff = await generateBlobUpload(ctx, orgSlug, {
        contentType: mimeType,
      });
      const put = await fetch(handoff.url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType, 'Content-Length': contentLength },
        body: download.body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      if (!put.ok) {
        const errorText = await put.text().catch(() => '');
        return {
          success: false,
          error: `Failed to store file: ${put.status} ${errorText}`,
        };
      }
      return {
        success: true,
        storageId: handoff.s3Ref,
        mimeType,
        size: declaredSize,
      };
    }

    const bytes = new Uint8Array(await download.arrayBuffer());
    const ref = await putBlob(ctx, orgSlug, bytes, mimeType);
    return {
      success: true,
      storageId: ref,
      mimeType,
      size: bytes.byteLength,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function streamToConvexStorage(
  ctx: ActionCtx,
  body: ReadableStream<Uint8Array>,
  mimeType: string,
  contentLength: string | null,
): Promise<Id<'_storage'>> {
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
    },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!upload.ok) {
    const errorText = await upload.text().catch(() => '');
    throw new Error(`Failed to store file: ${upload.status} ${errorText}`);
  }

  const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(upload);
  return storageId;
}
