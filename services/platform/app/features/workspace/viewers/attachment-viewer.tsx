'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Download } from 'lucide-react';
import { memo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';

interface AttachmentViewerProps {
  path: string;
  size: number;
  contentType: string;
  url: string;
}

/**
 * Fallback for files we can't preview in-browser (PDF, archives, native
 * binaries…). Convex storage URLs are cross-origin, so the `<a download>`
 * attribute is ignored and the browser saves under the storage UUID.
 * Fetch as a Blob and trigger via a same-origin object URL so the filename
 * the user expects (the workspace path) is honored.
 */
function AttachmentViewerComponent({
  path,
  size,
  contentType,
  url,
}: AttachmentViewerProps) {
  const { t } = useT('chat');
  const { locale } = useLocale();
  const filename = path.split('/').pop() ?? path;
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (isDownloading) return;
    try {
      setIsDownloading(true);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Canvas download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Stack gap={3} className="h-full items-center justify-center p-8">
      <Text variant="caption" className="font-mono">
        {path}
      </Text>
      <Text variant="muted" className="text-sm">
        {formatBytes(size, locale)} ·{' '}
        {contentType || 'application/octet-stream'}
      </Text>
      <Button
        icon={Download}
        variant="secondary"
        onClick={() => void handleDownload()}
        disabled={isDownloading}
      >
        {t('canvas.download', { defaultValue: 'Download' })}
      </Button>
    </Stack>
  );
}

export const AttachmentViewer = memo(AttachmentViewerComponent);
