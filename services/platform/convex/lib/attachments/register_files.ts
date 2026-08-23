/**
 * Register files with the agent component for proper tracking.
 *
 * V8-SAFE (no `'use node'`): this module is imported by V8 callers
 * (`process_attachments.ts`, `index.ts`), so it must NOT pull the `'use node'`
 * blob seam (`blob_access.ts` → S3 signer → `node:fs`). The `s3:` branch reads
 * via the backend-aware V8 lane `blob_read_any`, which delegates the actual
 * presign to a node action through `ctx.runAction` — so the node work happens
 * in an action, and this file stays V8.
 */

import { getFile } from '@convex-dev/agent';

import { components } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createDebugLog } from '../debug_log';
import {
  fetchBlobArrayBuffer,
  getBlobFetchUrl,
} from '../storage/blob_read_any';
import { convexStorageId } from '../storage/blob_ref';
import type { FileAttachment, RegisteredFile } from './types';

const debugLog = createDebugLog('DEBUG_ATTACHMENTS', '[Attachments]');

/**
 * Computes SHA-256 hash of raw bytes
 */
async function computeSha256(bytes: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Registers files with the agent component and gets proper AI SDK content parts.
 * This allows:
 * 1. Files to be properly tracked for cleanup (vacuuming)
 * 2. Multi-modal messages to be saved correctly
 * 3. The AI to properly process images via URL
 * 4. Non-image files (PDF, etc.) to be processed via tools
 *
 * Backend split: only Convex `_storage` blobs are registered with the agent
 * component — its registry (and its vacuum) speak `_storage` ids exclusively.
 * An `s3:` blob lives in the org's own bucket with its own delete lanes, so it
 * skips the registry and gets equivalent AI-SDK parts built from a presigned
 * URL instead. `organizationId` (Better Auth id) resolves that bucket — the
 * slug lookup runs lazily, only when an `s3:` ref is actually present.
 */
export async function registerFilesWithAgent(
  ctx: ActionCtx,
  attachments: FileAttachment[],
  organizationId: string,
): Promise<RegisteredFile[]> {
  const results = await Promise.all(
    attachments.map(async (attachment): Promise<RegisteredFile | null> => {
      try {
        const convexId = convexStorageId(attachment.fileId);
        const isImage = attachment.fileType.startsWith('image/');

        if (convexId === null) {
          // S3-backed: presign a short-lived GET via the V8-safe read lane
          // (it resolves the org's bucket from `organizationId` and presigns
          // in a node action). Build the AI-SDK parts directly — an `s3:` blob
          // is not tracked in the agent component's `_storage`-only registry.
          const fileUrl = await getBlobFetchUrl(
            ctx,
            organizationId,
            attachment.fileId,
          );
          if (!fileUrl) {
            debugLog(`Could not presign URL for file: ${attachment.fileId}`);
            return null;
          }
          // Inline the bytes for images (external vision APIs can't always
          // follow short-lived presigned URLs before they expire mid-retry).
          let imagePart:
            | {
                readonly type: 'image';
                readonly image: Uint8Array;
                readonly mediaType: string;
              }
            | undefined;
          if (isImage) {
            const read = await fetchBlobArrayBuffer(
              ctx,
              organizationId,
              attachment.fileId,
            );
            if (read) {
              imagePart = {
                type: 'image',
                image: new Uint8Array(read.bytes),
                mediaType: attachment.fileType,
              } as const;
            }
          }
          return {
            storageId: attachment.fileId,
            imagePart,
            filePart: {
              type: 'file' as const,
              data: fileUrl,
              mediaType: attachment.fileType,
              filename: attachment.fileName,
            },
            fileUrl,
            attachment,
            isImage,
          };
        }

        const [blob, fileUrl] = await Promise.all([
          ctx.storage.get(convexId),
          ctx.storage.getUrl(convexId),
        ]);

        if (!blob) {
          debugLog(`File not found in storage: ${attachment.fileId}`);
          return null;
        }
        if (!fileUrl) {
          debugLog(`Could not get URL for file: ${attachment.fileId}`);
          return null;
        }

        const hash = await computeSha256(await blob.arrayBuffer());

        const { fileId: agentFileId } = await ctx.runMutation(
          components.agent.files.addFile,
          {
            storageId: attachment.fileId,
            hash,
            mimeType: attachment.fileType,
            filename: attachment.fileName,
          },
        );

        const { imagePart, filePart } = await getFile(
          ctx,
          components.agent,
          agentFileId,
        );

        return {
          agentFileId,
          storageId: attachment.fileId,
          imagePart,
          filePart,
          fileUrl,
          attachment,
          isImage,
        };
      } catch (error) {
        console.error(
          `[attachments] Failed to register file ${attachment.fileName}:`,
          error,
        );
        return null;
      }
    }),
  );

  return results.filter((r): r is RegisteredFile => r !== null);
}
