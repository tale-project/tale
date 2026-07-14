'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import {
  importFiles as importFilesImpl,
  type ImportItem,
} from './import_files';
import { createImportFilesDeps } from './import_files_deps';
import { listFiles as listFilesImpl } from './list_files';
import { listSharePointDrives as listSharePointDrivesImpl } from './list_sharepoint_drives';
import { listSharePointFiles as listSharePointFilesImpl } from './list_sharepoint_files';
import { listSharePointSites as listSharePointSitesImpl } from './list_sharepoint_sites';
import {
  oneDriveItemValidator,
  importItemValidator,
  importFileResultValidator,
  sharePointSiteValidator,
  sharePointDriveValidator,
} from './validators';
import { withMicrosoftToken } from './with_microsoft_token';

export const listFiles = action({
  args: {
    folderId: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    items: v.optional(v.array(oneDriveItemValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenResult = await withMicrosoftToken(ctx);
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
    const tokenResult = await withMicrosoftToken(ctx);
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

    if (args.importType === 'sync') {
      // Ongoing sync is driven by the `sync-onedrive-files` autoInstall
      // automation, provisioned at org-create / deploy / catalog resync. A
      // sync import is the moment the engine must exist, so re-run the
      // idempotent default-automation provisioner as a belt-and-braces for
      // orgs whose provisioning sweep has not landed yet (a completed or
      // org-uninstalled provision is a no-op — the org's choice wins).
      const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      await ctx.scheduler.runAfter(
        0,
        internal.automations.provision_defaults
          .syncDefaultAutomationInstallations,
        { organizationId: args.organizationId, orgSlug },
      );
    }

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

export const listSharePointSites = action({
  args: {
    search: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    sites: v.optional(v.array(sharePointSiteValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenResult = await withMicrosoftToken(ctx);
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }
    return await listSharePointSitesImpl({
      token: tokenResult.token,
      search: args.search,
    });
  },
});

export const listSharePointDrives = action({
  args: {
    siteId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    drives: v.optional(v.array(sharePointDriveValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenResult = await withMicrosoftToken(ctx);
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }
    return await listSharePointDrivesImpl({
      siteId: args.siteId,
      token: tokenResult.token,
    });
  },
});

export const listSharePointFiles = action({
  args: {
    siteId: v.string(),
    driveId: v.string(),
    folderId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    items: v.optional(v.array(oneDriveItemValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const tokenResult = await withMicrosoftToken(ctx);
    if (!tokenResult.success) {
      return { success: false, error: tokenResult.error };
    }
    return await listSharePointFilesImpl({
      siteId: args.siteId,
      driveId: args.driveId,
      folderId: args.folderId,
      token: tokenResult.token,
    });
  },
});
