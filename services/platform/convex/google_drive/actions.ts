'use node';

import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  importFiles as importFilesImpl,
  type ImportItem,
} from './import_files';
import { createImportFilesDeps } from './import_files_deps';
import { listFiles as listFilesImpl } from './list_files';
import {
  googleDriveItemValidator,
  importFileResultValidator,
  importItemValidator,
} from './validators';
import { withGoogleToken } from './with_google_token';

export const listFiles = action({
  args: {
    organizationId: v.string(),
    folderId: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    items: v.optional(v.array(googleDriveItemValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireOrgMembershipById(ctx, args.organizationId);
    const tokenResult = await withGoogleToken(ctx, args.organizationId);
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }
    return await listFilesImpl(tokenResult.token, args.folderId, args.search);
  },
});

export const importFiles = action({
  args: {
    items: v.array(importItemValidator),
    organizationId: v.string(),
    importType: v.union(v.literal('one-time'), v.literal('sync')),
    teamId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    results: v.array(importFileResultValidator),
    totalFiles: v.number(),
    successCount: v.number(),
    failedCount: v.number(),
    skippedCount: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const tokenResult = await withGoogleToken(ctx, args.organizationId);
    if (!tokenResult.success) {
      return {
        success: false,
        results: [],
        totalFiles: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        error: tokenResult.error,
      };
    }

    // Ongoing Google Drive sync configs are registered on Sync import.
    // The scheduled sync engine is parked with OneDrive's while the
    // automation engine is rebuilt — configs + Stop syncing still work.
    return await importFilesImpl(
      {
        items: args.items as ImportItem[],
        organizationId: args.organizationId,
        importType: args.importType,
        teamId: args.teamId,
        token: tokenResult.token,
        userId: tokenResult.userId,
      },
      createImportFilesDeps(ctx, args.organizationId),
    );
  },
});
