'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';

import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';

import { useTextPreview } from '../hooks/use-document-preview';
import { PreviewPane, previewPaneReadableClasses } from './preview-pane';

interface DocumentPreviewMarkdownProps {
  url: string;
}

export function DocumentPreviewMarkdown({ url }: DocumentPreviewMarkdownProps) {
  const { t } = useT('documents');
  const { data, isLoading, error } = useTextPreview(url);
  const content = data?.text;
  const truncated = data?.truncated ?? false;

  return (
    <PreviewPane className={previewPaneReadableClasses}>
      {isLoading && (
        <Skeletonize loading label={t('preview.loading')} className="contents">
          <SkeletonBox>
            <div className="h-40 w-full max-w-lg" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {!isLoading && error && (
        <Text as="div" variant="error" align="center">
          {t('preview.failedToLoad')}
        </Text>
      )}
      {!isLoading && !error && truncated && (
        <Text as="div" variant="muted" className="mb-4">
          {t('preview.truncatedNotice')}
        </Text>
      )}
      {!isLoading && !error && content !== null && content !== undefined && (
        <MarkdownContent content={content} />
      )}
    </PreviewPane>
  );
}
