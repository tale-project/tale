'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Download } from 'lucide-react';
import { memo } from 'react';

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
 * binaries…). Shows the basics and offers a download chip; the link points
 * at the signed storage URL the workspace query already vended.
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

  return (
    <Stack gap={3} className="h-full items-center justify-center p-8">
      <Text variant="caption" className="font-mono">
        {path}
      </Text>
      <Text variant="muted" className="text-sm">
        {formatBytes(size, locale)} ·{' '}
        {contentType || 'application/octet-stream'}
      </Text>
      <Button asChild icon={Download} variant="secondary">
        <a href={url} download={filename} rel="noopener noreferrer">
          {t('canvas.download', { defaultValue: 'Download' })}
        </a>
      </Button>
    </Stack>
  );
}

export const AttachmentViewer = memo(AttachmentViewerComponent);
