/** Convex Tool: Excel
 *  Generate Excel (.xlsx) files from tabular data.
 *  Parse Excel files to extract structured content.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import { appendFilePart } from './helpers/append_file_part';
import { resolveFileName } from './helpers/resolve_file_name';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Result types
interface GenerateExcelResult {
  operation: 'generate';
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  rowCount: number;
  sheetCount: number;
  error?: string;
}

interface ParseExcelResult {
  operation: 'parse';
  success: boolean;
  fileName: string;
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<Array<string | number | boolean | null>>;
    rowCount: number;
  }>;
  totalRows: number;
  sheetCount: number;
  error?: string;
}

type ExcelResult = GenerateExcelResult | ParseExcelResult;

const excelArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('generate'),
    fileName: z
      .string()
      .describe('Base name for the Excel file (without extension)'),
    sheets: z
      .array(
        z.object({
          name: z.string().describe('Sheet name'),
          headers: z
            .array(z.string())
            .nonempty()
            .describe(
              "Column headers for the sheet (must align with each row's columns)",
            ),
          rows: z
            .array(
              z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
            )
            .describe('2D array of cell values (rows x columns)'),
        }),
      )
      .describe('Sheets to include in the Excel file'),
  }),
  z.object({
    operation: z.literal('parse'),
    fileId: z
      .string()
      .describe(
        "Convex storage ID (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Original filename (e.g., 'report.xlsx'). Optional — auto-resolved from file metadata if omitted.",
      ),
  }),
]);

export const excelTool = {
  name: 'excel' as const,
  tool: createTool({
    description: `Excel (.xlsx) tool for generating and parsing spreadsheet files.

IMPORTANT: Only call the "generate" operation when the user explicitly requests creating or exporting an Excel/spreadsheet file. Do NOT proactively generate Excel files unless the user specifically asks for this format.

OPERATIONS:

1. generate - Generate an Excel file from structured tabular data
   Use this when the user asks for an Excel/Spreadsheet export (e.g. customer lists, product tables, analytics).
   Parameters:
   - fileName: Base name for the Excel file (without extension)
   - sheets: Array of sheets with names, headers, and rows
   Returns: { success, downloadUrl, fileName, rowCount, sheetCount }

2. parse - Extract structured data from an existing Excel file
   USE THIS when a user uploads an Excel file and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Optional — original filename (e.g., "report.xlsx"). Auto-resolved from file metadata if omitted.
   Returns: { success, sheets (with headers and rows), totalRows, sheetCount }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "customers", "sheets": [{ "name": "Sheet1", "headers": ["Name", "Email"], "rows": [["Alice", "alice@example.com"]] }] }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "report.xlsx" }

AFTER GENERATING: The file automatically appears as a download card in the chat. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this. To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.
`,
    inputSchema: excelArgs,
    execute: async (ctx: ToolCtx, args): Promise<ExcelResult> => {
      if (args.operation === 'parse') {
        const resolvedFilename = await resolveFileName(
          ctx,
          args.fileId,
          args.filename,
        );

        debugLog('tool:excel parse start', {
          fileId: args.fileId,
          filename: resolvedFilename,
        });

        try {
          const result = await ctx.runAction(
            internal.node_only.documents.internal_actions.parseExcel,
            {
              storageId: toId<'_storage'>(args.fileId),
            },
          );

          debugLog('tool:excel parse success', {
            filename: resolvedFilename,
            sheetCount: result.sheetCount,
            totalRows: result.totalRows,
          });

          return {
            operation: 'parse',
            success: true,
            fileName: resolvedFilename,
            sheets: result.sheets,
            totalRows: result.totalRows,
            sheetCount: result.sheetCount,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error('[tool:excel parse] error', {
            fileId: args.fileId,
            error: message,
          });
          return {
            operation: 'parse',
            success: false,
            fileName: resolvedFilename,
            sheets: [],
            totalRows: 0,
            sheetCount: 0,
            error: message,
          };
        }
      }

      // operation === 'generate'
      debugLog('tool:excel generate start', {
        fileName: args.fileName,
        sheetCount: args.sheets.length,
      });

      try {
        const result = await ctx.runAction(
          internal.node_only.documents.internal_actions.generateExcel,
          {
            fileName: args.fileName,
            sheets: args.sheets,
          },
        );

        // Decode base64 to Uint8Array and upload to storage
        const binaryString = atob(result.fileBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const fileId = await ctx.storage.store(blob);

        await ctx.runMutation(
          internal.file_metadata.internal_mutations.saveFileMetadata,
          {
            organizationId: ctx.organizationId ?? 'system',
            storageId: fileId,
            fileName: result.fileName,
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: blob.size,
          },
        );

        const url = await ctx.storage.getUrl(fileId);

        if (!url) {
          throw new Error('Storage URL unavailable for generated Excel file.');
        }

        debugLog('tool:excel generate success', {
          fileName: result.fileName,
          fileId,
          rowCount: result.rowCount,
          sheetCount: result.sheetCount,
        });

        const cardAppended = await appendFilePart(ctx, {
          fileName: result.fileName,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          downloadUrl: url,
        });

        return {
          operation: 'generate',
          success: true,
          fileStorageId: fileId,
          downloadUrl: cardAppended ? '[file card shown in chat]' : url,
          fileName: result.fileName,
          rowCount: result.rowCount,
          sheetCount: result.sheetCount,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[tool:excel generate] error', {
          fileName: args.fileName,
          error: message,
        });
        return {
          operation: 'generate',
          success: false,
          fileStorageId: '',
          downloadUrl: '',
          fileName: args.fileName,
          rowCount: 0,
          sheetCount: 0,
          error: message,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
