'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import {
  getFileExtensionLower,
  getTextFileCategory,
} from '@/lib/utils/text-file-types';

import { useTextPreview } from '../hooks/use-document-preview';
import { PreviewPane } from './preview-pane';

interface DocumentPreviewTextProps {
  url: string;
  fileName?: string;
}

export function DocumentPreviewText({
  url,
  fileName,
}: DocumentPreviewTextProps) {
  const { t } = useT('documents');
  const { resolvedTheme } = useTheme();
  const { data: content, isLoading, error } = useTextPreview(url);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  const ext = getFileExtensionLower(fileName || '');
  const category = getTextFileCategory(fileName || '');
  const isCodeFile =
    category === 'code' ||
    category === 'markup' ||
    category === 'config' ||
    category === 'data';
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    setHighlightedHtml(null);
    if (!content || !isCodeFile || !ext) return undefined;

    let cancelled = false;
    const lang = resolveLanguage(ext);
    void highlightCode(content, lang, shikiTheme).then((result) => {
      if (!cancelled) setHighlightedHtml(result?.html ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [content, ext, isCodeFile, shikiTheme]);

  const highlightRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && highlightedHtml) el.innerHTML = highlightedHtml;
    },
    [highlightedHtml],
  );

  return (
    <PreviewPane>
      {isLoading && (
        <Skeletonize loading label={t('preview.loading')} className="contents">
          <SkeletonBox>
            <div className="mx-auto aspect-[1/1.3] w-full max-w-4xl" />
          </SkeletonBox>
        </Skeletonize>
      )}
      {!isLoading && error && (
        <Text as="div" variant="error" align="center" className="mt-4">
          {t('preview.failedToLoad')}
        </Text>
      )}
      {!isLoading &&
        !error &&
        content !== null &&
        content !== undefined &&
        (isCodeFile && highlightedHtml ? (
          // `w-full` matters: inside the pane's flex column, `mx-auto` alone
          // would shrink the block to its content width and float it in the
          // horizontal middle — short files showed their line-number gutter
          // mid-pane instead of along the left edge of the reading column.
          <div
            ref={highlightRef}
            className="code-line-numbers mx-auto w-full max-w-4xl text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-0!"
          />
        ) : (
          <div className="mx-auto w-full max-w-4xl">
            {/* For a code file this is the pre-highlight frame: reserve the
                3rem `code-line-numbers` gutter (2rem numbers + 1rem margin) so
                the text keeps its x-position when the colours land. */}
            <pre
              className={cn(
                'm-0! bg-transparent! p-0!',
                isCodeFile && 'pl-12!',
              )}
            >
              <code className="text-foreground font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                {content}
              </code>
            </pre>
          </div>
        ))}
    </PreviewPane>
  );
}
