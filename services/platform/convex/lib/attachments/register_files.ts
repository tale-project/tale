'use node';

/**
 * Register files with the agent component for proper tracking.
 */

import type { ActionCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { getFile } from '@convex-dev/agent';
import type { FileAttachment, RegisteredFile } from './types';

import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_ATTACHMENTS', '[Attachments]');

/**
 * Computes SHA-256 hash of a blob
 */
async function computeSha256(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
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
 */
export async function registerFilesWithAgent(
  ctx: ActionCtx,
  attachments: FileAttachment[],
): Promise<RegisteredFile[]> {
  const results = await Promise.all(
    attachments.map(async (attachment): Promise<RegisteredFile | null> => {
      try {
        const [blob, fileUrl] = await Promise.all([
          ctx.storage.get(attachment.fileId),
          ctx.storage.getUrl(attachment.fileId),
        ]);

        if (!blob) {
          debugLog(`File not found in storage: ${attachment.fileId}`);
          return null;
        }
        if (!fileUrl) {
          debugLog(`Could not get URL for file: ${attachment.fileId}`);
          return null;
        }

        const hash = await computeSha256(blob);

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
          isImage: attachment.fileType.startsWith('image/'),
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

