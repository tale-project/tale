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
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import {
	jsonRecordValidator,
	jsonValueValidator,
	type ConvexJsonRecord,
} from '../../../../lib/shared/schemas/utils/json-value';
import type {
  DocumentRecord,
  DocumentMetadata,
} from '../../../documents/types';

// Common field validators
const filesValidator = v.array(
  v.object({
    id: v.string(),
    name: v.string(),
    size: v.number(),
    mimeType: v.optional(v.string()),
    lastModified: v.optional(v.number()),
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
  | { operation: 'list_folder_contents'; itemId: string; token: string }
  | {
      operation: 'sync_folder_files';
      files: Array<{
        id: string;
        name: string;
        size: number;
        mimeType?: string;
        lastModified?: number;
      }>;
      token: string;
      folderItemPath?: string;
      configId?: string;
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
    };

export const onedriveAction: ActionDefinition<OneDriveActionParams> = {
  type: 'onedrive',
  title: 'OneDrive Operation',
  description:
    'Execute OneDrive operations (get_user_token, refresh_token, read_file, list_folder_contents, sync_folder_files, upload_to_storage, update_sync_config). organizationId is automatically read from workflow context variables.',
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
  ),
  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables
    const organizationId = variables.organizationId as string;
    switch (params.operation) {
      case 'get_user_token': {
        // Get Microsoft Graph token for the specific user
        const result = await ctx.runQuery!(
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
        const result = await ctx.runAction!(
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
        const result = await ctx.runAction!(
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
        const result = await ctx.runAction!(internal.onedrive.internal_actions.uploadToStorage, {
          organizationId,
          fileName: params.fileName, // Required by validator
          fileData:
            typeof params.fileContent === 'string'
              ? new TextEncoder().encode(params.fileContent).buffer
              : params.fileContent, // Required by validator
          contentType: params.contentType || 'application/octet-stream',
          metadata: (params.metadata || {}) as ConvexJsonRecord,
          createdBy: params.createdBy,
        });

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
        const result = await ctx.runAction!(
          internal.onedrive.internal_actions.listFolderContents,
          {
            itemId: params.itemId, // Required by validator
            token: params.token, // Required by validator
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

        // Build a map of existing documents by OneDrive item id for this org
        const existingByItemId = new Map<string, DocumentRecord>();
        let cursor: string | null = null;
        // Paginate through existing onedrive_sync documents

        while (true) {
          const res: {
            page: DocumentRecord[];
            isDone: boolean;
            continueCursor: string;
          } = await ctx.runQuery!(internal.documents.internal_queries.queryDocuments, {
            organizationId,
            sourceProvider: 'onedrive',
            paginationOpts: { numItems: 100, cursor },
          });
          for (const doc of res.page) {
            const meta = (doc.metadata ?? {}) as DocumentMetadata;
            const key =
              doc.externalItemId ??
              meta.oneDriveItemId ??
              meta.oneDriveId;
            if (key) existingByItemId.set(key, doc);
          }
          if (res.isDone) break;
          cursor = res.continueCursor || null;
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;
        const errors: Array<{ itemId: string; error: string }> = [];

        for (const f of params.files) {
          // Required by validator
          try {
            const existing = existingByItemId.get(f.id);
            const lastModified = f.lastModified;
            const existingMeta = existing
              ? ((existing.metadata ?? {}) as DocumentMetadata)
              : undefined;
            const prevModified = existingMeta?.sourceModifiedAt;

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
              internal.onedrive.internal_actions.readFileFromOneDrive,
              { itemId: f.id, token: params.token }, // Required by validator
            );
            if (!readRes.success || !readRes.content) {
              throw new Error(readRes.error || 'Failed to read file');
            }

            // Extract content after validation (TypeScript narrowing workaround)
            const fileContent = readRes.content;
            const fileMimeType = readRes.mimeType;

            // Merge metadata
            const baseMeta = existingMeta ?? {};
            const metadata = {
              ...baseMeta,
              oneDriveItemId: f.id,
              itemPath: params.folderItemPath,
              syncConfigId: params.configId,
              sourceProvider: 'onedrive',
              sourceMode: 'auto',
              syncedAt: Date.now(),
              sourceModifiedAt: lastModified,
              size: f.size,
            } as ConvexJsonRecord;

            // Upload or update
            const uploadRes = await ctx.runAction!(
              internal.onedrive.internal_actions.uploadToStorage,
              {
                organizationId,
                fileName: f.name,
                fileData: fileContent,
                contentType:
                  fileMimeType || f.mimeType || 'application/octet-stream',
                metadata,
                documentIdToUpdate: existing?._id as Id<'documents'> | undefined,
                createdBy: params.createdBy,
              },
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

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
          created,
          updated,
          skipped,
          errorsCount: errors.length,
        };
      }

      case 'update_sync_config': {
        // Update OneDrive sync configuration
        await ctx.runMutation!(internal.onedrive.internal_mutations.updateSyncConfig, {
          configId: params.configId as Id<'onedriveSyncConfigs'>, // Required by validator
          status: params.status,
          lastSyncAt: params.lastSyncAt,
          lastSyncStatus: params.lastSyncStatus,
          errorMessage: params.errorMessage,
        });

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
