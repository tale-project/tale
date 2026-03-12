'use client';

import { useCallback, useEffect, useState } from 'react';

import { ZoomPanViewer } from '@/app/components/ui/data-display/zoom-pan-viewer';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Center } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { PreviewPane } from './preview-pane';

interface DocumentPreviewImageProps {
  url: string;
  fileName?: string;
}

export function DocumentPreviewImage({
  url,
  fileName,
}: DocumentPreviewImageProps) {
  const { t } = useT('documents');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
  }, [url]);

  if (hasError) {
    return (
      <PreviewPane className="flex items-center justify-center">
        <Text as="div" variant="error" align="center">
          {t('preview.failedToLoad')}
        </Text>
      </PreviewPane>
    );
  }

  return (
    <PreviewPane>
      {isLoading && (
        <Center className="absolute inset-0 z-10">
          <Skeleton className="size-64 rounded-xl" />
        </Center>
      )}
      <ZoomPanViewer
        src={url}
        alt={fileName || t('preview.document')}
        toolbarPosition="bottom"
        imageClassName="rounded-xl border"
        onLoad={handleLoad}
        onError={handleError}
        className={isLoading ? 'invisible' : undefined}
      />
    </PreviewPane>
  );
}
