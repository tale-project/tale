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

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

// Result types
interface GenerateExcelResult {
  operation: 'generate';
  success: boolean;
  fileId: string;
  url: string;
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

const excelArgs = z.object({
  operation: z
    .enum(['generate', 'parse'])
    .optional()
    .describe(
      "Operation: 'generate' (default) or 'parse' (extract data from Excel).",
    ),
  // For generate operation
  fileName: z
    .string()
    .optional()
    .describe(
      "For 'generate': Base name for the Excel file (without extension). Required for generate.",
    ),
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
    .optional()
    .describe(
      "For 'generate': Sheets to include in the Excel file. Required for generate.",
    ),
  // For parse operation
  fileId: z
    .string()
    .optional()
    .describe(
      "For 'parse': **REQUIRED** - Convex storage ID (e.g., 'kg2bazp7fbgt9srq63knfagjrd7yfenj'). Get this from the file attachment context.",
    ),
  filename: z
    .string()
    .optional()
    .describe("For 'parse': Original filename (e.g., 'report.xlsx')"),
});

export const excelTool = {
  name: 'excel' as const,
  tool: createTool({
    description: `Excel (.xlsx) tool for generating and parsing spreadsheet files.

OPERATIONS:

1. generate - Generate an Excel file from structured tabular data
   Use this when the user asks for an Excel/Spreadsheet export (e.g. customer lists, product tables, analytics).
   Parameters:
   - fileName: Base name for the Excel file (without extension)
   - sheets: Array of sheets with names, headers, and rows
   Returns: { success, url, fileName, rowCount, sheetCount }

2. parse - Extract structured data from an existing Excel file
   USE THIS when a user uploads an Excel file and you need to read its content.
   Parameters:
   - fileId: **REQUIRED** - Convex storage ID (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")
   - filename: Original filename (e.g., "report.xlsx")
   Returns: { success, sheets (with headers and rows), totalRows, sheetCount }

EXAMPLES:
• Generate: { "operation": "generate", "fileName": "customers", "sheets": [{ "name": "Sheet1", "headers": ["Name", "Email"], "rows": [["Alice", "alice@example.com"]] }] }
• Parse: { "operation": "parse", "fileId": "kg2bazp7...", "filename": "report.xlsx" }

CRITICAL: When presenting download links, copy the exact 'url' from the result. Never fabricate URLs.
`,
    args: excelArgs,
    handler: async (ctx: ToolCtx, args): Promise<ExcelResult> => {
      const operation = args.operation ?? 'generate';

      // Handle parse operation
      if (operation === 'parse') {
        if (!args.fileId) {
          throw new Error(
            "Missing required 'fileId' for parse operation. Get the fileId from the file attachment context.",
          );
        }

        debugLog('tool:excel parse start', {
          fileId: args.fileId,
          filename: args.filename,
        });

        try {
          const result = await ctx.runAction(
            internal.node_only.documents.internal_actions.parseExcel,
            {
              storageId: toId<'_storage'>(args.fileId),
            },
          );

          debugLog('tool:excel parse success', {
            filename: args.filename,
            sheetCount: result.sheetCount,
            totalRows: result.totalRows,
          });

          return {
            operation: 'parse',
            success: true,
            fileName: args.filename ?? 'unknown.xlsx',
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
            fileName: args.filename ?? 'unknown.xlsx',
            sheets: [],
            totalRows: 0,
            sheetCount: 0,
            error: message,
          };
        }
      }

      // Default: generate operation
      if (!args.fileName) {
        throw new Error("Missing required 'fileName' for generate operation");
      }
      if (!args.sheets || args.sheets.length === 0) {
        throw new Error("Missing required 'sheets' for generate operation");
      }

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

        return {
          operation: 'generate',
          success: true,
          fileId,
          url,
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
          operation: 'generate' as const,
          success: false,
          fileId: '',
          url: '',
          fileName: args.fileName ?? 'unknown.xlsx',
          rowCount: 0,
          sheetCount: 0,
          error: message,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
