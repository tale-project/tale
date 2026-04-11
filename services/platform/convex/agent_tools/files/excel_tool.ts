/** Convex Tool: Excel
 *  Generate Excel (.xlsx) files from tabular data.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { buildDownloadUrl } from '../../lib/helpers/public_storage_url';
import type { ToolDefinition } from '../types';
import { appendFilePart } from './helpers/append_file_part';

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

const excelArgs = z.object({
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
});

export const excelTool = {
  name: 'excel' as const,
  tool: createTool({
    description: `Excel (.xlsx) tool for generating spreadsheet files.

IMPORTANT: Only call this tool when the user explicitly requests creating or exporting an Excel/spreadsheet file. Do NOT proactively generate Excel files unless the user specifically asks for this format.

OPERATION:

generate - Generate an Excel file from structured tabular data
  Use this when the user asks for an Excel/Spreadsheet export (e.g. customer lists, product tables, analytics).
  Parameters:
  - fileName: Base name for the Excel file (without extension)
  - sheets: Array of sheets with names, headers, and rows
  Returns: { success, downloadUrl, fileName, rowCount, sheetCount }

EXAMPLE:
• Generate: { "operation": "generate", "fileName": "customers", "sheets": [{ "name": "Sheet1", "headers": ["Name", "Email"], "rows": [["Alice", "alice@example.com"]] }] }

AFTER GENERATING: Check the downloadUrl in the result:
- If it says "[file card shown in chat]": the file is already visible as a download card. Do NOT mention downloading, do NOT include a link, and do NOT say "you can download it" — the card handles this.
- If it contains an actual URL: no download card was shown. You MUST include the URL as a clickable markdown link so the user can download the file.
To also save the file to a folder in the documents hub, call document_write with the returned fileStorageId and the desired folderPath.

TO READ FILE CONTENT: Do NOT use this tool. Instead use the rag_search tool:
• To get the full content of a file: use rag_search with operation='retrieve' and the fileId
• To search for specific information across files: use rag_search with operation='search'
`,
    inputSchema: excelArgs,
    execute: async (ctx: ToolCtx, args): Promise<GenerateExcelResult> => {
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
            source: 'agent',
          },
        );

        const url = buildDownloadUrl(fileId, result.fileName);

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
