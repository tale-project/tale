/**
 * Stream a OneDrive/SharePoint file straight into Convex storage.
 *
 * The import pipeline used to `fetch(...).arrayBuffer()` the whole file and
 * wrap it in a `Blob` before `ctx.storage.store` — two full copies in the
 * caller's heap. Inside the workflow isolate (64 MB cap) a large file (e.g. a
 * 57 MB PDF) blows the limit and the action OOMs. Here we instead pipe the
 * download response body directly into a Convex upload URL: the bytes flow
 * through as a stream and never fully materialize in the JS heap, so file size
 * is bounded by the transfer, not by the action's memory.
 *
 * PER-ORG OBJECT STORAGE: imports deliberately still land in Convex
 * `_storage`, even for a bring-your-own-bucket org — routing the streamed
 * store through the blob seam needs the sized-stream vs buffered-PUT split
 * (S3 presigned PUTs require a Content-Length). Tracked in #2737; until then
 * the org blob backfill moves imported files into the bucket on its next run.
 */

import { fetchJson } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

export interface StreamToStorageResult {
  success: boolean;
  storageId?: Id<'_storage'>;
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

    // Pipe the download stream straight into the Convex upload endpoint. The
    // `duplex: 'half'` request is required by the Fetch spec to send a
    // streaming body; forward the source Content-Length so the endpoint gets a
    // sized (non-chunked) upload when the source provides it.
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const upload = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
      },
      body: download.body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    if (!upload.ok) {
      const errorText = await upload.text().catch(() => '');
      return {
        success: false,
        error: `Failed to store file: ${upload.status} ${errorText}`,
      };
    }

    const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(
      upload,
    );

    return {
      success: true,
      storageId,
      mimeType,
      size: contentLength ? Number(contentLength) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
