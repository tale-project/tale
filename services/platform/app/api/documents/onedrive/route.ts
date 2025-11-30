import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/auth-server';
import { Logger } from '@/lib/logger';
import { readOneDriveFile } from '@/actions/onedrive/read-file';
import { uploadFileToStorage } from '@/actions/storage/upload-file';
import type { DriveItem } from '@/types/microsoft-graph';
import { isFile, sanitizeStoragePath } from '@/lib/utils/onedrive-helpers';
import { enableAutoSync } from '@/actions/onedrive/config/enable-auto-sync';

interface SyncRequestItem {
  id: string;
  name: string;
  size?: number;
  relativePath?: string;
  isDirectlySelected?: boolean;
  selectedParentId?: string;
  selectedParentName?: string;
  selectedParentPath?: string;
}

type ImportType = 'one-time' | 'sync';

const logger = new Logger('documents-onedrive-stream');

/**
 * Import/sync a single file from OneDrive to storage
 */
async function importSingleFile(
  file: DriveItem,
  folderPrefix: string,
  importType: ImportType,
  relativePath?: string,
  user?: { id: string; email?: string | null },
  isDirectlySelected?: boolean,
  selectedParentId?: string,
  selectedParentName?: string,
  selectedParentPath?: string,
  syncConfigId?: string,
): Promise<{
  success: boolean;
  error?: string;
  fileInfo?: {
    name: string;
    oneDriveId: string;
    storagePath: string;
    size: number;
  };
}> {
  try {
    // Read file content from OneDrive
    const readResult = await readOneDriveFile(file.id, { asText: false });

    if (!readResult.success || !readResult.data) {
      return {
        success: false,
        error: readResult.error || 'Failed to read file from OneDrive',
      };
    }

    // Prepare storage path with directory structure preservation
    let rawStoragePath: string;
    if (relativePath) {
      // Use the relative path to preserve directory structure
      rawStoragePath = folderPrefix
        ? `${folderPrefix}/${relativePath}/${file.name}`
        : `${relativePath}/${file.name}`;
    } else {
      // Fallback to flat structure
      rawStoragePath = folderPrefix
        ? `${folderPrefix}/${file.name}`
        : file.name;
    }

    const storagePath = sanitizeStoragePath(rawStoragePath);

    logger.info('Processing file for import', {
      fileName: file.name,
      importType,
      relativePath,
      rawPath: rawStoragePath,
      sanitizedPath: storagePath,
      fileSize: file.size,
    });

    // Enhanced metadata with import information
    const metadata = {
      oneDriveId: file.id,
      oneDriveName: file.name,
      oneDriveSize: file.size,
      size: file.size,
      oneDriveModified: file.lastModifiedDateTime,
      importedAt: new Date().toISOString(),
      sourceProvider: 'onedrive',
      sourceMode: importType === 'sync' ? 'auto' : 'manual',
      syncType: isDirectlySelected ? 'direct' : 'folder',
      isDirectlySelected: isDirectlySelected ?? false,
      // Save the relative folder path from OneDrive
      folderPath: relativePath || '/',
      ...(user?.email && { uploadedByEmail: user.email }),
      // Include sync config ID for reliable tracking (when available)
      ...(syncConfigId && { syncConfigId }),
      // Include selected parent directory information for files from folders - use folder* field names
      ...(selectedParentId && {
        folderId: selectedParentId,
        folderName: selectedParentName,
        folderPath: selectedParentPath,
      }),
    };

    // Upload to Convex storage via documents.uploadFile
    const uploadResult = await uploadFileToStorage({
      filePath: storagePath,
      fileBuffer: readResult.data.content as ArrayBuffer,
      contentType: readResult.data.mimeType,
      metadata,
    });

    if (!uploadResult.success) {
      return {
        success: false,
        error: uploadResult.error,
      };
    }

    return {
      success: true,
      fileInfo: {
        name: file.name,
        oneDriveId: file.id,
        storagePath: uploadResult.filePath!,
        size: file.size || 0,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const {
      items,
      organizationId,
      importType = 'one-time',
    }: {
      items: SyncRequestItem[];
      organizationId: string;
      importType?: ImportType;
    } = body;

    // Get the abort signal from the request
    const abortSignal = request.signal;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response('No items provided for import', { status: 400 });
    }

    if (!organizationId) {
      return new Response('Business ID is required', { status: 400 });
    }

    // Validate import type
    if (!['one-time', 'sync'].includes(importType)) {
      return new Response('Invalid import type', { status: 400 });
    }

    // Store all imported files under a stable business-scoped prefix
    // Path format: {organizationId}/onedrive/<relativePath>/<file>
    const folderPrefix = `${organizationId}/onedrive`;

    // Ensure user is authenticated
    const user = await getCurrentUser();
    if (!user) {
      return new Response('Authentication required', { status: 401 });
    }

    // Ensure the specified bucket exists
    logger.info('Creating/ensuring documents bucket exists', {
      organizationId,
      importType,
      userId: user._id,
    });

    // Bucket creation responsibility moved to client flows; assuming bucket exists.

    logger.info('Documents storage ready for import', {
      itemsCount: items.length,
      importType,
    });

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        // Helper function to safely send events
        const safeSendEvent = (event: string, data: unknown) => {
          // If client aborted, don't attempt to send any more events
          if (abortSignal.aborted) return;
          try {
            sendEvent(controller, event, data);
          } catch {
            // Controller may already be closed; ignore silently as this is expected on abort
          }
        };

        // Helper function to safely close controller
        const safeCloseController = () => {
          try {
            controller.close();
          } catch {
            // Controller may already be closed; ignore silently as this is expected on abort
          }
        };

        try {
          // Send initial progress
          safeSendEvent('progress', {
            progress: 0,
            currentFile: `Starting ${importType === 'one-time' ? 'import' : 'sync'}...`,
            files: items.map(
              (item: { id: string; name: string; size?: number }) => ({
                id: item.id,
                name: item.name,
                status: 'pending',
              }),
            ),
            stats: {
              total: items.length,
              completed: 0,
              failed: 0,
              processing: 0,
              pending: items.length,
            },
          });

          let completedCount = 0;
          let failedCount = 0;
          const enabledFolders = new Set<string>();
          const enabledFiles = new Set<string>();
          const syncConfigMap = new Map<string, string>(); // itemId -> configId

          // Pre-create sync configurations for sync imports to get configIds first
          if (importType === 'sync') {
            for (const item of items) {
              try {
                if (item.isDirectlySelected) {
                  // File-level auto-sync
                  if (!enabledFiles.has(item.id)) {
                    const result = await enableAutoSync(organizationId, {
                      itemType: 'file',
                      fileId: item.id,
                      fileName: item.name,
                      filePath: item.relativePath
                        ? `${item.relativePath}/${item.name}`
                        : item.name,
                      // targetBucket kept in sync config metadata for potential future use
                      targetBucket: 'documents',
                    });
                    if (result.success && result.data?.id) {
                      syncConfigMap.set(item.id, result.data.id);
                      enabledFiles.add(item.id);
                    }
                  }
                } else if (
                  item.selectedParentId &&
                  !enabledFolders.has(item.selectedParentId)
                ) {
                  // Folder-level auto-sync (preferred)
                  const result = await enableAutoSync(organizationId, {
                    itemType: 'folder',
                    folderId: item.selectedParentId,
                    folderName: item.selectedParentName || 'OneDrive Folder',
                    folderPath: item.relativePath || '/',
                    // targetBucket kept in sync config metadata for potential future use
                    targetBucket: 'documents',
                  });
                  if (result.success && result.data?.id) {
                    // Map all files from this folder to the same config
                    items
                      .filter(
                        (f) => f.selectedParentId === item.selectedParentId,
                      )
                      .forEach((f) => syncConfigMap.set(f.id, result.data!.id));
                    enabledFolders.add(item.selectedParentId);
                  }
                }
              } catch (e) {
                logger.warn('Failed to pre-create sync config', {
                  organizationId,
                  itemId: item.id,
                  error: e instanceof Error ? e.message : 'Unknown error',
                });
              }
            }
          }

          // Process files one by one
          for (let i = 0; i < items.length; i++) {
            // Check if the request has been aborted
            if (abortSignal.aborted) {
              logger.info('Import cancelled by client', {
                importType,
                processedFiles: i,
                totalFiles: items.length,
              });

              safeSendEvent('cancelled', {
                success: false,
                error: `${importType === 'one-time' ? 'Import' : 'Sync'} cancelled by user`,
                processedFiles: i,
                totalFiles: items.length,
              });

              safeCloseController();
              return;
            }

            const item = items[i];

            try {
              // Send file processing status
              safeSendEvent('file-status', {
                fileId: item.id,
                status: 'processing',
              });

              // Send progress update
              safeSendEvent('progress', {
                progress: Math.round((i / items.length) * 100),
                currentFile: item.name,
                files: items.map(
                  (
                    fileItem: {
                      id: string;
                      name: string;
                      size?: number;
                      relativePath?: string;
                    },
                    index: number,
                  ) => ({
                    id: fileItem.id,
                    name: fileItem.name,
                    status:
                      index < i
                        ? 'completed'
                        : index === i
                          ? 'processing'
                          : 'pending',
                  }),
                ),
                stats: {
                  total: items.length,
                  completed: completedCount,
                  failed: failedCount,
                  processing: 1,
                  pending: items.length - i - 1,
                },
              });

              // Convert to DriveItem format
              const driveItem = {
                id: item.id,
                name: item.name,
                size: item.size,
                '@odata.type': '#microsoft.graph.driveItem' as const,
                createdDateTime: new Date().toISOString(),
                lastModifiedDateTime: new Date().toISOString(),
                webUrl: '',
                parentReference: {
                  driveId: '',
                  driveType: 'personal',
                  id: '',
                  path: '',
                },
                file:
                  item.size !== undefined
                    ? { mimeType: 'application/octet-stream' }
                    : undefined,
                folder: item.size === undefined ? { childCount: 0 } : undefined,
              };

              // Only import files, not folders
              if (isFile(driveItem)) {
                // Import individual file with path preservation and parent tracking
                const result = await importSingleFile(
                  driveItem,
                  folderPrefix || '',
                  importType,
                  item.relativePath,
                  user._id ? { id: user._id, email: user.email } : undefined,
                  item.isDirectlySelected,
                  item.selectedParentId,
                  item.selectedParentName,
                  item.selectedParentPath,
                  syncConfigMap.get(item.id), // Pass syncConfigId if available
                );

                if (result.success) {
                  completedCount++;
                  // Send file completion status
                  safeSendEvent('file-status', {
                    fileId: item.id,
                    status: 'completed',
                  });
                } else {
                  failedCount++;
                  // Send file failure status
                  safeSendEvent('file-status', {
                    fileId: item.id,
                    status: 'failed',
                    error: result.error || 'Unknown error',
                  });
                }
              } else {
                logger.info('Skipping folder', {
                  folderName: item.name,
                  folderId: item.id,
                });
                safeSendEvent('file-status', {
                  fileId: item.id,
                  status: 'completed',
                });
                completedCount++;
              }
            } catch (error) {
              failedCount++;
              const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
              safeSendEvent('file-status', {
                fileId: item.id,
                status: 'failed',
                error: errorMessage,
              });
            }
          }

          // Send final completion
          safeSendEvent('complete', {
            success: true,
            progress: 100,
          });

          safeCloseController();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          // Check if error is due to abort
          if (abortSignal.aborted) {
            logger.info('Import cancelled during processing', {
              importType,
              error: errorMessage,
            });
            safeSendEvent('cancelled', {
              success: false,
              error: `${importType === 'one-time' ? 'Import' : 'Sync'} cancelled by user`,
            });
          } else {
            safeSendEvent('error', {
              success: false,
              error: errorMessage,
            });
          }
          safeCloseController();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });
  } catch (error) {
    console.error('Import stream error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController,
  event: string,
  data: unknown,
): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(message));
}
