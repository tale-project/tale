'use node';

/**
 * Register files with the agent component for proper tracking.
 */

import { getFile } from '@convex-dev/agent';

import { components } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createDebugLog } from '../debug_log';
import { orgSlugFromIdOrNull } from '../helpers/org_slug';
import { getBlobUrl, readBlobBytes } from '../storage/blob_access';
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
  // Lazy, once-per-call slug resolution shared by every `s3:` attachment.
  let orgSlugPromise: Promise<string | null> | undefined;
  const resolveSlug = () => {
    orgSlugPromise ??= orgSlugFromIdOrNull(ctx, organizationId);
    return orgSlugPromise;
  };
  const results = await Promise.all(
    attachments.map(async (attachment): Promise<RegisteredFile | null> => {
      try {
        const convexId = convexStorageId(attachment.fileId);
        const isImage = attachment.fileType.startsWith('image/');

        if (convexId === null) {
          const orgSlug = await resolveSlug();
          if (orgSlug === null) {
            debugLog(
              `Org unresolvable; cannot presign S3 file: ${attachment.fileId}`,
            );
            return null;
          }
          // S3-backed: presign a short-lived GET and build the parts directly.
          const fileUrl = await getBlobUrl(ctx, orgSlug, attachment.fileId, {
            filename: attachment.fileName,
          });
          if (!fileUrl) {
            debugLog(`Could not presign URL for file: ${attachment.fileId}`);
            return null;
          }
          // Inline the bytes for images (external vision APIs can't always
          // follow short-lived presigned URLs before they expire mid-retry).
          const imagePart = isImage
            ? ({
                type: 'image' as const,
                image: await readBlobBytes(ctx, orgSlug, attachment.fileId),
                mediaType: attachment.fileType,
              } as const)
            : undefined;
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
            storageId: attachment.fileId as string,
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
