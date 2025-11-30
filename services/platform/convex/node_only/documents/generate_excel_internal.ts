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
        rows: v.array(v.array(v.union(v.string(), v.number(), v.boolean(), v.null()))),
      }),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.string(),
    url: v.string(),
    fileName: v.string(),
    rowCount: v.number(),
    sheetCount: v.number(),
  }),
  handler: async (ctx, args) => {
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

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Upload to Convex storage
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      body: buffer,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload Excel file: ${response.statusText}`);
    }

    const { storageId } = await response.json();

    // Get download URL
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error('Failed to get download URL for Excel file');
    }

    const finalFileName = `${args.fileName}.xlsx`;

    console.log('[generate_excel_internal] success', {
      fileName: finalFileName,
      storageId,
      rowCount: totalRows,
      sheetCount: args.sheets.length,
    });

    return {
      success: true,
      fileId: storageId,
      url,
      fileName: finalFileName,
      rowCount: totalRows,
      sheetCount: args.sheets.length,
    };
  },
});

