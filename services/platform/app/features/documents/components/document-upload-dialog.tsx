'use client';

import { useState, useCallback, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQuery } from 'convex/react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Stack } from '@/app/components/ui/layout/layout';
import { Users, Upload, X, FileText } from 'lucide-react';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { api } from '@/convex/_generated/api';
import { useDocumentUpload, MAX_FILE_SIZE_BYTES } from '../hooks/use-document-upload';
import { cn } from '@/lib/utils/cn';
import { toast } from '@/app/hooks/use-toast';

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

  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch user's teams via Convex query
  const teamsResult = useQuery(
    api.member.getMyTeams,
    open ? { organizationId } : 'skip',
  );
  const teams = teamsResult?.teams ?? null;
  const isLoadingTeams = teamsResult === undefined;

  const { uploadFiles, isUploading } = useDocumentUpload({
    organizationId,
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
  });

  // Reset state when dialog closes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setSelectedTeams(new Set());
      setSelectedFiles([]);
    }
    onOpenChange(newOpen);
  }, [onOpenChange]);

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

  const handleFileSelect = useCallback((e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !isUploading) {
      event.preventDefault();
      handleFileSelect();
    }
  }, [handleFileSelect, isUploading]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Filter out files that are too large and notify user
    const maxSizeMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
    const validFiles: File[] = [];
    const rejectedFiles: File[] = [];

    for (const file of files) {
      if (file.size <= MAX_FILE_SIZE_BYTES) {
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

    // Reset the input
    if (event.target) {
      event.target.value = '';
    }
  }, [tDocuments]);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedFiles.length === 0) return;

    const teamTags = selectedTeams.size > 0 ? Array.from(selectedTeams) : undefined;
    await uploadFiles(selectedFiles, { teamTags });
  }, [selectedFiles, selectedTeams, uploadFiles]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
        <div>
          <div
            role="button"
            tabIndex={isUploading ? -1 : 0}
            aria-disabled={isUploading}
            className={cn(
              'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
              'hover:border-primary hover:bg-accent/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isUploading && 'opacity-50 cursor-not-allowed',
            )}
            onClick={!isUploading ? (e) => handleFileSelect(e) : undefined}
            onKeyDown={handleKeyDown}
          >
            <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">{tCommon('upload.clickToUpload')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tDocuments('upload.fromComputerDescription')}
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={isUploading}
            accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Selected files list */}
        {selectedFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {tDocuments('upload.uploadingCount', { count: selectedFiles.length })}
            </p>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {selectedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
                >
                  <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-sm break-words flex-1 min-w-0">{file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {formatFileSize(file.size)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 shrink-0"
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
          <p className="text-sm font-medium mb-2">
            {tDocuments('upload.selectTeams')}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
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
              <Users className="size-6 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {tDocuments('upload.noTeamsAvailable')}
              </p>
            </div>
          ) : (
            <Stack gap={2}>
              {teams.map((team: { id: string; name: string }) => (
                <div
                  key={team.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
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

          <p className="text-xs text-muted-foreground mt-3">
            {tDocuments('upload.allMembersHint')}
          </p>
        </div>
      </Stack>
    </FormDialog>
  );
}
