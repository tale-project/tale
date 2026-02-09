/**
 * Format attachments as markdown for message storage.
 */

import type { Id } from '../../_generated/dataModel';
import type { FileAttachment } from './types';

/**
 * Formats attachments as markdown for storing in message content.
 * Used when saving user messages to the thread.
 *
 * @param ctx - The action or mutation context with storage access
 * @param attachments - Array of file attachments
 * @returns Markdown-formatted string with attachment references
 */
export async function formatAttachmentsAsMarkdown(
  ctx: {
    storage: { getUrl: (fileId: Id<'_storage'>) => Promise<string | null> };
  },
  attachments: FileAttachment[],
): Promise<string> {
  const imageMarkdowns: string[] = [];
  const fileMarkdowns: string[] = [];

  for (const attachment of attachments) {
    const url = await ctx.storage.getUrl(attachment.fileId);
    if (!url) continue;

    if (attachment.fileType.startsWith('image/')) {
      // Images: Use markdown image syntax for inline display
      imageMarkdowns.push(`![${attachment.fileName}](${url})`);
    } else {
      // Other files: Use markdown link with file info
      const sizeKB = Math.round(attachment.fileSize / 1024);
      const sizeDisplay =
        sizeKB === 0
          ? `${attachment.fileSize} bytes`
          : sizeKB >= 1024
            ? `${(sizeKB / 1024).toFixed(1)} MB`
            : `${sizeKB} KB`;
      fileMarkdowns.push(
        `📎 [${attachment.fileName}](${url}) (${attachment.fileType}, ${sizeDisplay})`,
      );
    }
  }

  // Build the attachment section
  const attachmentParts: string[] = [];
  if (imageMarkdowns.length > 0) {
    attachmentParts.push(imageMarkdowns.join('\n'));
  }
  if (fileMarkdowns.length > 0) {
    attachmentParts.push(fileMarkdowns.join('\n'));
  }

  return attachmentParts.join('\n\n');
}
