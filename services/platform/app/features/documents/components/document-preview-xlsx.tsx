'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

import { useXlsxPreview } from '../hooks/use-document-preview';
import { PreviewPane, previewPaneCanvasClasses } from './preview-pane';

interface DocumentPreviewXlsxProps {
  url: string;
}

export function DocumentPreviewXlsx({ url }: DocumentPreviewXlsxProps) {
  const { t } = useT('documents');
  const { data: html, isLoading, error } = useXlsxPreview(url);

  const htmlRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && html) el.innerHTML = html;
    },
    [html],
  );

  return (
    <PreviewPane className={previewPaneCanvasClasses}>
      {isLoading && (
        <Skeletonize loading label={t('preview.loading')} className="contents">
          <SkeletonBox fullWidth>
            <div className="aspect-[1/1.4] w-full max-w-none" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {!isLoading && error && (
        <div className="mt-4 text-center text-red-500">
          {t('preview.failedToLoad')}
        </div>
      )}
      {!isLoading && !error && html && (
        <div
          ref={htmlRef}
          className="[&_td]:border-border [&_table]:bg-background text-foreground max-w-none [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:text-left [&_tr]:border-b"
        />
      )}
    </PreviewPane>
  );
}
