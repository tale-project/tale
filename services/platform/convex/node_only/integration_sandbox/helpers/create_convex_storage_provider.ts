'use node';

/**
 * Convex storage provider for the integration sandbox.
 *
 * Implements StorageProvider using ActionCtx.storage:
 * - download: fetch URL → blob → ctx.storage.store(blob) — no base64 conversion
 * - store: base64/utf-8 string → Blob → ctx.storage.store(blob)
 */

import type { ActionCtx } from '../../../_generated/server';
import type { StorageProvider } from '../types';

import { base64ToBytes } from '../../../lib/crypto/base64_to_bytes';
import { validateHost } from './validate_host';

export function createConvexStorageProvider(ctx: ActionCtx): StorageProvider {
  return {
    async download({ url, headers, fileName, allowedHosts }) {
      if (allowedHosts && allowedHosts.length > 0) {
        validateHost(url, allowedHosts);
      }

      const response = await globalThis.fetch(url, {
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
      const storageId = await ctx.storage.store(blob);
      const storageUrl = (await ctx.storage.getUrl(storageId)) ?? '';
      const contentType =
        blob.type ||
        response.headers.get('content-type') ||
        'application/octet-stream';

      return {
        fileId: String(storageId),
        url: storageUrl,
        fileName,
        contentType,
        size: blob.size,
      };
    },

    async store({ data, encoding, contentType, fileName }) {
      let blob: Blob;
      if (encoding === 'base64') {
        const bytes = base64ToBytes(data);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SharedArrayBuffer TS compat
        blob = new Blob([bytes as unknown as ArrayBuffer], {
          type: contentType,
        });
      } else {
        blob = new Blob([data], { type: contentType });
      }

      const storageId = await ctx.storage.store(blob);
      const storageUrl = (await ctx.storage.getUrl(storageId)) ?? '';

      return {
        fileId: String(storageId),
        url: storageUrl,
        fileName,
        contentType,
        size: blob.size,
      };
    },
  };
}
