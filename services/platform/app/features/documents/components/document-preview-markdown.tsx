'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';

import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';

import { useTextPreview } from '../hooks/use-document-preview';
import { PreviewPane } from './preview-pane';

interface DocumentPreviewMarkdownProps {
  url: string;
}

export function DocumentPreviewMarkdown({ url }: DocumentPreviewMarkdownProps) {
  const { t } = useT('documents');
  const { data, isLoading, error } = useTextPreview(url);
  const content = data?.text;
  const truncated = data?.truncated ?? false;

  return (
    <PreviewPane>
      {isLoading && (
        <Skeletonize loading label={t('preview.loading')} className="contents">
          <SkeletonBox>
            <div className="mx-auto aspect-[1/1.3] w-full max-w-3xl" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {!isLoading && error && (
        <Text as="div" variant="error" align="center" className="mt-4">
          {t('preview.failedToLoad')}
        </Text>
      )}
      {!isLoading && !error && truncated && (
        <Text
          as="div"
          variant="muted"
          align="center"
          className="mx-auto mb-3 w-full max-w-3xl"
        >
          {t('preview.truncatedNotice')}
        </Text>
      )}
      {!isLoading && !error && content !== null && content !== undefined && (
        <div className="mx-auto w-full max-w-3xl px-2 py-4">
          <MarkdownContent content={content} />
        </div>
      )}
    </PreviewPane>
  );
}
