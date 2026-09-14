'use client';

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { ZoomPanViewer } from '@tale/ui/zoom-pan-viewer';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  PreviewContentSkeleton,
  PreviewPane,
  previewPaneCanvasClasses,
} from './preview-pane';

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
        <div className="absolute inset-6 z-10 flex">
          <PreviewContentSkeleton kind="image" label={t('preview.loading')} />
        </div>
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
