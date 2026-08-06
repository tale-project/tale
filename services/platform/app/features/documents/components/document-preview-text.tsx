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

import {
  TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS,
  useTextPreview,
} from '../hooks/use-document-preview';
import { PreviewPane, previewPaneReadableClasses } from './preview-pane';

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
  const { data, isLoading, error } = useTextPreview(url);
  const content = data?.text;
  const truncated = data?.truncated ?? false;
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
    if (content.length > TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS) return undefined;

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
      {!isLoading &&
        !error &&
        content !== null &&
        content !== undefined &&
        (isCodeFile && highlightedHtml ? (
          <div
            ref={highlightRef}
            className="code-line-numbers w-full text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-0!"
          />
        ) : (
          <pre
            className={cn('m-0! bg-transparent! p-0!', isCodeFile && 'pl-12!')}
          >
            <code className="text-foreground font-mono text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
              {content}
            </code>
          </pre>
        ))}
    </PreviewPane>
  );
}
