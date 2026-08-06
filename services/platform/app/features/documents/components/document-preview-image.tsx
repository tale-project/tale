'use client';

import { Center } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useEffect, useState } from 'react';

import { ZoomPanViewer } from '@/app/components/ui/data-display/zoom-pan-viewer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { PreviewPane, previewPaneCanvasClasses } from './preview-pane';

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
      <PreviewPane
        className={cn(previewPaneCanvasClasses, 'items-center justify-center')}
      >
        <Text as="div" variant="error" align="center">
          {t('preview.failedToLoad')}
        </Text>
      </PreviewPane>
    );
  }

  return (
    <PreviewPane className={previewPaneCanvasClasses}>
      {isLoading && (
        <Skeletonize loading className="absolute inset-0 z-10">
          <Center className="size-full">
            <SkeletonBox>
              <div className="size-64 rounded-xl" />
            </SkeletonBox>
          </Center>
        </Skeletonize>
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
