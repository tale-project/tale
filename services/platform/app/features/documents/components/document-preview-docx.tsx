'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDocxPreview } from '../hooks/use-document-preview';
import { documentPageClasses } from './document-prose-classes';
import { PreviewPane, previewPaneDocumentClasses } from './preview-pane';

interface DocumentPreviewDocxProps {
  url: string;
}

export function DocumentPreviewDocx({ url }: DocumentPreviewDocxProps) {
  const { t } = useT('documents');
  const { data: html, isLoading, error } = useDocxPreview(url);

  const htmlRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && html) el.innerHTML = html;
    },
    [html],
  );

  return (
    <PreviewPane className={previewPaneDocumentClasses}>
      {isLoading && (
        <Skeletonize loading label={t('preview.loading')} className="contents">
          <SkeletonBox>
            <div className="bg-background border-border/60 mx-auto aspect-[1/1.4] w-full max-w-2xl rounded-lg border shadow-sm" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {!isLoading && error && (
        <div className="mt-4 text-center text-red-500">
          {t('preview.failedToLoad')}
        </div>
      )}
      {!isLoading && !error && html && (
        <div ref={htmlRef} className={documentPageClasses} />
      )}
    </PreviewPane>
  );
}
