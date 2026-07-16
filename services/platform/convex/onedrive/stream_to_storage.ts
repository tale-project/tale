'use node';

/**
 * Stream a OneDrive/SharePoint file straight into the org's blob store.
 *
 * The import pipeline used to `fetch(...).arrayBuffer()` the whole file and
 * wrap it in a `Blob` before storing — two full copies in the caller's heap.
 * Inside the workflow isolate (64 MB cap) a large file (e.g. a 57 MB PDF)
 * blows the limit and the action OOMs. Here we instead pipe the download
 * response body directly into the store: the bytes flow through as a stream
 * and never fully materialize in the JS heap, so file size is bounded by the
 * transfer, not by the action's memory.
 *
 * PER-ORG OBJECT STORAGE: the file lands in whichever backend the org resolves
 * to — Convex `_storage` (deployment default) or the org's own S3 bucket
 * (bring-your-own). Every path keeps the streaming property except the last:
 *   - Convex: pipe the download body into a `generateUploadUrl` POST.
 *   - S3, source sent Content-Length: pipe the body into the presigned PUT (a
 *     sized, non-chunked upload — a presigned PUT requires a known length).
 *   - S3, no Content-Length (rare; Graph nearly always sends it): buffer the
 *     body and `putBlob`. Only this fallback spends the memory the streaming
 *     paths avoid, and it is bounded by the isolate.
 * An unresolvable org falls back to Convex `_storage` (never fail an import
 * over blob routing) — the idempotent per-org backfill relocates it later.
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
  /** Blob reference: a Convex `_storage` id OR an `s3:<key>` ref. */
  storageId?: BlobRef;
  mimeType?: string;
  /** Byte size from the download `Content-Length`, when the source sends it. */
  size?: number;
  error?: string;
}

export async function streamItemToStorage(
  ctx: ActionCtx,
  args: {
    itemId: string;
    token: string;
    siteId?: string;
    driveId?: string;
    organizationId: string;
  },
): Promise<StreamToStorageResult> {
  const url =
    args.siteId && args.driveId
      ? `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/items/${args.itemId}/content`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${args.itemId}/content`;

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

    // Route to the org's own bucket when configured, else Convex `_storage`.
    // An unresolvable org must not fail the import — fall back to `_storage`
    // (the backfill relocates it later).
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    const store =
      orgSlug === null ? null : await resolveOrgObjectStore(orgSlug);

    // Convex-backed (default, unresolvable org, or explicitly convex): pipe the
    // download stream straight into the upload endpoint — never buffers.
    if (orgSlug === null || store === null || store.backend === 'convex') {
      const storageId = await streamToConvexStorage(
        ctx,
        download.body,
        mimeType,
        contentLength,
      );
      return { success: true, storageId, mimeType, size: declaredSize };
    }

    // S3-backed org with a known length: stream into the presigned PUT.
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
      // `s3Ref` is always present when the store resolved to S3.
      return {
        success: true,
        storageId: handoff.s3Ref,
        mimeType,
        size: declaredSize,
      };
    }

    // S3-backed org, unknown length: buffer (bounded by the isolate) + putBlob.
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

/**
 * Pipe a download stream straight into a Convex `_storage` upload URL. The
 * `duplex: 'half'` request is required by the Fetch spec to send a streaming
 * body; forward the source Content-Length so the endpoint gets a sized
 * (non-chunked) upload when the source provides it.
 */
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
