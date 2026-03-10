'use client';

import { Users, Upload, X, FileText } from 'lucide-react';
import { useState, useCallback } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { EmptyPlaceholder } from '@/app/components/ui/feedback/empty-placeholder';
import { ProgressBar } from '@/app/components/ui/feedback/progress-bar';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Description } from '@/app/components/ui/forms/description';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Select } from '@/app/components/ui/forms/select';
import { Center, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  folderId?: string;
  onSuccess?: () => void;
}

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

  const [selectedTeamId_local, setSelectedTeamId_local] = useState<
    string | undefined
  >(() => selectedTeamId ?? undefined);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const { uploadFiles, isUploading, uploadProgress } = useDocumentUpload({
    organizationId,
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
  });

  // Reset state when dialog closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedTeamId_local(selectedTeamId ?? undefined);
        setSelectedFiles([]);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, selectedTeamId],
  );

  const handleSelectTeam = useCallback((teamId: string | undefined) => {
    setSelectedTeamId_local(teamId);
  }, []);

  const processFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
      const validFiles: File[] = [];
      const rejectedFiles: File[] = [];

      for (const file of files) {
        if (file.size <= DOCUMENT_MAX_FILE_SIZE) {
          validFiles.push(file);
        } else {
          rejectedFiles.push(file);
        }
      }

      if (rejectedFiles.length > 0) {
        for (const file of rejectedFiles) {
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

      setSelectedFiles((prev) => [...prev, ...validFiles]);
    },
    [tDocuments],
  );

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (selectedFiles.length === 0) return;

      await uploadFiles(selectedFiles, {
        teamId: selectedTeamId_local,
        folderId,
      });
    },
    [selectedFiles, selectedTeamId_local, folderId, uploadFiles],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('upload.importDocuments')}
      submitText={tCommon('actions.upload')}
      submittingText={tDocuments('upload.uploading')}
      isSubmitting={isUploading}
      isDirty={selectedFiles.length > 0}
      onSubmit={handleSubmit}
      large
    >
      <Stack gap={4}>
        {/* File selection area */}
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={processFiles}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            multiple
            disabled={isUploading}
            inputId="document-file-upload"
            className={cn(
              'relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
              'hover:border-primary hover:bg-accent/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isUploading && 'opacity-50 cursor-not-allowed',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload className="text-muted-foreground mx-auto mb-2 size-8" />
            <Text variant="label">{tCommon('upload.clickToUpload')}</Text>
            <Text variant="caption" className="mt-1">
              {tDocuments('upload.fromComputerDescription')}
            </Text>
          </FileUpload.DropZone>
        </FileUpload.Root>

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <Stack gap={2}>
            <Text variant="label">
              {tDocuments('upload.uploadingCount', {
                count: selectedFiles.length,
              })}
            </Text>
            <Stack gap={1} className="max-h-32 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="bg-muted/50 flex items-start gap-2 rounded-md p-2"
                >
                  <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <Text
                    as="span"
                    variant="body"
                    className="min-w-0 flex-1 wrap-anywhere"
                  >
                    {file.name}
                  </Text>
                  <Text
                    as="span"
                    variant="caption"
                    className="shrink-0 leading-6 whitespace-nowrap"
                  >
                    {formatBytes(file.size)}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-6 shrink-0 p-0"
                    onClick={() => handleRemoveFile(index)}
                    disabled={isUploading}
                  >
                    <X className="size-3" />
                    <span className="sr-only">{tCommon('actions.delete')}</span>
                  </Button>
                </div>
              ))}
            </Stack>
          </Stack>
        )}

        {/* Upload progress */}
        {isUploading && uploadProgress && (
          <Stack gap={1}>
            <ProgressBar
              value={uploadProgress.bytesLoaded}
              max={uploadProgress.bytesTotal}
              label={tDocuments('upload.uploading')}
              tooltipContent={`${uploadProgress.completedFiles} / ${uploadProgress.totalFiles} ${tDocuments('upload.filesCompleted')}`}
            />
            <Text
              variant="caption"
              className="text-muted-foreground"
              aria-live="polite"
            >
              {formatBytes(uploadProgress.bytesLoaded)} /{' '}
              {formatBytes(uploadProgress.bytesTotal)}
              {uploadProgress.totalFiles > 1 &&
                ` · ${uploadProgress.completedFiles} / ${uploadProgress.totalFiles} ${tDocuments('upload.filesCompleted')}`}
            </Text>
          </Stack>
        )}

        {/* Team selection */}
        <FormSection
          label={tDocuments('upload.selectTeams')}
          description={tDocuments('upload.selectTeamsDescription')}
        >
          {isLoadingTeams ? (
            <Center className="py-4">
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </Center>
          ) : !teams || teams.length === 0 ? (
            <EmptyPlaceholder icon={Users}>
              {tDocuments('upload.noTeamsAvailable')}
            </EmptyPlaceholder>
          ) : (
            <Select
              value={selectedTeamId_local ?? 'org-wide'}
              onValueChange={(value) =>
                handleSelectTeam(value === 'org-wide' ? undefined : value)
              }
              disabled={isUploading}
              options={[
                {
                  value: 'org-wide',
                  label: tDocuments('teamTags.orgWide'),
                },
                ...teams.map((team: { id: string; name: string }) => ({
                  value: team.id,
                  label: team.name,
                })),
              ]}
            />
          )}

          <Description>{tDocuments('upload.allMembersHint')}</Description>
        </FormSection>
      </Stack>
    </FormDialog>
  );
}
