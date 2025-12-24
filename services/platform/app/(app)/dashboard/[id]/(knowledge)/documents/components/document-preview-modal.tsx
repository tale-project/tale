'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import DocumentIcon from '@/components/ui/document-icon';
import { Download, X, Loader2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import DocumentPreview from './document-preview';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface DocumentPreviewModalProps {
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

export default function DocumentPreviewModal({
  open,
  onOpenChange,
  organizationId,
  storagePath,
  documentId,
  fileName,
}: DocumentPreviewModalProps) {
  const { t } = useT('documents');
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  // Use documentId if available, otherwise use storagePath
  const dataById = useQuery(
    api.documents.getDocumentByIdPublic,
    open && Boolean(documentId)
      ? {
          documentId: documentId as Id<'documents'>,
        }
      : 'skip',
  );

  const dataByPath = useQuery(
    api.documents.getDocumentByPath,
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
  const queryError = isError ? new Error(data?.error || 'Unknown error') : null;
  const doc = data?.success ? data.item : undefined;

  // Determine display name
  const displayName =
    fileName ||
    doc?.name ||
    (storagePath ? extractNameFromStoragePath(storagePath) : 'Document');

  const handleDownload = async () => {
    if (!doc?.url) return;

    try {
      setIsDownloading(true);

      // Fetch the file as a blob to bypass CORS restrictions
      const response = await fetch(doc.url);
      if (!response.ok) throw new Error('Download failed');

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
        description: `${displayName} has been downloaded`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="w-[95vw] max-w-[1100px] h-[85vh] p-0 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between p-5 border-b max-h-[4.5rem]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0">
              <DocumentIcon fileName={displayName} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{displayName}</DialogTitle>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
            <DialogClose asChild>
              <Button variant="ghost" size="icon">
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>

        {/* Body */}
        {isLoading && (
          <div className="flex-1 grid place-items-center p-6">
            <div className="text-sm text-muted-foreground">{t('preview.loading')}</div>
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
      </DialogContent>
    </Dialog>
  );
}
