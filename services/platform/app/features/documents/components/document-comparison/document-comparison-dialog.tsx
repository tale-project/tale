'use client';

import { ArrowRightLeft } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { resolveFileType } from '@/lib/shared/file-types';

import { useDocuments } from '../../hooks/queries';
import { useDocumentComparison } from '../../hooks/use-document-comparison';
import {
  ComparisonFileSelector,
  type SelectedFile,
} from './comparison-file-selector';
import { ComparisonResults } from './comparison-results';

interface DocumentComparisonDialogContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

function DocumentComparisonDialogContent({
  open,
  onOpenChange,
  organizationId,
}: DocumentComparisonDialogContentProps) {
  const { t } = useT('documents');

  const [baseFile, setBaseFile] = useState<SelectedFile | null>(null);
  const [comparisonFile, setComparisonFile] = useState<SelectedFile | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);

  const { documents } = useDocuments(organizationId);
  const { compare, result, error, isPending, reset } = useDocumentComparison({
    organizationId,
  });
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );

  const existingDocuments = documents
    .filter((d) => d.type === 'file' && d.url)
    .map((d) => ({
      id: d.id,
      name: d.name,
      fileId: d.id.includes('/') ? undefined : d.url?.split('/').pop(),
    }));

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setBaseFile(null);
        setComparisonFile(null);
        reset();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, reset],
  );

  const uploadFileToStorage = useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl({});
      const resolvedType =
        resolveFileType(file.name, file.type) || 'application/octet-stream';

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': resolvedType },
        body: file,
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }

      const json: { storageId: string } = await response.json();
      return json.storageId;
    },
    [generateUploadUrl],
  );

  const resolveStorageId = useCallback(
    async (selected: SelectedFile): Promise<string> => {
      if (selected.type === 'existing' && selected.storageId) {
        return selected.storageId;
      }
      if (selected.type === 'upload' && selected.file) {
        return await uploadFileToStorage(selected.file);
      }
      throw new Error('Invalid file selection');
    },
    [uploadFileToStorage],
  );

  const handleCompare = useCallback(async () => {
    if (!baseFile || !comparisonFile) return;

    setIsUploading(true);
    try {
      const [baseStorageId, comparisonStorageId] = await Promise.all([
        resolveStorageId(baseFile),
        resolveStorageId(comparisonFile),
      ]);

      await compare({
        baseStorageId,
        baseFileName: baseFile.fileName,
        comparisonStorageId,
        comparisonFileName: comparisonFile.fileName,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('comparison.compareFailed');
      toast({
        title: t('comparison.compareFailed'),
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  }, [baseFile, comparisonFile, resolveStorageId, compare, t]);

  const canCompare = baseFile && comparisonFile && !isPending && !isUploading;
  const isRunning = isPending || isUploading;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('comparison.title')}
      description={t('comparison.description')}
      size="wide"
    >
      <div className="flex min-w-0 flex-col gap-4 pt-2">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ComparisonFileSelector
            label={t('comparison.baseDocument')}
            selectedFile={baseFile}
            onFileSelected={setBaseFile}
            existingDocuments={existingDocuments}
            disabled={isRunning}
            inputId="comparison-base-upload"
          />
          <ComparisonFileSelector
            label={t('comparison.comparisonDocument')}
            selectedFile={comparisonFile}
            onFileSelected={setComparisonFile}
            existingDocuments={existingDocuments}
            disabled={isRunning}
            inputId="comparison-target-upload"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {error && (
            <Text variant="error" className="flex-1 text-sm">
              {error}
            </Text>
          )}
          <Button
            type="button"
            onClick={handleCompare}
            disabled={!canCompare}
            isLoading={isRunning}
            icon={ArrowRightLeft}
          >
            {t('comparison.compareButton')}
          </Button>
        </div>

        {isRunning && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" label={t('comparison.comparing')} />
          </div>
        )}

        {result && <ComparisonResults result={result} />}
      </div>
    </Dialog>
  );
}

export interface DocumentComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function DocumentComparisonDialog(props: DocumentComparisonDialogProps) {
  if (!props.open) return null;
  return <DocumentComparisonDialogContent {...props} />;
}
