'use client';

import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDocxPreview } from '../hooks/use-document-preview';
import { PreviewPane } from './preview-pane';

interface DocumentPreviewDocxProps {
  url: string;
}

// `@tailwindcss/typography` is not loaded in this monorepo, so `prose` is a
// no-op and Tailwind preflight strips heading / list defaults. Style each
// element explicitly so the mammoth-converted HTML renders like a document.
const docxProseClasses = cn(
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:first:mt-0',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:first:mt-0',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
  '[&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-base [&_h4]:font-semibold',
  '[&_p]:my-2 [&_p]:leading-relaxed',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_li]:leading-relaxed',
  '[&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline',
  '[&_strong]:font-semibold',
  '[&_em]:italic',
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre]:bg-muted [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-3 [&_pre]:text-sm',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:italic',
  '[&_hr]:border-border [&_hr]:my-6',
  '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:border-border [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
);

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
    <PreviewPane>
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
          className={cn(
            'mx-auto aspect-[1/1.4] w-full max-w-2xl',
            docxProseClasses,
          )}
        />
      )}
    </PreviewPane>
  );
}
