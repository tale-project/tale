'use client';

import { FileText, Upload, X } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  DOCUMENT_MAX_FILE_SIZE,
  isAllowedDocumentUpload,
  resolveFileType,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

export interface SelectedFile {
  type: 'upload' | 'existing';
  file?: File;
  storageId?: string;
  fileName: string;
}

interface ExistingDocument {
  id: string;
  name?: string;
  fileId?: string;
}

interface ComparisonFileSelectorProps {
  label: string;
  selectedFile: SelectedFile | null;
  onFileSelected: (file: SelectedFile | null) => void;
  existingDocuments: ExistingDocument[];
  disabled?: boolean;
  inputId: string;
}

export function ComparisonFileSelector({
  label,
  selectedFile,
  onFileSelected,
  existingDocuments,
  disabled,
  inputId,
}: ComparisonFileSelectorProps) {
  const { t } = useT('documents');
  const [activeTab, setActiveTab] = useState('upload');

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const resolved = resolveFileType(file.name, file.type);
      if (!isAllowedDocumentUpload(resolved, file.name)) {
        return;
      }

      if (file.size > DOCUMENT_MAX_FILE_SIZE) {
        return;
      }

      onFileSelected({
        type: 'upload',
        file,
        fileName: file.name,
      });
    },
    [onFileSelected],
  );

  const handleExistingSelected = useCallback(
    (documentId: string) => {
      const doc = existingDocuments.find((d) => d.id === documentId);
      if (!doc?.fileId) return;

      onFileSelected({
        type: 'existing',
        storageId: doc.fileId,
        fileName: doc.name ?? t('comparison.untitledDocument'),
      });
    },
    [existingDocuments, onFileSelected, t],
  );

  const handleClear = useCallback(() => {
    onFileSelected(null);
  }, [onFileSelected]);

  const existingOptions = useMemo(
    () =>
      existingDocuments
        .filter((d) => d.fileId)
        .map((d) => ({
          value: d.id,
          label: d.name ?? t('comparison.untitledDocument'),
        })),
    [existingDocuments, t],
  );

  const selectedExistingId = useMemo(() => {
    if (selectedFile?.type !== 'existing') return null;
    return (
      existingDocuments.find((d) => d.fileId === selectedFile.storageId)?.id ??
      null
    );
  }, [selectedFile, existingDocuments]);

  const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);

  const tabItems = useMemo(
    () => [
      { value: 'upload', label: t('comparison.upload') },
      { value: 'existing', label: t('comparison.existing') },
    ],
    [t],
  );

  if (selectedFile) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="bg-muted/30 flex items-center gap-2 rounded-lg border px-3 py-2">
          <FileText
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {selectedFile.fileName}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={disabled}
            aria-label={t('comparison.clearSelection')}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Tabs items={tabItems} value={activeTab} onValueChange={setActiveTab} />

      {activeTab === 'upload' && (
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={handleFilesSelected}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            disabled={disabled}
            inputId={inputId}
            className={cn(
              'relative flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/30 py-6 px-4 text-center cursor-pointer transition-colors',
              'hover:border-primary/40 hover:bg-muted/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload
              className="text-muted-foreground size-5"
              aria-hidden="true"
            />
            <span className="text-foreground text-sm font-medium">
              {t('comparison.dropOrClick')}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('upload.dropZoneDescription', {
                maxSize: maxSizeMB.toString(),
              })}
            </span>
          </FileUpload.DropZone>
        </FileUpload.Root>
      )}

      {activeTab === 'existing' && (
        <SearchableSelect
          value={selectedExistingId}
          onValueChange={handleExistingSelected}
          options={existingOptions}
          trigger={
            <button
              type="button"
              className={cn(
                'flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm transition-colors',
                'hover:border-primary/40 hover:bg-muted/50',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
              disabled={disabled}
            >
              <span className="text-muted-foreground">
                {t('comparison.selectDocument')}
              </span>
            </button>
          }
          searchPlaceholder={t('searchPlaceholder')}
          emptyText={t('noItemsFound')}
          aria-label={label}
        />
      )}
    </div>
  );
}
