'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { RotateCw, Upload } from 'lucide-react';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  isRagIndexableFile,
  resolveFileType,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

import { useDocumentUpload } from '../hooks/mutations';
import { useFolder, useUploadUsage } from '../hooks/queries';
import {
  documentUploadAccept,
  documentUploadMaxFileSize,
  documentUploadSelectionIssueMessage,
  validateDocumentUploadSelection,
} from '../lib/document-upload-selection';
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
  const { locale, formatNumber } = useFormatNumber();
  const { selectedTeamId } = useTeamFilter();

  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(() =>
    selectedTeamId ? [selectedTeamId] : [],
  );

  const { teams, isLoading: isLoadingTeams } = useTeams();
  const policyLimits = useUploadPolicy(organizationId);
  // Proactive quota meter — only rendered when the org enforces a per-user
  // volume cap, so a full quota is visible before it rejects an upload.
  const { data: uploadUsage } = useUploadUsage(organizationId);

  // A team-scoped folder forces its team on every document created inside it
  // (the create mutation overrides teamId with the folder's). Lock the team
  // selector to that team so the UI reflects what actually happens instead of
  // implying the upload can be assigned elsewhere (#1469).
  const { data: folder } = useFolder(folderId);
  const folderTeamId = folder?.teamId ?? undefined;
  const isTeamLockedToFolder = !!folderTeamId;

  useEffect(() => {
    if (folderTeamId) {
      setSelectedTeamIds([folderTeamId]);
    }
  }, [folderTeamId]);

  const effectiveMaxFileSize = documentUploadMaxFileSize(policyLimits);
  const effectiveAccept = documentUploadAccept(
    policyLimits,
    DOCUMENT_UPLOAD_ACCEPT,
  );

  const {
    stageFiles,
    uploadFiles,
    retryFile,
    retryAllFailed,
    isUploading,
    trackedFiles,
    removeTrackedFile,
    clearTrackedFiles,
    cancelUpload,
    canCancelUpload,
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
  const hasPendingFiles = trackedFiles.some((f) => f.status === 'pending');
  const hasRetryableFailures = trackedFiles.some(
    (file) => file.status === 'failed' && file.retryable !== false,
  );
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
        setSelectedTeamIds(
          folderTeamId
            ? [folderTeamId]
            : selectedTeamId
              ? [selectedTeamId]
              : [],
        );
      }
      onOpenChange(newOpen);
    },
    [
      onOpenChange,
      isUploading,
      clearTrackedFiles,
      folderTeamId,
      selectedTeamId,
    ],
  );

  const processFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const validFiles: File[] = [];

      for (const file of files) {
        const issue = validateDocumentUploadSelection(file, policyLimits);
        if (issue) {
          const message = documentUploadSelectionIssueMessage(
            issue,
            tDocuments,
            locale,
          );
          toast({
            ...message,
            variant: 'destructive',
          });
          continue;
        }

        validFiles.push(file);
      }

      if (validFiles.length > 0) {
        stageFiles(validFiles);
      }
    },
    [tDocuments, stageFiles, policyLimits, locale],
  );

  const handleTeamSelectionChange = useCallback((teamIds: string[]) => {
    setSelectedTeamIds(teamIds);
  }, []);

  const handleCancel = useCallback(() => {
    if (cancelUpload()) clearTrackedFiles();
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

  const handleUpload = useCallback(() => {
    if (!hasPendingFiles) return;
    void uploadFiles({
      teamIds: selectedTeamIds.length > 0 ? selectedTeamIds : undefined,
      folderId,
    });
  }, [hasPendingFiles, uploadFiles, selectedTeamIds, folderId]);

  useEffect(() => {
    if (!allCompleted || completedCount === 0) return undefined;
    const timer = setTimeout(() => {
      handleOpenChange(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [allCompleted, completedCount, handleOpenChange]);

  const maxSizeMB = effectiveMaxFileSize / (1024 * 1024);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('upload.importDocuments')}
      size="md"
    >
      <Stack className="min-w-0 pt-2">
        {/* Drop zone */}
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={processFiles}
            accept={effectiveAccept}
            multiple
            disabled={isUploading || allCompleted}
            inputId="document-file-upload"
            className={cn(
              'bg-card/30 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border px-4 py-8 text-center transition-colors',
              'hover:border-primary/40 hover:bg-muted/50',
              'focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              (isUploading || allCompleted) && 'cursor-not-allowed opacity-50',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload className="text-muted-foreground size-6" />
            <span className="text-foreground text-sm font-medium">
              {tDocuments('upload.dropZoneTitle')}
            </span>
            <span className="text-muted-foreground text-xs">
              {tDocuments('upload.dropZoneDescription', {
                maxSize: formatNumber(maxSizeMB, {
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
          </FileUpload.DropZone>
        </FileUpload.Root>

        {/* Upload-quota meter (only when a per-user volume cap is enforced) */}
        {uploadUsage?.limited && uploadUsage.limitBytes != null && (
          <span className="text-muted-foreground px-1 text-xs">
            {tDocuments('upload.quotaUsage', {
              used: formatBytes(uploadUsage.usedBytes, locale),
              limit: formatBytes(uploadUsage.limitBytes, locale),
            })}
          </span>
        )}

        {/* Team selection */}
        <Stack gap={2}>
          <span className="text-muted-foreground text-sm font-medium">
            {tDocuments('upload.selectTeams')}
          </span>
          {isLoadingTeams ? (
            <Row gap={0} justify="center" className="py-3">
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </Row>
          ) : (
            <TeamMultiSelect
              teams={teams ?? []}
              selectedTeamIds={selectedTeamIds}
              onSelectionChange={handleTeamSelectionChange}
              orgWideLabel={tDocuments('teamTags.orgWide')}
              disabled={isUploading || allCompleted || isTeamLockedToFolder}
            />
          )}
          {isTeamLockedToFolder && (
            <span className="text-muted-foreground text-[13px]">
              {tDocuments('upload.teamLockedToFolder')}
            </span>
          )}
        </Stack>

        {/* Upload progress summary */}
        {hasFiles && totalCount > 1 && (
          <span className="text-muted-foreground text-[13px] font-medium">
            {hasFailures
              ? tDocuments('upload.filesCompletedWithFailures', {
                  completed: formatNumber(completedCount),
                  total: formatNumber(totalCount),
                  failed: formatNumber(failedCount),
                })
              : tDocuments('upload.filesCompletedSummary', {
                  completed: formatNumber(completedCount),
                  total: formatNumber(totalCount),
                })}
          </span>
        )}

        {/* Success banner */}
        {allCompleted && (
          <Alert
            variant="success"
            title={tDocuments('upload.documentsUploadedSuccessfully', {
              count: completedCount,
            })}
            description={formatBytes(totalSize, locale)}
          />
        )}

        {/* File list */}
        {hasFiles && (
          <Stack gap={1} className="max-h-52 overflow-y-auto">
            {trackedFiles.map((tracked) => (
              <UploadFileRow
                key={tracked.id}
                fileName={tracked.file.name}
                fileSize={tracked.file.size}
                status={tracked.status}
                bytesLoaded={tracked.bytesLoaded}
                bytesTotal={tracked.bytesTotal}
                error={tracked.error}
                notIndexable={
                  !isRagIndexableFile(
                    tracked.file.name,
                    resolveFileType(tracked.file.name, tracked.file.type),
                  )
                }
                onRetry={
                  isUploading || tracked.retryable === false
                    ? undefined
                    : () => handleRetryFile(tracked.id)
                }
                onRemove={
                  tracked.status === 'pending' || tracked.status === 'completed'
                    ? () => removeTrackedFile(tracked.id)
                    : undefined
                }
              />
            ))}
          </Stack>
        )}

        {/* Footer actions */}
        <Row gap={2} justify="end">
          {hasRetryableFailures && !isUploading && !hasPendingFiles && (
            <Button type="button" onClick={handleRetryAll} className="gap-1.5">
              <RotateCw className="size-3.5" />
              {tDocuments('upload.retryUpload')}
            </Button>
          )}
          {isUploading && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={!canCancelUpload}
            >
              {tDocuments('upload.cancelUpload')}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleUpload}
            disabled={!hasPendingFiles || isUploading || allCompleted}
          >
            {tDocuments('upload.uploadDocuments')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
