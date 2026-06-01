'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Center } from '@tale/ui/layout';
import { Image, Download, Loader2 } from 'lucide-react';
import { useState, useMemo } from 'react';

import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { mimeToExtension } from '@/lib/shared/file-types';
import { getFileExtension } from '@/lib/utils/document-helpers';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import { PreviewPaneSkeleton } from './preview-pane';

// Every preview renders inside `PreviewPane`, so the lazy Suspense fallback is
// the real pane shell (see `PreviewPaneSkeleton`) — the chunk swaps in without
// the panel resizing or recentering.
const DocumentPreviewPDF = lazyComponent(
  () =>
    import('./document-preview-pdf').then((m) => ({
      default: m.DocumentPreviewPDF,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewDocx = lazyComponent(
  () =>
    import('./document-preview-docx').then((m) => ({
      default: m.DocumentPreviewDocx,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewXlsx = lazyComponent(
  () =>
    import('./document-preview-xlsx').then((m) => ({
      default: m.DocumentPreviewXlsx,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewText = lazyComponent(
  () =>
    import('./document-preview-text').then((m) => ({
      default: m.DocumentPreviewText,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewImage = lazyComponent(
  () =>
    import('./document-preview-image').then((m) => ({
      default: m.DocumentPreviewImage,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'JPG',
  'JPEG',
  'PNG',
  'GIF',
  'WEBP',
  'SVG',
  'BMP',
  'ICO',
  'AVIF',
]);

export interface DocumentPreviewProps {
  url: string;
  fileName?: string;
  /** Authoritative content type, preferred over the filename suffix so that
   * synced documents with clean, extension-less titles still route correctly. */
  mimeType?: string;
}

export function DocumentPreview({
  url,
  fileName,
  mimeType,
}: DocumentPreviewProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  const { t } = useT('documents');

  // Prefer the authoritative mimeType (synced docs keep clean, extension-less
  // titles), falling back to the filename suffix when the mime is generic.
  const extension = useMemo(() => {
    const fromMime = mimeType ? mimeToExtension(mimeType) : undefined;
    if (fromMime) return fromMime.toUpperCase();
    return getFileExtension(fileName || url);
  }, [fileName, url, mimeType]);

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
        description: t('preview.fileDownloaded', {
          fileName: fileName || 'File',
        }),
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

  if (IMAGE_EXTENSIONS.has(extension)) {
    return <DocumentPreviewImage url={url} fileName={fileName} />;
  }

  if (isTextBasedFile(fileName || url, mimeType)) {
    return <DocumentPreviewText url={url} fileName={fileName} />;
  }

  return (
    <Center className="flex-1 p-6">
      <EmptyState
        icon={Image}
        title={t('preview.notAvailable')}
        description={t('preview.notAvailableDescription')}
        action={
          <Button size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />{' '}
                {t('preview.downloading')}
              </>
            ) : (
              <>
                <Download className="mr-2 size-4" /> {t('preview.download')}
              </>
            )}
          </Button>
        }
      />
    </Center>
  );
}
