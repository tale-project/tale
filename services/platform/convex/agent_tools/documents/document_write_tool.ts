/**
 * Convex Tool: Document Write
 *
 * Save one or more previously generated files to the documents hub.
 * Requires user approval — an approval card will be shown in chat.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { validateFolderName } from '../../folders/mutations';
import { toId } from '../../lib/type_cast_helpers';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

const MAX_BATCH_SIZE = 50;

const documentWriteFileEntry = z.object({
  fileId: z
    .string()
    .min(1)
    .describe(
      'Convex storage ID of an already-stored file (e.g. from text generate, docx generate, pdf generate). This is the fileStorageId returned by file generation tools.',
    ),
  title: z
    .string()
    .optional()
    .describe(
      'Override document title. If omitted, uses the original file name from file metadata.',
    ),
});

export const documentWriteArgs = z.object({
  files: z
    .array(documentWriteFileEntry)
    .min(1)
    .max(MAX_BATCH_SIZE)
    .describe(
      'Array of files to save to the documents hub. Each entry needs a fileId from a file generation tool.',
    ),
  folderPath: z
    .string()
    .optional()
    .describe(
      'Slash-separated folder path in the documents hub, e.g. "reports/2026/q1". Folders are created automatically if they do not exist. Applied to all files in the batch.',
    ),
});

export const documentWriteTool = {
  name: 'document_write' as const,
  tool: createTool({
    description: `Save one or more files to the documents hub. Requires user approval — an approval card will be created.

USE THIS TOOL TO:
• Save generated files (text, docx, pdf, excel, pptx) to the documents hub
• Save multiple files at once in a single batch
• Organize files into folders in the documents hub

WHEN TO USE THIS TOOL:
• User says "save to [folder]", "store in [folder]", "download to [folder]", "put it in [folder]"
• User wants to keep generated files in the documents hub
• User specifies a folder/directory for file organization

DO NOT USE THIS TOOL FOR:
• Generating files — use text, docx, pdf, excel, or pptx tools first
• Searching documents — use rag_search or document_find
• Reading documents — use document_retrieve

WORKFLOW:
1. First generate file(s) using text (generate), docx (generate), pdf (generate), etc.
2. Collect the fileStorageId from each tool result
3. Call document_write with all fileStorageIds in the files array
4. A single approval card will appear for the user to review and approve all files at once

PARAMETERS:
• files: REQUIRED — array of { fileId, title? } objects. fileId is the fileStorageId from a file generation tool. title optionally overrides the document title.
• folderPath: Optional — target folder path (e.g. "reports/2026"). Created automatically if it doesn't exist. Applied to all files.`,
    inputSchema: documentWriteArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requiresApproval?: boolean;
      approvalId?: string;
      approvalCreated?: boolean;
      approvalMessage?: string;
      message: string;
      error?: string;
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to write a document.',
        };
      }

      if (args.folderPath) {
        const segments = args.folderPath.split('/').filter(Boolean);
        for (const segment of segments) {
          try {
            validateFolderName(segment);
          } catch (err) {
            return {
              success: false,
              message: `Invalid folder path segment "${segment}": ${err instanceof Error ? err.message : 'invalid name'}. Please use a valid folder path.`,
              error: `Invalid folder path: ${args.folderPath}`,
            };
          }
        }
      }

      const filesMetadata: Array<{
        fileId: string;
        fileName: string;
        title: string;
        mimeType: string;
        fileSize: number;
      }> = [];

      for (const file of args.files) {
        const fileMetadata = await ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId: toId<'_storage'>(file.fileId) },
        );

        if (!fileMetadata) {
          return {
            success: false,
            message: `File metadata not found for storage ID "${file.fileId}". The file may not have been properly saved. Try generating the file again.`,
            error: `File metadata not found: ${file.fileId}`,
          };
        }

        if (fileMetadata.organizationId !== organizationId) {
          return {
            success: false,
            message: `File "${file.fileId}" does not belong to this organization.`,
            error: `Organization mismatch for file: ${file.fileId}`,
          };
        }

        filesMetadata.push({
          fileId: file.fileId,
          fileName: fileMetadata.fileName,
          title: file.title ?? fileMetadata.fileName,
          mimeType: fileMetadata.contentType,
          fileSize: fileMetadata.size,
        });
      }

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.documents.internal_mutations
            .createDocumentWriteApproval,
          {
            organizationId,
            files: filesMetadata,
            folderPath: args.folderPath,
            threadId,
            messageId,
          },
        );

        const fileNames = filesMetadata.map((f) => f.title);
        const fileListStr = fileNames.map((n) => `"${n}"`).join(', ');

        return {
          success: true,
          requiresApproval: true,
          approvalId: String(approvalId),
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for saving ${filesMetadata.length} file(s) to the documents hub. The user must approve before the documents will be saved.`,
          message: `${fileListStr} ${filesMetadata.length === 1 ? 'is' : 'are'} ready to be saved to the documents hub${args.folderPath ? ` in folder "${args.folderPath}"` : ''}. An approval card has been created. The documents will be saved once the user approves.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create document write approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
