'use client';

import { useState } from 'react';
import { Button } from '@/app/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/layout/card';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Cloud,
  Database,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { formatFileSize } from '@/lib/utils/onedrive-helpers';
import type { SyncResult } from '@/types/onedrive-sync';

export interface FileProcessingStatus {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  size?: number;
}

interface SyncStatusProps {
  isVisible: boolean;
  isLoading: boolean;
  currentFile?: string;
  result?: SyncResult;
  onClose: () => void;
  onRetry?: () => void;
  fileStatuses?: FileProcessingStatus[];
}

function SyncStatus({
  isVisible,
  isLoading,
  currentFile,
  result,
  onClose,
  onRetry,
  fileStatuses = [],
}: SyncStatusProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');

  if (!isVisible) return null;

  const hasResult = !!result;
  const hasErrors = result && result.failedFiles.length > 0;
  const isSuccess = result && result.success;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>
            <HStack gap={2}>
              <HStack gap={2}>
                <Cloud className="size-4 text-blue-600" />
                <span>→</span>
                <Database className="size-4 text-green-600" />
              </HStack>
              {t('sync.title')}
            </HStack>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
          {/* Progress Section */}
          {isLoading && (
            <Stack gap={3}>
              <HStack gap={2}>
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">
                  {currentFile || t('sync.syncingToStorage')}
                </span>
              </HStack>
              {/* Indeterminate progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full animate-pulse"
                  style={{ width: '60%' }}
                ></div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('sync.pleaseWait')}
              </p>
            </Stack>
          )}

          {/* File Processing List */}
          {isLoading && fileStatuses.length > 0 && (
            <Stack gap={2}>
              <h4 className="text-sm font-medium">
                {t('sync.processingFiles', { count: fileStatuses.length })}
              </h4>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {fileStatuses.map((file) => (
                  <HStack
                    key={file.id}
                    gap={2}
                    className="p-2 bg-gray-50 rounded text-sm"
                  >
                    {file.status === 'pending' && (
                      <div className="size-4 rounded-full border-2 border-gray-300 flex-shrink-0"></div>
                    )}
                    {file.status === 'processing' && (
                      <Loader2 className="size-4 animate-spin text-blue-600 flex-shrink-0" />
                    )}
                    {file.status === 'completed' && (
                      <CheckCircle className="size-4 text-green-600 flex-shrink-0" />
                    )}
                    {file.status === 'failed' && (
                      <XCircle className="size-4 text-red-600 flex-shrink-0" />
                    )}
                    <FileText className="size-4 text-gray-400 flex-shrink-0" />
                    <span className="flex-1 truncate" title={file.name}>
                      {file.name}
                    </span>
                    {file.size && (
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                    )}
                    {file.error && (
                      <span
                        className="text-xs text-red-500 flex-shrink-0"
                        title={file.error}
                      >
                        {t('sync.error')}
                      </span>
                    )}
                  </HStack>
                ))}
              </div>
            </Stack>
          )}

          {/* Results Section */}
          {hasResult && (
            <Stack gap={4}>
              {/* Summary */}
              <HStack gap={4} className="p-4 bg-gray-50 rounded-lg">
                <HStack gap={2}>
                  {isSuccess ? (
                    <CheckCircle className="size-4 text-green-600" />
                  ) : (
                    <AlertCircle className="size-4 text-yellow-600" />
                  )}
                  <span className="font-medium">
                    {isSuccess
                      ? t('sync.syncCompleted')
                      : t('sync.syncCompletedWithErrors')}
                  </span>
                </HStack>
                <HStack gap={4} className="text-sm text-muted-foreground">
                  <span>{t('sync.filesProcessed', { count: result.totalFiles })}</span>
                </HStack>
              </HStack>

              {/* Success Stats */}
              {result.syncedFiles.length > 0 && (
                <Stack gap={2}>
                  <HStack gap={2}>
                    <CheckCircle className="size-4 text-green-600" />
                    <span className="font-medium text-green-700">
                      {t('sync.successfullySynced', { count: result.syncedFiles.length })}
                    </span>
                  </HStack>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {result.syncedFiles.map((file, index) => (
                      <HStack
                        key={index}
                        justify="between"
                        className="text-sm p-2 bg-green-50 rounded"
                      >
                        <HStack gap={2}>
                          <FileText className="size-3 text-green-600" />
                          <span className="truncate">{file.name}</span>
                        </HStack>
                        <Badge variant="outline" className="text-xs">
                          {formatFileSize(file.size)}
                        </Badge>
                      </HStack>
                    ))}
                  </div>
                </Stack>
              )}

              {/* Error Stats */}
              {result.failedFiles.length > 0 && (
                <Stack gap={2}>
                  <HStack gap={2}>
                    <XCircle className="size-4 text-red-600" />
                    <span className="font-medium text-red-700">
                      {t('sync.failedToSync', { count: result.failedFiles.length })}
                    </span>
                  </HStack>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {result.failedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="text-sm p-2 bg-red-50 rounded space-y-1"
                      >
                        <HStack gap={2}>
                          <FileText className="size-3 text-red-600" />
                          <span className="truncate font-medium">
                            {file.name}
                          </span>
                        </HStack>
                        <p className="text-xs text-red-600 ml-5">
                          {file.error}
                        </p>
                      </div>
                    ))}
                  </div>
                </Stack>
              )}

              {/* Storage Info */}
              <div className="p-3 bg-blue-50 rounded-lg">
                <HStack gap={2} className="mb-2">
                  <Database className="size-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-700">
                    {t('sync.storageLocation')}
                  </span>
                </HStack>
                <p className="text-xs text-blue-600">
                  {t('sync.storageDescription')}
                </p>
              </div>
            </Stack>
          )}

          {/* Error Message */}
          {result && !result.success && result.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <HStack gap={2} className="mb-1">
                <XCircle className="size-4 text-red-600" />
                <span className="text-sm font-medium text-red-700">
                  {t('sync.syncError')}
                </span>
              </HStack>
              <p className="text-xs text-red-600">{result.error}</p>
            </div>
          )}

          {/* Actions */}
          <HStack gap={2} className="pt-2">
            <Button variant="outline" onClick={onClose}>
              {tCommon('actions.close')}
            </Button>
            {hasErrors && onRetry && (
              <Button variant="default" onClick={onRetry}>
                {t('sync.retryFailedFiles')}
              </Button>
            )}
          </HStack>
          </Stack>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Hook for managing sync status state
 */
export function useSyncStatus() {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string>();
  const [result, setResult] = useState<SyncResult>();
  const [fileStatuses, setFileStatuses] = useState<FileProcessingStatus[]>([]);

  const showSync = (files?: FileProcessingStatus[]) => {
    setIsVisible(true);
    setIsLoading(true);
    setProgress(0);
    setCurrentFile(undefined);
    setResult(undefined);

    // Initialize file statuses if files are provided
    if (files) {
      setFileStatuses(files);
    } else {
      setFileStatuses([]);
    }
  };

  const updateProgress = (newProgress: number, fileName?: string) => {
    setProgress(newProgress);
    setCurrentFile(fileName);
  };

  const updateFileStatus = (
    fileId: string,
    status: FileProcessingStatus['status'],
    error?: string,
  ) => {
    setFileStatuses((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, status, error } : file,
      ),
    );
  };

  const completeSync = (syncResult: SyncResult) => {
    setIsLoading(false);
    setProgress(100);

    // If totals/files weren't provided by the caller, derive them from current file statuses
    const hasProvidedSynced = !!(
      syncResult.syncedFiles && syncResult.syncedFiles.length
    );
    const hasProvidedFailed = !!(
      syncResult.failedFiles && syncResult.failedFiles.length
    );

    const derivedSynced = fileStatuses
      .filter((f) => f.status === 'completed')
      .map((f) => ({
        name: f.name,
        oneDriveId: f.id,
        storagePath: '', // Not needed for UI display here
        size: f.size ?? 0,
      }));

    const derivedFailed = fileStatuses
      .filter((f) => f.status === 'failed')
      .map((f) => ({
        name: f.name,
        oneDriveId: f.id,
        error: f.error || 'Failed',
      }));

    const finalResult: SyncResult = {
      ...syncResult,
      syncedFiles: hasProvidedSynced ? syncResult.syncedFiles : derivedSynced,
      failedFiles: hasProvidedFailed ? syncResult.failedFiles : derivedFailed,
      totalFiles: syncResult.totalFiles || fileStatuses.length,
    };

    setResult(finalResult);
    setCurrentFile(undefined);

    // Update all file statuses based on the final result
    setFileStatuses((prev) =>
      prev.map((file) => {
        const syncedFile = finalResult.syncedFiles.find(
          (sf) => sf.oneDriveId === file.id,
        );
        const failedFile = finalResult.failedFiles.find(
          (ff) => ff.oneDriveId === file.id,
        );

        if (syncedFile) {
          return { ...file, status: 'completed' as const };
        } else if (failedFile) {
          return {
            ...file,
            status: 'failed' as const,
            error: failedFile.error,
          };
        }
        return file;
      }),
    );
  };

  const hideSync = () => {
    setIsVisible(false);
    setIsLoading(false);
    setProgress(0);
    setCurrentFile(undefined);
    setResult(undefined);
    setFileStatuses([]);
  };

  return {
    isVisible,
    isLoading,
    progress,
    currentFile,
    result,
    fileStatuses,
    showSync,
    updateProgress,
    updateFileStatus,
    completeSync,
    hideSync,
  };
}
