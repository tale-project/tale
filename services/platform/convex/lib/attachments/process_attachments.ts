/**
 * Unified attachment processing for AI agents.
 *
 * This module provides a complete pipeline for processing file attachments,
 * including document parsing and image metadata extraction.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { parseFile } from '../../agent_tools/files/helpers/parse_file';
import { registerFilesWithAgent } from './register_files';
import type { FileAttachment, MessageContentPart } from './types';

/**
 * Parsed document with extracted text content
 */
export interface ParsedDocument {
  fileName: string;
  content: string;
}

/**
 * Image info for the image tool's analyze operation
 */
export interface ImageInfo {
  fileName: string;
  fileId: Id<'_storage'>;
  url: string | undefined;
}

/**
 * Result of processing attachments
 */
export interface ProcessedAttachments {
  parsedDocuments: ParsedDocument[];
  imageInfoList: ImageInfo[];
  promptContent: Array<{ role: 'user'; content: MessageContentPart[] }> | undefined;
}

/**
 * Configuration for attachment processing
 */
export interface ProcessAttachmentsConfig {
  maxDocumentLength?: number;
  debugLog?: (message: string, data?: Record<string, unknown>) => void;
  toolName?: string;
}

const DEFAULT_MAX_DOCUMENT_LENGTH = 50000;

/**
 * Process file attachments for an AI agent.
 *
 * This function:
 * 1. Separates images from documents
 * 2. Parses documents to extract text content
 * 3. Prepares image metadata for the image tool
 * 4. Builds multi-modal prompt content
 *
 * @param ctx - Action context for storage access
 * @param attachments - Array of file attachments to process
 * @param userText - User's text message to include
 * @param config - Optional configuration
 */
export async function processAttachments(
  ctx: ActionCtx,
  attachments: FileAttachment[],
  userText: string | undefined,
  config?: ProcessAttachmentsConfig,
): Promise<ProcessedAttachments> {
  const maxDocLength = config?.maxDocumentLength ?? DEFAULT_MAX_DOCUMENT_LENGTH;
  const debugLog = config?.debugLog ?? (() => {});
  const toolName = config?.toolName ?? 'agent';

  if (!attachments || attachments.length === 0) {
    return {
      parsedDocuments: [],
      imageInfoList: [],
      promptContent: undefined,
    };
  }

  debugLog('Processing file attachments', {
    count: attachments.length,
    files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
  });

  // Separate images from documents
  const imageAttachments = attachments.filter((a) =>
    a.fileType.startsWith('image/'),
  );
  const documentAttachments = attachments.filter(
    (a) => !a.fileType.startsWith('image/'),
  );

  // Parse document files to extract their text content (in parallel)
  const parseResults = await Promise.all(
    documentAttachments.map(async (attachment) => {
      try {
        const url = await ctx.storage.getUrl(attachment.fileId);
        if (!url) return null;

        const parseResult = await parseFile(url, attachment.fileName, toolName);
        return { attachment, parseResult };
      } catch (error) {
        debugLog('Error parsing document', {
          fileName: attachment.fileName,
          error: String(error),
        });
        return null;
      }
    }),
  );

  const parsedDocuments: ParsedDocument[] = [];

  for (const result of parseResults) {
    if (result?.parseResult.success && result.parseResult.full_text) {
      parsedDocuments.push({
        fileName: result.attachment.fileName,
        content: result.parseResult.full_text,
      });
      debugLog('Parsed document', {
        fileName: result.attachment.fileName,
        textLength: result.parseResult.full_text.length,
      });
    } else if (result) {
      debugLog('Failed to parse document', {
        fileName: result.attachment.fileName,
        error: result.parseResult.error,
      });
    }
  }

  // Get image info for the image tool's analyze operation
  const imageInfoResults = await Promise.all(
    imageAttachments.map(async (attachment) => {
      const url = await ctx.storage.getUrl(attachment.fileId);
      return {
        fileName: attachment.fileName,
        fileId: attachment.fileId,
        url: url || undefined,
      };
    }),
  );
  const imageInfoList = imageInfoResults.filter(
    (r): r is ImageInfo => r.fileId !== undefined,
  );

  // Register files with the agent component for tracking (documents only)
  // Images are handled via the image_analyze tool, not inline
  await registerFilesWithAgent(ctx, documentAttachments);

  // Build prompt content if we have any processed attachments
  let promptContent:
    | Array<{ role: 'user'; content: MessageContentPart[] }>
    | undefined;

  if (
    parsedDocuments.length > 0 ||
    imageInfoList.length > 0
  ) {
    const text = userText || 'Please analyze the attached files.';
    const contentParts: MessageContentPart[] = [{ type: 'text', text }];

    // Add parsed document content
    for (const doc of parsedDocuments) {
      const truncatedContent =
        doc.content.length > maxDocLength
          ? doc.content.substring(0, maxDocLength) +
            '\n\n[... Document truncated due to length ...]'
          : doc.content;

      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Document: ${doc.fileName}**\n\n${truncatedContent}\n---\n`,
      });
    }

    // Add image information for the image tool
    if (imageInfoList.length > 0) {
      const imageInfo = imageInfoList
        .map((img) => {
          const urlPart = img.url ? `, imageUrl="${img.url}"` : '';
          return `- **${img.fileName}**: Use the \`image\` tool with operation="analyze", fileId="${img.fileId}"${urlPart} to analyze this image.`;
        })
        .join('\n');
      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Attached Images** (use \`image\` tool with operation="analyze" to view/analyze):\n${imageInfo}\n---\n`,
      });
    }

    promptContent = [{ role: 'user', content: contentParts }];
  }

  return {
    parsedDocuments,
    imageInfoList,
    promptContent,
  };
}
