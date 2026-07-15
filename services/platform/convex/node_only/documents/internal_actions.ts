'use node';

/**
 * Internal actions for Excel files using xlsx.
 * Must run in Node.js runtime for buffer/binary operations.
 */

import { v } from 'convex/values';
// xlsx resolves to the SheetJS-maintained CDN tarball pinned in
// services/platform/package.json (the npm release line is frozen at 0.18.5).
// Renovate/OSV cannot track URL deps — bump the pin manually when
// https://cdn.sheetjs.com/ announces a new release.
import * as XLSX from 'xlsx';

import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import { orgSlugFromIdOrNull } from '../../lib/helpers/org_slug';
import { readBlobBytes } from '../../lib/storage/blob_access';
import { blobRefValidator, convexStorageId } from '../../lib/storage/blob_ref';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export const generateExcel = internalAction({
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
    debugLog('generate_excel_internal start', {
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
    const buffer: Buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });
    const fileBase64 = buffer.toString('base64');

    const finalFileName = `${args.fileName}.xlsx`;

    debugLog('generate_excel_internal built workbook', {
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

export const parseExcel = internalAction({
  args: {
    // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
    storageId: blobRefValidator,
    /** Owning org (Better Auth id) — required to read an `s3:` ref. */
    organizationId: v.optional(v.string()),
  },
  returns: v.object({
    sheets: v.array(
      v.object({
        name: v.string(),
        headers: v.array(v.string()),
        rows: v.array(
          v.array(v.union(v.string(), v.number(), v.boolean(), v.null())),
        ),
        rowCount: v.number(),
      }),
    ),
    totalRows: v.number(),
    sheetCount: v.number(),
  }),
  handler: async (ctx, args) => {
    debugLog('parse_excel_internal start', { storageId: args.storageId });

    // Backend-aware read: `_storage` blobs stream from ctx.storage (as
    // before); an `s3:` ref reads from the org's own bucket via the seam.
    let bytes: Uint8Array;
    const convexId = convexStorageId(args.storageId);
    if (convexId !== null) {
      const blob = await ctx.storage.get(convexId);
      if (!blob) {
        throw new Error(`File not found in storage: ${args.storageId}`);
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
      const orgSlug = args.organizationId
        ? await orgSlugFromIdOrNull(ctx, args.organizationId)
        : null;
      if (orgSlug === null) {
        throw new Error(
          `Cannot read S3 blob ${args.storageId}: missing/unresolvable organizationId`,
        );
      }
      bytes = await readBlobBytes(ctx, orgSlug, args.storageId);
    }

    const workbook = XLSX.read(bytes, { type: 'array' });

    let totalRows = 0;
    const sheets = workbook.SheetNames.map((name) => {
      const worksheet = workbook.Sheets[name];
      if (!worksheet) {
        return { name, headers: [], rows: [], rowCount: 0 };
      }

      const jsonData: Array<Array<string | number | boolean | null>> =
        XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

      const headers =
        jsonData.length > 0
          ? jsonData[0].map((cell) => String(cell ?? ''))
          : [];
      const rows = jsonData.slice(1);
      totalRows += rows.length;

      return { name, headers, rows, rowCount: rows.length };
    });

    debugLog('parse_excel_internal success', {
      sheetCount: sheets.length,
      totalRows,
    });

    return { sheets, totalRows, sheetCount: sheets.length };
  },
});
