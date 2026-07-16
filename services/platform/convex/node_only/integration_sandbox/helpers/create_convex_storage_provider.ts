'use node';

/**
 * Blob storage provider for the integration sandbox — the single store path
 * every REST-API connector's `ctx.files` API funnels through (Google Drive,
 * Confluence, Dropbox, and any custom connector's `download_file` / upload).
 *
 * Implements StorageProvider through the backend-aware blob seam:
 * - download: fetch URL → bytes → org blob store (Convex `_storage` or the
 *   org's own S3 bucket) — no base64 conversion.
 * - store: base64/utf-8 string → bytes → org blob store.
 *
 * PER-ORG OBJECT STORAGE: routing through `putBlob` lands connector files in a
 * bring-your-own-bucket org's own S3 instead of Convex `_storage`. An
 * unresolvable org falls back to `_storage` (never fail an import over blob
 * routing) — the idempotent per-org backfill relocates it later. The connector
 * runtime already buffers the whole file (`response.blob()` / a base64 arg), so
 * `putBlob` adds no memory ceiling beyond what the sandbox already paid.
 */

import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';
import { orgSlugFromIdOrNull } from '../../../lib/helpers/org_slug';
import { toPublicUrl } from '../../../lib/helpers/public_storage_url';
import { getBlobUrl, putBlob } from '../../../lib/storage/blob_access';
import {
  convexStorageId,
  isS3Ref,
  type BlobRef,
} from '../../../lib/storage/blob_ref';
import type { StorageProvider } from '../types';
import { resolveAndValidateUrl } from './url_rewrite';

export function createConvexStorageProvider(
  ctx: ActionCtx,
  organizationId: string,
): StorageProvider {
  /** Store bytes for the org, returning the backend-aware blob reference. */
  const store = async (
    orgSlug: string | null,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<BlobRef> => {
    if (orgSlug === null) {
      return await ctx.storage.store(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a Uint8Array is a valid BlobPart at runtime
        new Blob([bytes as BlobPart], { type: contentType }),
      );
    }
    return await putBlob(ctx, orgSlug, bytes, contentType);
  };

  return {
    async download({ url, headers, fileName, allowedHosts }) {
      const resolvedUrl = resolveAndValidateUrl(url, allowedHosts);

      const response = await globalThis.fetch(resolvedUrl, {
        headers,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location') ?? 'unknown';
        throw new Error(
          `File download redirected to "${location}" for "${url}". Add the redirect host to allowedHosts.`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `File download failed: ${response.status} ${response.statusText} for "${url}"`,
        );
      }

      const blob = await response.blob();
      const contentType =
        blob.type ||
        response.headers.get('content-type') ||
        'application/octet-stream';
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
      const ref = await store(orgSlug, bytes, contentType);
      const storageUrl = await blobPublicUrl(ctx, orgSlug, ref);

      await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId,
          storageId: ref,
          fileName,
          contentType,
          size: bytes.byteLength,
          // Write-time default for raw integration blobs. When the workflow
          // promotes one to a document, linkDocumentToFile rewrites this to the
          // connector's provenance (e.g. 'confluence') from the document's
          // sourceProvider; transient blobs that never become a document stay
          // 'agent' and remain eligible for the agent-temp retention sweep.
          source: 'agent',
        },
      );

      return {
        fileId: String(ref),
        url: storageUrl,
        fileName,
        contentType,
        size: bytes.byteLength,
      };
    },

    async store({ data, encoding, contentType, fileName }) {
      const bytes =
        encoding === 'base64'
          ? base64ToBytes(data)
          : new TextEncoder().encode(data);

      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
      const ref = await store(orgSlug, bytes, contentType);
      const storageUrl = await blobPublicUrl(ctx, orgSlug, ref);

      await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId,
          storageId: ref,
          fileName,
          contentType,
          size: bytes.byteLength,
          // Write-time default for raw integration blobs. When the workflow
          // promotes one to a document, linkDocumentToFile rewrites this to the
          // connector's provenance (e.g. 'confluence') from the document's
          // sourceProvider; transient blobs that never become a document stay
          // 'agent' and remain eligible for the agent-temp retention sweep.
          source: 'agent',
        },
      );

      return {
        fileId: String(ref),
        url: storageUrl,
        fileName,
        contentType,
        size: bytes.byteLength,
      };
    },
  };
}

/**
 * A public download URL for a just-stored blob. S3 blobs get a presigned GET
 * (already the org's public endpoint); Convex `_storage` blobs get their
 * internal URL rewritten through the public proxy.
 */
async function blobPublicUrl(
  ctx: ActionCtx,
  orgSlug: string | null,
  ref: BlobRef,
): Promise<string> {
  if (orgSlug !== null && isS3Ref(ref)) {
    return (await getBlobUrl(ctx, orgSlug, ref)) ?? '';
  }
  const storageId = convexStorageId(ref);
  const raw = storageId ? ((await ctx.storage.getUrl(storageId)) ?? '') : '';
  return toPublicUrl(raw);
}
