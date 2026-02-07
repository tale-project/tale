'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { HStack } from '@/app/components/ui/layout/layout';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Download, X, Loader2 } from 'lucide-react';
import { Separator } from '@/app/components/ui/layout/separator';
import { DocumentPreview } from './document-preview';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  storagePath?: string;
  documentId?: string;
  fileName?: string;
}

const extractNameFromStoragePath = (storagePath: string) => {
  const parts = storagePath.split('/');
  return parts[parts.length - 1];
};

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  organizationId,
  storagePath,
  documentId,
  fileName,
}: DocumentPreviewDialogProps) {
  const { t } = useT('documents');
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  // Use documentId if available, otherwise use storagePath
  const dataById = useQuery(
    api.documents.queries.getDocumentById,
    open && Boolean(documentId)
      ? {
          documentId: documentId as Id<'documents'>,
        }
      : 'skip',
  );

  const dataByPath = useQuery(
    api.documents.queries.getDocumentByPath,
    open && Boolean(storagePath) && !documentId
      ? {
          organizationId: organizationId as string,
          storagePath: storagePath!,
        }
      : 'skip',
  );

  // Use whichever data source is available
  const data = documentId ? dataById : dataByPath;

  const isLoading = data === undefined;
  const isError = data?.success === false;
  const queryError =
    isError && 'error' in data
      ? new Error(data.error || t('preview.unknownError'))
      : null;
  const doc = data?.success && 'item' in data ? data.item : undefined;

  // Determine display name
  const displayName =
    fileName ||
    doc?.name ||
    (storagePath
      ? extractNameFromStoragePath(storagePath)
      : t('preview.document'));

  const handleDownload = async () => {
    if (!doc?.url) return;

    try {
      setIsDownloading(true);

      // Fetch the file as a blob to bypass CORS restrictions
      const response = await fetch(doc.url);
      if (!response.ok) throw new Error(t('preview.downloadFailed'));

      const blob = await response.blob();

      // Create a blob URL and trigger download with proper filename
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = displayName;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast({
        title: t('preview.downloadComplete'),
        description: t('preview.downloadedSuccessfully', {
          filename: displayName,
        }),
        variant: 'success',
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: t('preview.failedToLoad'),
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={displayName}
      size="wide"
      hideClose
      className="h-[85vh] p-0 sm:p-0 overflow-hidden flex flex-col"
      customHeader={
        <div className="flex flex-row items-center justify-between p-5 border-b max-h-[4.5rem]">
          <HStack gap={3} className="min-w-0">
            <div className="shrink-0">
              <DocumentIcon fileName={displayName} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-none tracking-tight truncate">
                {displayName}
              </h2>
            </div>
          </HStack>

          <HStack gap={2}>
            {doc?.url && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownload}
                disabled={isDownloading}
                aria-label={t('preview.downloadFile')}
              >
                {isDownloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
            )}
            <Separator className="h-6" orientation="vertical" />
            <IconButton
              icon={X}
              aria-label={t('preview.closePreview')}
              onClick={() => onOpenChange(false)}
            />
          </HStack>
        </div>
      }
    >
      {/* Body */}
      {isLoading && (
        <div className="flex-1 grid place-items-center p-6">
          <div className="text-sm text-muted-foreground">
            {t('preview.loading')}
          </div>
        </div>
      )}
      {isError && (
        <div className="flex-1 grid place-items-center p-6">
          <div className="text-sm text-destructive">
            {queryError?.message || t('preview.failedToLoad')}
          </div>
        </div>
      )}
      {!isLoading && !isError && doc && doc.url && (
        <DocumentPreview url={doc.url} fileName={displayName} />
      )}
    </Dialog>
  );
}
