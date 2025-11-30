/**
 * OneDrive-specific workflow actions
 *
 * These actions provide OneDrive integration operations for workflows:
 * - get_user_token: Get Microsoft Graph token for a specific user
 * - read_file: Read file content from OneDrive
 * - list_folder_contents: List files in a OneDrive folder
 * - create_file_sync_configs: Create sync configs for files in a folder
 * - upload_to_storage: Upload file to Convex storage
 * - update_sync_config: Update OneDrive sync configuration status
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

export const onedriveAction: ActionDefinition<{
  operation:
    | 'get_user_token'
    | 'refresh_token'
    | 'read_file'
    | 'list_folder_contents'
    | 'create_file_sync_configs'
    | 'sync_folder_files'
    | 'upload_to_storage'
    | 'update_sync_config';
  // get_user_token parameters
  userId?: string;
  // refresh_token parameters
  accountId?: string;
  refreshToken?: string;
  // read_file parameters
  itemId?: string;
  token?: string;
  // list_folder_contents parameters (uses itemId and token)
  // create_file_sync_configs parameters
  organizationId?: string;
  targetBucket?: string;
  folderStoragePrefix?: string;
  folderItemPath?: string;
  files?: Array<{
    id: string;
    name: string;
    size: number;
    mimeType?: string;
  }>;
  // upload_to_storage parameters
  fileName?: string;
  fileContent?: ArrayBuffer | string;
  contentType?: string;
  storagePath?: string;
  metadata?: Record<string, unknown>;
  // update_sync_config parameters
  configId?: string;
  status?: 'active' | 'inactive' | 'error';
  lastSyncAt?: number;
  lastSyncStatus?: string;
  errorMessage?: string;
}> = {
  type: 'onedrive',
  title: 'OneDrive Operation',
  description:
    'Execute OneDrive operations (get_user_token, refresh_token, read_file, list_folder_contents, create_file_sync_configs, sync_folder_files, upload_to_storage, update_sync_config)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('get_user_token'),
      v.literal('refresh_token'),
      v.literal('read_file'),
      v.literal('list_folder_contents'),
      v.literal('create_file_sync_configs'),
      v.literal('sync_folder_files'),
      v.literal('upload_to_storage'),
      v.literal('update_sync_config'),
    ),
    userId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    itemId: v.optional(v.string()),
    token: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    targetBucket: v.optional(v.string()),
    folderStoragePrefix: v.optional(v.string()),
    folderItemPath: v.optional(v.string()),
    files: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          size: v.number(),
          mimeType: v.optional(v.string()),
          lastModified: v.optional(v.number()),
        }),
      ),
    ),
    fileName: v.optional(v.string()),
    fileContent: v.optional(v.any()),
    contentType: v.optional(v.string()),
    storagePath: v.optional(v.string()),
    metadata: v.optional(v.any()),
    configId: v.optional(v.id('onedriveSyncConfigs')),
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  }),
  async execute(ctx, params) {
    switch (params.operation) {
      case 'get_user_token': {
        if (!params.userId) {
          throw new Error('get_user_token operation requires userId parameter');
        }

        // Get Microsoft Graph token for the specific user
        const result = await ctx.runQuery!(
          internal.onedrive.getUserMicrosoftGraphToken,
          {
            userId: params.userId,
          },
        );

        return {
          operation: 'get_user_token',
          data: {
            token: result.token,
            needsRefresh: result.needsRefresh,
            accountId: result.accountId,
            refreshToken: result.refreshToken,
            userId: params.userId,
          },
          success: result.token !== null,
          timestamp: Date.now(),
        };
      }

      case 'refresh_token': {
        if (!params.accountId) {
          throw new Error(
            'refresh_token operation requires accountId parameter',
          );
        }
        if (!params.refreshToken) {
          throw new Error(
            'refresh_token operation requires refreshToken parameter',
          );
        }

        // Refresh the Microsoft Graph token
        const result = await ctx.runAction!(
          internal.onedrive.refreshMicrosoftGraphToken,
          {
            accountId: params.accountId,
            refreshToken: params.refreshToken,
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to refresh token');
        }

        return {
          operation: 'refresh_token',
          data: {
            token: result.accessToken,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'read_file': {
        if (!params.itemId) {
          throw new Error('read_file operation requires itemId parameter');
        }
        if (!params.token) {
          throw new Error('read_file operation requires token parameter');
        }

        // Read file from OneDrive using Microsoft Graph API
        const result = await ctx.runAction!(
          internal.onedrive.readFileFromOneDrive,
          {
            itemId: params.itemId,
            token: params.token,
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to read file from OneDrive');
        }

        return {
          operation: 'read_file',
          data: {
            content: result.content,
            mimeType: result.mimeType,
            size: result.size,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'upload_to_storage': {
        if (!params.organizationId) {
          throw new Error(
            'upload_to_storage operation requires organizationId parameter',
          );
        }
        if (!params.fileName) {
          throw new Error(
            'upload_to_storage operation requires fileName parameter',
          );
        }
        if (!params.fileContent) {
          throw new Error(
            'upload_to_storage operation requires fileContent parameter',
          );
        }

        // Upload file to Convex storage
        const result = await ctx.runAction!(internal.onedrive.uploadToStorage, {
          organizationId: params.organizationId,
          fileName: params.fileName,
          fileData:
            typeof params.fileContent === 'string'
              ? new TextEncoder().encode(params.fileContent).buffer
              : params.fileContent,
          contentType: params.contentType || 'application/octet-stream',
          metadata: params.metadata || {},
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to upload file to storage');
        }

        return {
          operation: 'upload_to_storage',
          data: {
            fileId: result.fileId,
            documentId: result.documentId,
            storagePath: params.storagePath,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'list_folder_contents': {
        if (!params.itemId) {
          throw new Error(
            'list_folder_contents operation requires itemId parameter',
          );
        }
        if (!params.token) {
          throw new Error(
            'list_folder_contents operation requires token parameter',
          );
        }

        // List files in OneDrive folder using Microsoft Graph API
        const result = await ctx.runAction!(
          internal.onedrive.listFolderContents,
          {
            itemId: params.itemId,
            token: params.token,
          },
        );

        if (!result.success) {
          throw new Error(
            result.error || 'Failed to list folder contents from OneDrive',
          );
        }

        return {
          operation: 'list_folder_contents',
          data: {
            files: result.files || [],
            count: result.files?.length || 0,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'create_file_sync_configs': {
        if (!params.organizationId) {
          throw new Error(
            'create_file_sync_configs operation requires organizationId parameter',
          );
        }
        if (!params.userId) {
          throw new Error(
            'create_file_sync_configs operation requires userId parameter',
          );
        }
        if (!params.targetBucket) {
          throw new Error(
            'create_file_sync_configs operation requires targetBucket parameter',
          );
        }
        if (!params.folderStoragePrefix) {
          throw new Error(
            'create_file_sync_configs operation requires folderStoragePrefix parameter',
          );
        }
        if (!params.folderItemPath) {
          throw new Error(
            'create_file_sync_configs operation requires folderItemPath parameter',
          );
        }
        if (!params.files) {
          throw new Error(
            'create_file_sync_configs operation requires files parameter',
          );
        }

        // Create sync configs for each file in the folder
        const result = await ctx.runMutation!(
          internal.onedrive.createSyncConfigsForFiles,
          {
            organizationId: params.organizationId,
            userId: params.userId,
            targetBucket: params.targetBucket,
            folderStoragePrefix: params.folderStoragePrefix,
            folderItemPath: params.folderItemPath,
            files: params.files.map((f) => ({
              id: f.id,
              name: f.name,
              size: f.size,
              mimeType: f.mimeType,
            })),
          },
        );

        return {
          operation: 'create_file_sync_configs',
          data: {
            count: result.count,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'sync_folder_files': {
        if (!params.organizationId) {
          throw new Error(
            'sync_folder_files operation requires organizationId parameter',
          );
        }
        if (!params.files) {
          throw new Error(
            'sync_folder_files operation requires files parameter',
          );
        }
        if (!params.token) {
          throw new Error(
            'sync_folder_files operation requires token parameter',
          );
        }

        // Build a map of existing documents by OneDrive item id for this org
        const existingByItemId = new Map<string, any>();
        let cursor: string | null = null;
        // Paginate through existing onedrive_sync documents
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const res = (await ctx.runQuery!(internal.documents.queryDocuments, {
            organizationId: params.organizationId,
            sourceProvider: 'onedrive',
            paginationOpts: { numItems: 100, cursor },
          })) as {
            page: any[];
            isDone: boolean;
            continueCursor: string | null;
          };
          for (const doc of res.page) {
            const meta = (doc as any).metadata ?? {};
            const key =
              ((doc as any).externalItemId as string | undefined) ??
              ((meta as any).oneDriveItemId as string | undefined) ??
              ((meta as any).oneDriveId as string | undefined);
            if (key) existingByItemId.set(key, doc);
          }
          if (res.isDone) break;
          cursor = (res.continueCursor as string | null) ?? null;
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;
        const errors: Array<{ itemId: string; error: string }> = [];

        for (const f of params.files) {
          try {
            const existing = existingByItemId.get(f.id);
            const lastModified = (f as any).lastModified as number | undefined;
            const prevModified = existing
              ? (((existing as any).metadata || {}).sourceModifiedAt as
                  | number
                  | undefined)
              : undefined;

            if (
              existing &&
              lastModified !== undefined &&
              prevModified !== undefined &&
              lastModified <= prevModified
            ) {
              skipped++;
              continue;
            }

            // Read file from OneDrive
            const readRes = await ctx.runAction!(
              internal.onedrive.readFileFromOneDrive,
              { itemId: f.id, token: params.token },
            );
            if (!readRes.success || !readRes.content) {
              throw new Error(readRes.error || 'Failed to read file');
            }

            // Merge metadata
            const baseMeta = existing ? (existing as any).metadata || {} : {};
            const metadata: Record<string, unknown> = {
              ...baseMeta,
              oneDriveItemId: f.id,
              itemPath: params.folderItemPath,
              syncConfigId: params.configId,
              sourceProvider: 'onedrive',
              sourceMode: 'auto',
              syncedAt: Date.now(),
              sourceModifiedAt: lastModified,
              size: f.size,
            };

            // Upload or update
            const uploadRes = await ctx.runAction!(
              internal.onedrive.uploadToStorage,
              {
                organizationId: params.organizationId,
                fileName: f.name,
                fileData:
                  typeof readRes.content === 'string'
                    ? new TextEncoder().encode(readRes.content).buffer
                    : readRes.content,
                contentType:
                  readRes.mimeType || f.mimeType || 'application/octet-stream',
                metadata,
                documentIdToUpdate: existing
                  ? (existing as any)._id
                  : undefined,
              } as any,
            );

            if (!uploadRes.success) {
              throw new Error(
                uploadRes.error || 'Failed to upload/update file',
              );
            }

            if (existing) updated++;
            else created++;
          } catch (e) {
            errors.push({
              itemId: f.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        return {
          operation: 'sync_folder_files',
          data: {
            created,
            updated,
            skipped,
            errorsCount: errors.length,
          },
          success: errors.length === 0,
          timestamp: Date.now(),
        };
      }

      case 'update_sync_config': {
        if (!params.configId) {
          throw new Error(
            'update_sync_config operation requires configId parameter',
          );
        }

        // Update OneDrive sync configuration
        await ctx.runMutation!(internal.onedrive.updateSyncConfig, {
          configId: params.configId as Id<'onedriveSyncConfigs'>,
          status: params.status,
          lastSyncAt: params.lastSyncAt,
          lastSyncStatus: params.lastSyncStatus,
          errorMessage: params.errorMessage,
        });

        return {
          operation: 'update_sync_config',
          data: {
            configId: params.configId,
            status: params.status,
          },
          success: true,
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(
          `Unsupported onedrive operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
