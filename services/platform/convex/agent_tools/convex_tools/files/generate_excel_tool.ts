/** Convex Tool: generate_excel
 *  Generate an Excel (.xlsx) file from tabular data and upload it to Convex storage.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface GenerateExcelResult {
  success: boolean;
  fileId: string;
  url: string;
  fileName: string;
  rowCount: number;
  sheetCount: number;
}

export const generateExcelTool = {
  name: 'generate_excel' as const,
  tool: createTool({
    description: `Generate an Excel (.xlsx) file from structured tabular data and upload it to Convex storage.

Use this when the user asks for an Excel/Spreadsheet export of tabular data (e.g. customer lists, product tables, analytics tables).

Parameters:
- fileName: Base name for the Excel file (without extension)
- sheets: Array of sheets with names and rows

Returns:
- success: boolean
- url: Download URL for the user to download the file
- fileName: Final file name with extension
- rowCount: Total number of rows across all sheets
- sheetCount: Number of sheets in the workbook

CRITICAL:
1. When presenting the download link to the user, you MUST copy the exact 'url' value from the tool result. Never fabricate or guess URLs.
`,
    args: z.object({
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
                z.array(
                  z.union([z.string(), z.number(), z.boolean(), z.null()]),
                ),
              )
              .describe('2D array of cell values (rows x columns)'),
          }),
        )
        .nonempty()
        .describe('Sheets to include in the Excel file'),
    }),
    handler: async (ctx, args): Promise<GenerateExcelResult> => {
      const actionCtx = ctx as unknown as ActionCtx;

      debugLog('tool:generate_excel start', {
        fileName: args.fileName,
        sheetCount: args.sheets.length,
      });

      try {
        const result = await actionCtx.runAction(
          internal.documents.generateExcelInternal,
          {
            fileName: args.fileName,
            sheets: args.sheets,
          },
        );

        debugLog('tool:generate_excel success', {
          fileName: result.fileName,
          fileId: result.fileId,
          rowCount: result.rowCount,
          sheetCount: result.sheetCount,
        });

        return result as GenerateExcelResult;
      } catch (error) {
        console.error('[tool:generate_excel] error', {
          fileName: args.fileName,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
