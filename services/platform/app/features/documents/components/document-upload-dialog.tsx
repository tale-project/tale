'use client';

import { CircleCheck, RotateCw, Upload } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Button } from '@/app/components/ui/primitives/button';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_MAX_FILE_SIZE,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

import { useDocumentUpload } from '../hooks/mutations';
import { TeamMultiSelect } from './team-multi-select';
import { UploadFileRow } from './upload-file-row';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  folderId?: string;
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentUploadDialog({
  open,
  onOpenChange,
  organizationId,
  folderId,
  onSuccess,
}: DocumentUploadDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(() =>
    selectedTeamId ? [selectedTeamId] : [],
  );

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const {
    uploadFiles,
    retryFile,
    retryAllFailed,
    isUploading,
    trackedFiles,
    removeTrackedFile,
    clearTrackedFiles,
    cancelUpload,
    completedCount,
    failedCount,
    totalCount,
    allCompleted,
    hasFailures,
  } = useDocumentUpload({
    organizationId,
    onSuccess: () => {
      onSuccess?.();
    },
  });

  // Derived state
  const hasFiles = trackedFiles.length > 0;
  const isActive = isUploading || hasFiles;
  const totalSize = useMemo(
    () => trackedFiles.reduce((sum, f) => sum + f.file.size, 0),
    [trackedFiles],
  );

  // Handlers
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && isUploading) return; // Block close while uploading
      if (!newOpen) {
        clearTrackedFiles();
        setSelectedTeamIds(selectedTeamId ? [selectedTeamId] : []);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, isUploading, clearTrackedFiles, selectedTeamId],
  );

  const processFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
      const validFiles: File[] = [];

      for (const file of files) {
        if (file.size <= DOCUMENT_MAX_FILE_SIZE) {
          validFiles.push(file);
        } else {
          const currentSizeMB = (file.size / (1024 * 1024)).toFixed(1);
          toast({
            title: tDocuments('upload.fileTooLarge'),
            description: tDocuments('upload.fileSizeExceeded', {
              name: file.name,
              maxSize: maxSizeMB.toString(),
              currentSize: currentSizeMB,
            }),
            variant: 'destructive',
          });
        }
      }

      if (validFiles.length > 0) {
        void uploadFiles(validFiles, {
          teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
          folderId,
        });
      }
    },
    [tDocuments, uploadFiles, selectedTeamIds, folderId],
  );

  const handleTeamSelectionChange = useCallback(
    (teamIds: string[]) => {
      setSelectedTeamIds(teamIds);
      clearTrackedFiles();
    },
    [clearTrackedFiles],
  );

  const handleCancel = useCallback(() => {
    cancelUpload();
    clearTrackedFiles();
  }, [cancelUpload, clearTrackedFiles]);

  const handleRetryAll = useCallback(() => {
    void retryAllFailed({
      teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
      folderId,
    });
  }, [retryAllFailed, selectedTeamIds, folderId]);

  const handleRetryFile = useCallback(
    (fileId: string) => {
      void retryFile(fileId, {
        teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
        folderId,
      });
    },
    [retryFile, selectedTeamIds, folderId],
  );

  const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('upload.importDocuments')}
      size="md"
    >
      <div className="flex min-w-0 flex-col gap-4 pt-2">
        {/* Drop zone */}
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={processFiles}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            multiple
            disabled={isUploading}
            inputId="document-file-upload"
            className={cn(
              'relative flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/30 py-8 px-4 text-center cursor-pointer transition-colors',
              'hover:border-primary/40 hover:bg-muted/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isUploading && 'opacity-50 cursor-not-allowed',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload className="text-muted-foreground size-6" />
            <span className="text-foreground text-sm font-medium">
              {tDocuments('upload.dropZoneTitle')}
            </span>
            <span className="text-muted-foreground text-xs">
              {tDocuments('upload.dropZoneDescription', {
                maxSize: maxSizeMB.toString(),
              })}
            </span>
          </FileUpload.DropZone>
        </FileUpload.Root>

        {/* Team selection */}
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-sm font-medium">
            {tDocuments('upload.selectTeams')}
          </span>
          {isLoadingTeams ? (
            <div className="flex items-center justify-center py-3">
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </div>
          ) : (
            <TeamMultiSelect
              teams={teams ?? []}
              selectedTeamIds={selectedTeamIds}
              onSelectionChange={handleTeamSelectionChange}
              orgWideLabel={tDocuments('teamTags.orgWide')}
              disabled={isUploading}
            />
          )}
        </div>

        {/* Upload progress summary */}
        {hasFiles && totalCount > 1 && (
          <span className="text-muted-foreground text-[13px] font-medium">
            {hasFailures
              ? tDocuments('upload.filesCompletedWithFailures', {
                  completed: completedCount,
                  total: totalCount,
                  failed: failedCount,
                })
              : tDocuments('upload.filesCompletedSummary', {
                  completed: completedCount,
                  total: totalCount,
                })}
          </span>
        )}

        {/* Success banner */}
        {allCompleted && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <CircleCheck className="size-4 shrink-0 text-green-700" />
            <span className="flex-1 text-[13px] font-medium text-green-700">
              {tDocuments('upload.documentsUploadedSuccessfully', {
                count: completedCount,
              })}
            </span>
            <span className="shrink-0 text-xs text-green-600">
              {formatBytes(totalSize)}
            </span>
          </div>
        )}

        {/* File list */}
        {hasFiles && (
          <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
            {trackedFiles.map((tracked) => (
              <UploadFileRow
                key={tracked.id}
                fileName={tracked.file.name}
                fileSize={tracked.file.size}
                status={tracked.status}
                bytesLoaded={tracked.bytesLoaded}
                bytesTotal={tracked.bytesTotal}
                error={tracked.error}
                onRetry={() => handleRetryFile(tracked.id)}
                onRemove={
                  tracked.status === 'pending' || tracked.status === 'completed'
                    ? () => removeTrackedFile(tracked.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Footer actions */}
        {isActive && (
          <div className="flex items-center justify-end gap-2">
            {hasFailures && !isUploading && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                >
                  {tCommon('actions.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRetryAll}
                  className="gap-1.5"
                >
                  <RotateCw className="size-3.5" />
                  {tDocuments('upload.retryUpload')}
                </Button>
              </>
            )}
            {isUploading && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancel}
              >
                {tDocuments('upload.cancelUpload')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
