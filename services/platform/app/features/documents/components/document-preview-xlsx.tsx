'use client';

import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

import { useXlsxPreview } from '../hooks/use-document-preview';

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
    <div className="relative mx-auto w-full flex-1 overflow-x-auto overflow-y-auto p-6">
      {isLoading && (
        <div className="mt-4 text-center text-gray-500">
          {t('preview.loading')}
        </div>
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
    </div>
  );
}
