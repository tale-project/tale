'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getFileExtension } from '@/lib/utils/document-helpers';
import { Image } from 'lucide-react';
import { Download, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import DocumentPreviewPDF from './document-preview-pdf';
import DocumentPreviewDocx from './document-preview-docx';
import DocumentPreviewXlsx from './document-preview-xlsx';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

export interface DocumentPreviewProps {
  url: string;
  fileName?: string;
}

export default function DocumentPreview({
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
    <div className="flex-1 grid place-items-center p-6">
      <div className="text-center text-muted-foreground max-w-[24rem]">
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
      </div>
    </div>
  );
}
