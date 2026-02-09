/**
 * OneDrive Sync Workflow
 *
 * This workflow finds one active OneDrive sync configuration and syncs the file/folder
 * from OneDrive to storage using the stored user's credentials.
 *
 * Steps:
 * 1. Find one unprocessed sync configuration
 * 2. Check if a configuration was found
 * 3. If yes, get the user's Microsoft Graph token
 * 4. Check if item is a file or folder
 * 5a. If file: Read file from OneDrive -> Upload to storage
 * 5b. If folder: List folder contents -> Create sync configs for files
 * 6. Update sync configuration status
 * 7. Record as processed
 */

import type { PredefinedWorkflowDefinition } from '../workflows/definitions/types';

const onedriveSyncWorkflow: PredefinedWorkflowDefinition = {
  workflowConfig: {
    name: 'OneDrive Sync',
    description:
      'Find one active OneDrive sync configuration and sync the file/folder',
    version: '1.0.0',
    workflowType: 'predefined', // Predefined workflow - developer-defined
    config: {
      timeout: 120000, // 2 minutes for single file sync
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
        backoffHours: 1, // Only process configs not synced in last 1 hour
        workflowId: 'onedrive_sync',
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger - Manual or Scheduled
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'start',
      order: 1,
      config: {},
      nextSteps: { success: 'find_sync_config' },
    },

    // Step 2: Find One Active Sync Configuration
    {
      stepSlug: 'find_sync_config',
      name: 'Find Active Sync Configuration',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          tableName: 'onedriveSyncConfigs',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: {
        success: 'check_config_found',
      },
    },

    // Step 3: Check if Configuration Found
    {
      stepSlug: 'check_config_found',
      name: 'Check Configuration Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_sync_config.output.data != null',
        description: 'Check if any active sync configuration was found',
      },
      nextSteps: {
        true: 'get_user_token',
        false: 'noop', // No configs to process - end workflow
      },
    },

    // Step 4: Get Microsoft Graph Token for User
    {
      stepSlug: 'get_user_token',
      name: 'Get User Microsoft Graph Token',
      stepType: 'action',
      order: 4,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'get_user_token',
          userId: '{{steps.find_sync_config.output.data.userId}}',
        },
      },
      nextSteps: {
        success: 'check_token_valid',
      },
    },

    // Step 5: Check if Token is Valid or Needs Refresh
    {
      stepSlug: 'check_token_valid',
      name: 'Check Token Valid',
      stepType: 'condition',
      order: 5,
      config: {
        expression: 'steps.get_user_token.output.data.token != null',
        description: 'Check if user has valid Microsoft Graph token',
      },
      nextSteps: {
        true: 'check_item_type',
        false: 'check_needs_refresh',
      },
    },

    // Step 5a: Check if Token Needs Refresh
    {
      stepSlug: 'check_needs_refresh',
      name: 'Check Needs Refresh',
      stepType: 'condition',
      order: 6,
      config: {
        expression: 'steps.get_user_token.output.data.needsRefresh == true',
        description: 'Check if token needs refresh',
      },
      nextSteps: {
        true: 'refresh_token',
        false: 'mark_config_error',
      },
    },

    // Step 5b: Refresh Token
    {
      stepSlug: 'refresh_token',
      name: 'Refresh Microsoft Graph Token',
      stepType: 'action',
      order: 7,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'refresh_token',
          accountId: '{{steps.get_user_token.output.data.accountId}}',
          refreshToken: '{{steps.get_user_token.output.data.refreshToken}}',
        },
      },
      nextSteps: {
        success: 'check_item_type',
        failure: 'mark_config_error',
      },
    },

    // Step 6: Check if Item is File or Folder
    {
      stepSlug: 'check_item_type',
      name: 'Check Item Type',
      stepType: 'condition',
      order: 8,
      config: {
        expression: 'steps.find_sync_config.output.data.itemType == "file"',
        description: 'Check if item is a file or folder',
      },
      nextSteps: {
        true: 'read_onedrive_file',
        false: 'list_folder_contents',
      },
    },

    // Step 7a: Read File from OneDrive (for files)
    {
      stepSlug: 'read_onedrive_file',
      name: 'Read File from OneDrive',
      stepType: 'action',
      order: 9,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'read_file',
          itemId: '{{steps.find_sync_config.output.data.itemId}}',
          token:
            '{{steps.refresh_token.output.data.token || steps.get_user_token.output.data.token}}',
        },
      },
      nextSteps: {
        success: 'upload_to_storage',
        failure: 'mark_config_error',
      },
    },

    // Step 7b: List Folder Contents (for folders)
    {
      stepSlug: 'list_folder_contents',
      name: 'List Folder Contents',
      stepType: 'action',
      order: 10,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'list_folder_contents',
          itemId: '{{steps.find_sync_config.output.data.itemId}}',
          token:
            '{{steps.refresh_token.output.data.token || steps.get_user_token.output.data.token}}',
        },
      },
      nextSteps: {
        success: 'sync_folder_files',
        failure: 'mark_config_error',
      },
    },

    // Step 7c: Sync Folder Files (Upsert documents directly)
    {
      stepSlug: 'sync_folder_files',
      name: 'Sync Folder Files',
      stepType: 'action',
      order: 11,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'sync_folder_files',
          token:
            '{{steps.refresh_token.output.data.token || steps.get_user_token.output.data.token}}',
          files: '{{steps.list_folder_contents.output.data}}',
          folderItemPath: '{{steps.find_sync_config.output.data.itemPath}}',
          configId: '{{steps.find_sync_config.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'update_sync_status',
        failure: 'mark_config_error',
      },
    },

    // Step 8a: Upload File to Storage (for files)
    {
      stepSlug: 'upload_to_storage',
      name: 'Upload to Storage',
      stepType: 'action',
      order: 12,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'upload_to_storage',
          fileName: '{{steps.find_sync_config.output.data.itemName}}',
          fileContent: '{{steps.read_onedrive_file.output.data.content}}',
          contentType: '{{steps.read_onedrive_file.output.data.mimeType}}',
          storagePath:
            '{{steps.find_sync_config.output.data.storagePrefix}}/{{steps.find_sync_config.output.data.itemName}}',
          metadata: {
            oneDriveItemId: '{{steps.find_sync_config.output.data.itemId}}',
            itemPath: '{{steps.find_sync_config.output.data.itemPath}}',
            syncConfigId: '{{steps.find_sync_config.output.data._id}}',
            syncedAt: '{{now}}',
          },
        },
      },
      nextSteps: {
        success: 'update_sync_status',
        failure: 'mark_config_error',
      },
    },

    // Step 9: Update Sync Configuration Status
    {
      stepSlug: 'update_sync_status',
      name: 'Update Sync Status',
      stepType: 'action',
      order: 13,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'update_sync_config',
          configId: '{{steps.find_sync_config.output.data._id}}',
          status: 'active',
          lastSyncAt: '{{nowMs}}',
          lastSyncStatus: 'success',
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 10: Mark Configuration as Error (if token invalid or sync failed)
    {
      stepSlug: 'mark_config_error',
      name: 'Mark Configuration Error',
      stepType: 'action',
      order: 14,
      config: {
        type: 'onedrive',
        parameters: {
          operation: 'update_sync_config',
          configId: '{{steps.find_sync_config.output.data._id}}',
          status: 'error',
          lastSyncAt: '{{nowMs}}',
          lastSyncStatus: 'failed',
          errorMessage:
            'Failed to sync: Invalid token or file/folder read error',
        },
      },
      nextSteps: {
        success: 'record_processed',
      },
    },

    // Step 11: Record Configuration as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record Processed',
      stepType: 'action',
      order: 15,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          tableName: 'onedriveSyncConfigs',
          recordId: '{{steps.find_sync_config.output.data._id}}',
        },
      },
      nextSteps: {
        success: 'noop',
      },
    },
  ],
};

export default onedriveSyncWorkflow;
