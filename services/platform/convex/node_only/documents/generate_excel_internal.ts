'use node';

/**
 * Internal action to generate Excel files using xlsx.
 * Must run in Node.js runtime for buffer generation.
 */

import { internalAction } from '../../_generated/server';
import { v } from 'convex/values';
import * as XLSX from 'xlsx';

export const generateExcelInternal = internalAction({
  args: {
    fileName: v.string(),
    sheets: v.array(
      v.object({
        name: v.string(),
        headers: v.array(v.string()),
        rows: v.array(
          v.array(v.union(v.string(), v.number(), v.boolean(), v.null())),
        ),
      }),
    ),
  },
  // Node-only action: generate the Excel workbook and return it as base64 + metadata.
  // Storage upload must be done from a default-runtime Convex action.
  returns: v.object({
    fileBase64: v.string(),
    fileName: v.string(),
    rowCount: v.number(),
    sheetCount: v.number(),
  }),
  handler: async (_ctx, args) => {
    console.log('[generate_excel_internal] start', {
      fileName: args.fileName,
      sheetCount: args.sheets.length,
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();
    let totalRows = 0;

    // Add each sheet
    for (const sheet of args.sheets) {
      // Combine headers and rows
      const data = [sheet.headers, ...sheet.rows];
      const worksheet = XLSX.utils.aoa_to_sheet(data);

      // Set column widths based on content
      const colWidths = sheet.headers.map((header, i) => {
        const maxLen = Math.max(
          header.length,
          ...sheet.rows.map((row) => String(row[i] ?? '').length),
        );
        return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
      });
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
      totalRows += sheet.rows.length;
    }

    // Generate buffer and convert to base64 so it can be safely returned to the
    // default-runtime action, which will handle storage upload.
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileBase64 = (buffer as any).toString('base64');

    const finalFileName = `${args.fileName}.xlsx`;

    console.log('[generate_excel_internal] built workbook', {
      fileName: finalFileName,
      rowCount: totalRows,
      sheetCount: args.sheets.length,
    });

    return {
      fileBase64,
      fileName: finalFileName,
      rowCount: totalRows,
      sheetCount: args.sheets.length,
    };
  },
});
