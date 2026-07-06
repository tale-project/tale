/**
 * OneDrive-specific workflow actions
 *
 * These actions provide OneDrive integration operations for workflows:
 * - get_user_token: Get Microsoft Graph token for a specific user
 * - refresh_token: Refresh Microsoft Graph token
 * - read_file: Read file content from OneDrive
 * - list_folder_contents: List files in a OneDrive folder
 * - sync_folder_files: Sync files from OneDrive folder to storage
 * - upload_to_storage: Upload file to Convex storage
 * - update_sync_config: Update OneDrive sync configuration status
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { toConvexJsonRecord } from '../../../lib/type_cast_helpers';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../../lib/validators/json';
import {
  syncOneConfig,
  type SyncConfigItem,
} from '../../../onedrive/run_config_sync';
import { reconcileFolder } from '../../../onedrive/run_folder_reconcile';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

// Common field validators
const filesValidator = v.array(
  v.object({
    id: v.string(),
    name: v.string(),
    size: v.number(),
    mimeType: v.optional(v.string()),
    lastModified: v.optional(v.number()),
    relativePath: v.optional(v.string()),
  }),
);

const statusValidator = v.optional(
  v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
);

// Type for OneDrive operation params (discriminated union)
type OneDriveActionParams =
  | { operation: 'get_user_token'; userId: string }
  | { operation: 'refresh_token'; accountId: string; refreshToken: string }
  | { operation: 'read_file'; itemId: string; token: string }
  | {
      operation: 'list_folder_contents';
      itemId: string;
      token: string;
      recursive?: boolean;
    }
  | {
      operation: 'sync_folder_files';
      files: Array<{
        id: string;
        name: string;
        size: number;
        mimeType?: string;
        lastModified?: number;
        relativePath?: string;
      }>;
      token: string;
      folderItemPath?: string;
      configId?: Id<'onedriveSyncConfigs'>;
      createdBy?: string;
    }
  | {
      operation: 'upload_to_storage';
      fileName: string;
      fileContent: ArrayBuffer | string;
      contentType?: string;
      storagePath?: string;
      metadata?: Record<string, unknown>;
      createdBy?: string;
    }
  | {
      operation: 'update_sync_config';
      configId: Id<'onedriveSyncConfigs'>;
      status?: 'active' | 'inactive' | 'error';
      lastSyncAt?: number;
      lastSyncStatus?: string;
      errorMessage?: string;
    }
  | { operation: 'list_active_configs' }
  | {
      operation: 'sync_one_config';
      configId: Id<'onedriveSyncConfigs'>;
      userId: string;
      itemType: 'file' | 'folder';
      itemId: string;
      itemName: string;
      itemPath?: string;
      teamId?: string;
    };

export const onedriveAction: ActionDefinition<OneDriveActionParams> = {
  type: 'onedrive',
  title: 'OneDrive Operation',
  description:
    'Execute OneDrive operations (get_user_token, refresh_token, read_file, list_folder_contents, sync_folder_files, list_active_configs, sync_one_config, upload_to_storage, update_sync_config). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // get_user_token: Get Microsoft Graph token for a user
    v.object({
      operation: v.literal('get_user_token'),
      userId: v.string(),
    }),
    // refresh_token: Refresh Microsoft Graph token
    v.object({
      operation: v.literal('refresh_token'),
      accountId: v.string(),
      refreshToken: v.string(),
    }),
    // read_file: Read file content from OneDrive
    v.object({
      operation: v.literal('read_file'),
      itemId: v.string(),
      token: v.string(),
    }),
    // list_folder_contents: List files in a OneDrive folder
    v.object({
      operation: v.literal('list_folder_contents'),
      itemId: v.string(),
      token: v.string(),
      recursive: v.optional(v.boolean()),
    }),
    // sync_folder_files: Sync files from OneDrive folder to storage
    v.object({
      operation: v.literal('sync_folder_files'),
      files: filesValidator,
      token: v.string(),
      folderItemPath: v.optional(v.string()),
      configId: v.optional(v.id('onedriveSyncConfigs')),
      createdBy: v.optional(v.string()),
    }),
    // upload_to_storage: Upload file to Convex storage
    v.object({
      operation: v.literal('upload_to_storage'),
      fileName: v.string(),
      fileContent: jsonValueValidator,
      contentType: v.optional(v.string()),
      storagePath: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      createdBy: v.optional(v.string()),
    }),
    // update_sync_config: Update OneDrive sync configuration
    v.object({
      operation: v.literal('update_sync_config'),
      configId: v.id('onedriveSyncConfigs'),
      status: statusValidator,
      lastSyncAt: v.optional(v.number()),
      lastSyncStatus: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
    }),
    // list_active_configs: List all active sync configs for the org (loop source)
    v.object({
      operation: v.literal('list_active_configs'),
    }),
    // sync_one_config: Reconcile a single sync config (one loop iteration)
    v.object({
      operation: v.literal('sync_one_config'),
      configId: v.id('onedriveSyncConfigs'),
      userId: v.string(),
      itemType: v.union(v.literal('file'), v.literal('folder')),
      itemId: v.string(),
      itemName: v.string(),
      itemPath: v.optional(v.string()),
      teamId: v.optional(v.string()),
    }),
  ),
  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables
    const organizationId =
      typeof variables.organizationId === 'string'
        ? variables.organizationId
        : undefined;
    switch (params.operation) {
      case 'get_user_token': {
        // Get Microsoft Graph token for the specific user
        const result = await ctx.runQuery(
          internal.onedrive.internal_queries.getUserToken,
          {
            userId: params.userId, // Required by validator
          },
        );

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          token: result.token,
          needsRefresh: result.needsRefresh,
          accountId: result.accountId,
          refreshToken: result.refreshToken,
          userId: params.userId,
        };
      }

      case 'refresh_token': {
        // Refresh the Microsoft Graph token
        const result = await ctx.runAction(
          internal.onedrive.internal_actions.refreshToken,
          {
            accountId: params.accountId, // Required by validator
            refreshToken: params.refreshToken, // Required by validator
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to refresh token');
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          token: result.accessToken,
        };
      }

      case 'read_file': {
        // Read file from OneDrive using Microsoft Graph API
        const result = await ctx.runAction(
          internal.onedrive.internal_actions.readFileFromOneDrive,
          {
            itemId: params.itemId, // Required by validator
            token: params.token, // Required by validator
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to read file from OneDrive');
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          content: result.content,
          mimeType: result.mimeType,
          size: result.size,
        };
      }

      case 'upload_to_storage': {
        if (!organizationId) {
          throw new Error(
            'upload_to_storage requires organizationId in workflow context',
          );
        }

        // Upload file to Convex storage
        const result = await ctx.runAction(
          internal.onedrive.internal_actions.uploadToStorage,
          {
            organizationId,
            fileName: params.fileName, // Required by validator
            fileData:
              typeof params.fileContent === 'string'
                ? new TextEncoder().encode(params.fileContent).buffer
                : params.fileContent, // Required by validator
            contentType: params.contentType || 'application/octet-stream',
            metadata: toConvexJsonRecord(params.metadata || {}),
            createdBy: params.createdBy,
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to upload file to storage');
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          fileId: result.fileId,
          documentId: result.documentId,
          storagePath: params.storagePath,
        };
      }

      case 'list_folder_contents': {
        // List files in OneDrive folder using Microsoft Graph API
        const result = await ctx.runAction(
          internal.onedrive.internal_actions.listFolderContents,
          {
            itemId: params.itemId, // Required by validator
            token: params.token, // Required by validator
            recursive: params.recursive,
          },
        );

        if (!result.success) {
          throw new Error(
            result.error || 'Failed to list folder contents from OneDrive',
          );
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return result.files || [];
      }

      case 'sync_folder_files': {
        if (!organizationId) {
          throw new Error(
            'sync_folder_files requires organizationId in workflow context',
          );
        }
        if (!params.configId) {
          throw new Error('sync_folder_files requires configId');
        }

        const config = await ctx.runQuery(
          internal.onedrive.internal_queries.getSyncConfig,
          { configId: params.configId },
        );
        if (!config || config.organizationId !== organizationId) {
          throw new Error('Sync config not found');
        }
        if (config.status !== 'active') {
          return { created: 0, updated: 0, skipped: 0, errorsCount: 0 };
        }

        // Adds/updates + prune share one implementation with the "sync all
        // active configs" run (reconcileFolder).
        return await reconcileFolder(ctx, {
          organizationId,
          configId: params.configId,
          itemId: config.itemId,
          itemName: config.itemName,
          itemPath: config.itemPath,
          userId: config.userId,
          teamId: config.teamId,
          files: params.files,
          token: params.token,
        });
      }

      case 'list_active_configs': {
        if (!organizationId) {
          throw new Error(
            'list_active_configs requires organizationId in workflow context',
          );
        }
        // Loop source: every active sync config for the org. The workflow's
        // loop node iterates these so each config is a durable, retryable step.
        const configs = await ctx.runQuery(
          internal.onedrive.internal_queries.listActiveSyncConfigs,
          { organizationId },
        );
        return { configs };
      }

      case 'sync_one_config': {
        if (!organizationId) {
          throw new Error(
            'sync_one_config requires organizationId in workflow context',
          );
        }
        const config: SyncConfigItem = {
          configId: params.configId,
          userId: params.userId,
          itemType: params.itemType,
          itemId: params.itemId,
          itemName: params.itemName,
          itemPath: params.itemPath,
          teamId: params.teamId,
        };
        // Mark the config row with the outcome so the UI reflects per-config
        // status; never throw, so one failing config can't abort the loop.
        try {
          const result = await syncOneConfig(ctx, { organizationId, config });
          await ctx.runMutation(
            internal.onedrive.internal_mutations.updateSyncConfig,
            {
              configId: params.configId,
              organizationId,
              status: 'active',
              lastSyncAt: Date.now(),
              lastSyncStatus: 'success',
            },
          );
          return { status: 'success', ...result };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await ctx.runMutation(
            internal.onedrive.internal_mutations.updateSyncConfig,
            {
              configId: params.configId,
              organizationId,
              status: 'error',
              lastSyncAt: Date.now(),
              lastSyncStatus: 'failed',
              errorMessage: message,
            },
          );
          return {
            status: 'error',
            error: message,
            created: 0,
            skipped: 0,
            deleted: 0,
            errorsCount: 1,
          };
        }
      }

      case 'update_sync_config': {
        if (!organizationId) {
          throw new Error(
            'update_sync_config requires organizationId in workflow context',
          );
        }
        // Update OneDrive sync configuration (org-scoped so a workflow can't
        // touch another tenant's sync config by id).
        await ctx.runMutation(
          internal.onedrive.internal_mutations.updateSyncConfig,
          {
            configId: params.configId, // Required by validator
            status: params.status,
            lastSyncAt: params.lastSyncAt,
            lastSyncStatus: params.lastSyncStatus,
            errorMessage: params.errorMessage,
            organizationId,
          },
        );

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          configId: params.configId,
          status: params.status,
        };
      }

      default:
        throw new Error(
          `Unsupported onedrive operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
