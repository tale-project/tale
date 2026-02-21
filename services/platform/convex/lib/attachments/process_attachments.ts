/**
 * Unified attachment processing for AI agents.
 *
 * This module provides a complete pipeline for processing file attachments,
 * including document parsing and image metadata extraction.
 */

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import type { FileAttachment, MessageContentPart } from './types';

import { isImage, isTextFile } from '../../../lib/shared/file-types';
import { analyzeImageCached } from '../../agent_tools/files/helpers/analyze_image';
import { analyzeTextContent } from '../../agent_tools/files/helpers/analyze_text';
import { parseFile } from '../../agent_tools/files/helpers/parse_file';
import { registerFilesWithAgent } from './register_files';

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
 * Text file info for the txt tool's parse operation
 */
export interface TextFileInfo {
  fileName: string;
  fileId: Id<'_storage'>;
  fileSize: number;
}

/**
 * Result of processing attachments
 */
export interface ProcessedAttachments {
  parsedDocuments: ParsedDocument[];
  imageInfoList: ImageInfo[];
  textFileInfoList: TextFileInfo[];
  promptContent:
    | Array<{ role: 'user'; content: MessageContentPart[] }>
    | undefined;
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
      textFileInfoList: [],
      promptContent: undefined,
    };
  }

  debugLog('Processing file attachments', {
    count: attachments.length,
    files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
  });

  // Separate images, text files, and other documents
  const imageAttachments = attachments.filter((a) => isImage(a.fileType));
  const textFileAttachments = attachments.filter(
    (a) => !isImage(a.fileType) && isTextFile(a.fileType, a.fileName),
  );
  const documentAttachments = attachments.filter(
    (a) => !isImage(a.fileType) && !isTextFile(a.fileType, a.fileName),
  );

  // Parse document files to extract their text content (in parallel)
  const parseResults = await Promise.all(
    documentAttachments.map(async (attachment) => {
      try {
        const parseResult = await parseFile(
          ctx,
          attachment.fileId,
          attachment.fileName,
          toolName,
          userText,
        );
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

  // Analyze images with vision model (in parallel)
  const imageAnalysisResults = await Promise.all(
    imageAttachments.map(async (attachment) => {
      try {
        const result = await analyzeImageCached(ctx, {
          fileId: attachment.fileId,
          fileName: attachment.fileName,
          question: userText,
        });

        if (result.success) {
          return {
            fileName: attachment.fileName,
            analysis: result.analysis,
          };
        } else {
          debugLog('Image analysis failed', {
            fileName: attachment.fileName,
            error: result.error,
          });
          return null;
        }
      } catch (error) {
        debugLog('Error analyzing image', {
          fileName: attachment.fileName,
          error: String(error),
        });
        return null;
      }
    }),
  );

  const analyzedImages = imageAnalysisResults.filter(
    (r): r is { fileName: string; analysis: string } => r !== null,
  );

  // Analyze text files with LLM (in parallel)
  const textAnalysisResults = await Promise.all(
    textFileAttachments.map(async (attachment) => {
      try {
        const result = await analyzeTextContent(ctx, {
          fileId: attachment.fileId,
          filename: attachment.fileName,
          userInput: userText || 'Analyze this file',
        });

        if (result.success) {
          return {
            fileName: attachment.fileName,
            analysis: result.result,
            charCount: result.charCount,
            lineCount: result.lineCount,
          };
        } else {
          debugLog('Text file analysis failed', {
            fileName: attachment.fileName,
            error: result.error,
          });
          return null;
        }
      } catch (error) {
        debugLog('Error analyzing text file', {
          fileName: attachment.fileName,
          error: String(error),
        });
        return null;
      }
    }),
  );

  const analyzedTextFiles = textAnalysisResults.filter(
    (
      r,
    ): r is {
      fileName: string;
      analysis: string;
      charCount: number;
      lineCount: number;
    } => r !== null,
  );

  // Register files with the agent component for tracking (documents only)
  // Images and text files are handled via their respective tools, not inline
  await registerFilesWithAgent(ctx, documentAttachments);

  // Build prompt content with attachment info
  const text = userText || 'Please analyze the attached files.';
  const contentParts: MessageContentPart[] = [{ type: 'text', text }];

  const hasAnalyzedContent =
    parsedDocuments.length > 0 ||
    analyzedImages.length > 0 ||
    analyzedTextFiles.length > 0;

  if (hasAnalyzedContent) {
    contentParts.push({
      type: 'text',
      text: '\n\n[PRE-ANALYZED CONTENT BELOW - This is the attachment from the CURRENT message. It takes priority over any previous context. Answer directly from this content without delegating to document tools.]',
    });

    for (const doc of parsedDocuments) {
      const truncatedContent =
        doc.content.length > maxDocLength
          ? doc.content.slice(0, maxDocLength) +
            '\n\n[... Document truncated due to length ...]'
          : doc.content;

      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Document: ${doc.fileName}**\n\n${truncatedContent}\n---\n`,
      });
    }

    for (const img of analyzedImages) {
      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Image: ${img.fileName}**\n\n${img.analysis}\n---\n`,
      });
    }

    for (const txt of analyzedTextFiles) {
      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Text File: ${txt.fileName}** (${txt.charCount} chars, ${txt.lineCount} lines)\n\n${txt.analysis}\n---\n`,
      });
    }
  }

  // Collect attachments that failed pre-analysis — include their references
  // so the agent can use its tools (docx, pdf, image, etc.) to process them
  const failedDocuments = documentAttachments.filter(
    (a) => !parsedDocuments.some((d) => d.fileName === a.fileName),
  );
  const failedImages = imageAttachments.filter(
    (a) => !analyzedImages.some((d) => d.fileName === a.fileName),
  );
  const failedTextFiles = textFileAttachments.filter(
    (a) => !analyzedTextFiles.some((d) => d.fileName === a.fileName),
  );
  const unprocessedAttachments = [
    ...failedDocuments,
    ...failedImages,
    ...failedTextFiles,
  ];

  if (unprocessedAttachments.length > 0) {
    contentParts.push({
      type: 'text',
      text: '\n\n[ATTACHED FILES - Pre-analysis was not available. Use your tools to process these files.]',
    });

    for (const attachment of unprocessedAttachments) {
      contentParts.push({
        type: 'text',
        text: `\n📎 **${attachment.fileName}** (${attachment.fileType}, fileId: ${attachment.fileId})`,
      });
    }
  }

  const promptContent:
    | Array<{ role: 'user'; content: MessageContentPart[] }>
    | undefined =
    attachments.length > 0
      ? [{ role: 'user', content: contentParts }]
      : undefined;

  return {
    parsedDocuments,
    imageInfoList: [],
    textFileInfoList: [],
    promptContent,
  };
}
