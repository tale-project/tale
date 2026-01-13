'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/primitives/button';
import { Center, VStack } from '@/components/ui/layout/layout';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { getFileExtension } from '@/lib/utils/document-helpers';
import { Image, Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

// Dynamically load document preview components to reduce initial bundle
// PDF viewer loads pdfjs from CDN, DOCX uses mammoth (~200KB), XLSX uses xlsx (~300KB)
const DocumentPreviewPDF = dynamic(() => import('./document-preview-pdf').then((m) => m.DocumentPreviewPDF), {
  loading: () => <PreviewSkeleton />,
});
const DocumentPreviewDocx = dynamic(() => import('./document-preview-docx').then((m) => m.DocumentPreviewDocx), {
  loading: () => <PreviewSkeleton />,
});
const DocumentPreviewXlsx = dynamic(() => import('./document-preview-xlsx').then((m) => m.DocumentPreviewXlsx), {
  loading: () => <PreviewSkeleton />,
});

function PreviewSkeleton() {
  return (
    <Center className="flex-1 p-6">
      <Skeleton className="w-full max-w-2xl h-[600px]" />
    </Center>
  );
}

export interface DocumentPreviewProps {
  url: string;
  fileName?: string;
}

export function DocumentPreview({
  url,
  fileName,
}: DocumentPreviewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  const { t } = useT('documents');

  const extension = useMemo(() => {
    return getFileExtension(fileName || url);
  }, [fileName, url]);

  const handleDownload = async () => {
    try {
      setIsDownloading(true);

      // Fetch the file as a blob to bypass CORS restrictions
      const response = await fetch(url);
      if (!response.ok) throw new Error(t('preview.downloadFailed'));

      const blob = await response.blob();

      // Create a blob URL and trigger download with proper filename
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName || 'download';
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast({
        title: t('preview.downloadComplete'),
        description: t('preview.fileDownloaded', { fileName: fileName || 'File' }),
        variant: 'success',
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: t('preview.downloadFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  if (extension === 'PDF') {
    return <DocumentPreviewPDF url={url} />;
  }

  if (extension === 'DOCX' || extension === 'DOC') {
    return <DocumentPreviewDocx url={url} />;
  }

  if (extension === 'XLSX' || extension === 'XLS') {
    return <DocumentPreviewXlsx url={url} />;
  }

  return (
    <Center className="flex-1 p-6">
      <VStack align="center" className="text-center text-muted-foreground max-w-[24rem]">
        <Image className="size-16 mx-auto mb-2 p-2" />
        <div className="text-base font-medium text-foreground mb-1">
          {t('preview.notAvailable')}
        </div>
        <div className="text-sm mb-6">
          {t('preview.notAvailableDescription')}
        </div>
        <Button size="sm" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> {t('preview.downloading')}
            </>
          ) : (
            <>
              <Download className="mr-2 size-4" /> {t('preview.download')}
            </>
          )}
        </Button>
      </VStack>
    </Center>
  );
}
