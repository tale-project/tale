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

  const extension = useMemo(() => {
    return getFileExtension(fileName || url);
  }, [fileName, url]);

  const handleDownload = async () => {
    try {
      setIsDownloading(true);

      // Fetch the file as a blob to bypass CORS restrictions
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');

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
        title: 'Download complete',
        description: `${fileName || 'File'} has been downloaded`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: 'Failed to download the file',
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
          Preview not available
        </div>
        <div className="text-sm mb-6">
          This file type cannot be previewed. <br /> Please download the file to
          view its contents.
        </div>
        <Button size="sm" onClick={handleDownload} disabled={isDownloading}>
          {isDownloading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Downloading...
            </>
          ) : (
            <>
              <Download className="mr-2 size-4" /> Download
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
