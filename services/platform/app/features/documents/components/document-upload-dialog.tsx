'use client';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { Users, Upload, X, FileText } from 'lucide-react';
import { useState, useCallback } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_MAX_FILE_SIZE,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

import { useDocumentUpload } from '../hooks/use-document-upload';

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: DocumentUploadDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() =>
    selectedTeamId ? new Set([selectedTeamId]) : new Set(),
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Fetch user's teams via Convex query
  const { data: teamsResult, isLoading: isLoadingTeams } = useQuery(
    convexQuery(
      api.members.queries.getMyTeams,
      open ? { organizationId } : 'skip',
    ),
  );
  const teams = teamsResult?.teams ?? null;

  const { uploadFiles, isUploading } = useDocumentUpload({
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
        setSelectedTeams(
          selectedTeamId ? new Set([selectedTeamId]) : new Set(),
        );
        setSelectedFiles([]);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, selectedTeamId],
  );

  const handleToggleTeam = useCallback((teamId: string) => {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
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

      const teamTags =
        selectedTeams.size > 0 ? Array.from(selectedTeams) : undefined;
      await uploadFiles(selectedFiles, { teamTags });
    },
    [selectedFiles, selectedTeams, uploadFiles],
  );

  const hasFiles = selectedFiles.length > 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('upload.importDocuments')}
      submitText={tCommon('actions.upload')}
      submittingText={tDocuments('upload.uploading')}
      isSubmitting={isUploading}
      onSubmit={handleSubmit}
      submitDisabled={!hasFiles}
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
            <p className="text-sm font-medium">
              {tCommon('upload.clickToUpload')}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {tDocuments('upload.fromComputerDescription')}
            </p>
          </FileUpload.DropZone>
        </FileUpload.Root>

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {tDocuments('upload.uploadingCount', {
                count: selectedFiles.length,
              })}
            </p>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="bg-muted/50 flex items-start gap-2 rounded-md p-2"
                >
                  <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-sm wrap-anywhere">
                    {file.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs leading-6 whitespace-nowrap">
                    {formatBytes(file.size)}
                  </span>
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
            </div>
          </div>
        )}

        {/* Team selection */}
        <div>
          <p className="mb-2 text-sm font-medium">
            {tDocuments('upload.selectTeams')}
          </p>
          <p className="text-muted-foreground mb-3 text-xs">
            {tDocuments('upload.selectTeamsDescription')}
          </p>

          {isLoadingTeams ? (
            <div className="flex items-center justify-center py-4">
              <span className="text-muted-foreground text-sm">
                {tCommon('actions.loading')}
              </span>
            </div>
          ) : !teams || teams.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <Users className="text-muted-foreground/50 mb-2 size-6" />
              <p className="text-muted-foreground text-sm">
                {tDocuments('upload.noTeamsAvailable')}
              </p>
            </div>
          ) : (
            <Stack gap={2}>
              {teams.map((team: { id: string; name: string }) => (
                <div
                  key={team.id}
                  className="bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                >
                  <Checkbox
                    id={`upload-team-${team.id}`}
                    checked={selectedTeams.has(team.id)}
                    onCheckedChange={() => handleToggleTeam(team.id)}
                    disabled={isUploading}
                    label={team.name}
                  />
                </div>
              ))}
            </Stack>
          )}

          <p className="text-muted-foreground mt-3 text-xs">
            {tDocuments('upload.allMembersHint')}
          </p>
        </div>
      </Stack>
    </FormDialog>
  );
}
