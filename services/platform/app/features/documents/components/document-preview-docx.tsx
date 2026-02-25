'use client';

import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDocxPreview } from '../hooks/use-document-preview';

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
          className="prose mx-auto aspect-[1/1.4] w-full max-w-2xl"
        />
      )}
    </div>
  );
}
