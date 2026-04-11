/**
 * Unified attachment processing for AI agents.
 *
 * This module provides a complete pipeline for processing file attachments,
 * including document parsing and image metadata extraction.
 */

import { isImage, isSpreadsheet } from '../../../lib/shared/file-types';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { analyzeImageCached } from '../../agent_tools/files/helpers/analyze_image';
import { toId } from '../../lib/type_cast_helpers';
import { registerFilesWithAgent } from './register_files';
import type { FileAttachment, MessageContentPart } from './types';

/**
 * Parsed document with extracted text content
 */
export interface ParsedDocument {
  fileId: string;
  fileName: string;
  content: string;
}

/**
 * Image info for the image tool's analyze operation
 */
export interface ImageInfo {
  fileName: string;
  fileId: string;
  url: string | undefined;
}

/**
 * Text file info
 */
export interface TextFileInfo {
  fileName: string;
  fileId: string;
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
  model?: string;
}

/**
 * Process file attachments for an AI agent.
 *
 * This function:
 * 1. Separates images from other files
 * 2. Analyzes images with vision model
 * 3. Parses spreadsheets for structured data
 * 4. Lists documents and text files for the agent to retrieve via rag_search
 * 5. Builds multi-modal prompt content
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
  config: ProcessAttachmentsConfig & { model: string },
): Promise<ProcessedAttachments> {
  const debugLog = config?.debugLog ?? (() => {});

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

  // Separate images, spreadsheets, and other files (documents + text)
  const imageAttachments = attachments.filter((a) => isImage(a.fileType));
  const spreadsheetAttachments = attachments.filter(
    (a) => !isImage(a.fileType) && isSpreadsheet(a.fileName),
  );
  const fileAttachments = attachments.filter(
    (a) => !isImage(a.fileType) && !isSpreadsheet(a.fileName),
  );

  // Parse spreadsheet files using the xlsx library (in parallel)
  const spreadsheetResults = await Promise.all(
    spreadsheetAttachments.map(async (attachment) => {
      try {
        const result = await ctx.runAction(
          internal.node_only.documents.internal_actions.parseExcel,
          { storageId: toId<'_storage'>(attachment.fileId) },
        );
        debugLog('Parsed spreadsheet', {
          fileName: attachment.fileName,
          sheetCount: result.sheetCount,
          totalRows: result.totalRows,
        });
        return { attachment, result };
      } catch (error) {
        debugLog('Error parsing spreadsheet', {
          fileName: attachment.fileName,
          error: String(error),
        });
        return null;
      }
    }),
  );

  const parsedSpreadsheets = spreadsheetResults.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

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

  // Register files with the agent component for tracking
  await registerFilesWithAgent(ctx, [
    ...fileAttachments,
    ...spreadsheetAttachments,
  ]);

  // Build prompt content with attachment info
  const text = userText || 'Please analyze the attached files.';
  const contentParts: MessageContentPart[] = [{ type: 'text', text }];

  const hasAnalyzedContent =
    parsedSpreadsheets.length > 0 || analyzedImages.length > 0;

  if (hasAnalyzedContent) {
    contentParts.push({
      type: 'text',
      text: '\n\n[PRE-ANALYZED CONTENT BELOW - This is the attachment from the CURRENT message. It takes priority over any previous context. Answer directly from this content without delegating to document tools.]',
    });

    for (const { attachment, result } of parsedSpreadsheets) {
      const sheetTexts = result.sheets.map((sheet) => {
        const headerRow = sheet.headers.join(' | ');
        const separator = sheet.headers.map(() => '---').join(' | ');
        const dataRows = sheet.rows
          .slice(0, 500)
          .map((row) => row.map((cell) => String(cell ?? '')).join(' | '));
        const truncationNote =
          sheet.rows.length > 500
            ? `\n\n[... ${sheet.rows.length - 500} more rows truncated ...]`
            : '';
        return `### Sheet: ${sheet.name} (${sheet.rowCount} rows)\n\n| ${headerRow} |\n| ${separator} |\n| ${dataRows.join(' |\n| ')} |${truncationNote}`;
      });

      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Spreadsheet: ${attachment.fileName}** (fileId: ${attachment.fileId}, ${result.sheetCount} sheet${result.sheetCount !== 1 ? 's' : ''}, ${result.totalRows} rows)\n\n${sheetTexts.join('\n\n')}\n---\n`,
      });
    }

    for (const img of analyzedImages) {
      contentParts.push({
        type: 'text',
        text: `\n\n---\n**Image: ${img.fileName}**\n\n${img.analysis}\n---\n`,
      });
    }
  }

  // List documents, text files, and failed attachments for the agent to process
  // via rag_search tool (retrieve operation)
  const failedImages = imageAttachments.filter(
    (a) => !analyzedImages.some((d) => d.fileName === a.fileName),
  );
  const failedSpreadsheets = spreadsheetAttachments.filter(
    (a) =>
      !parsedSpreadsheets.some((d) => d.attachment.fileName === a.fileName),
  );
  const unprocessedAttachments = [
    ...fileAttachments,
    ...failedImages,
    ...failedSpreadsheets,
  ];

  if (unprocessedAttachments.length > 0) {
    contentParts.push({
      type: 'text',
      text: '\n\n[ATTACHED FILES - Use rag_search tool with operation="retrieve" and the fileId to read these files.]',
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
    parsedDocuments: [],
    imageInfoList: [],
    textFileInfoList: [],
    promptContent,
  };
}
