'use client';

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  highlightCode,
  MAX_SHIKI_BYTES,
  resolveLanguage,
} from '@/lib/utils/shiki';
import {
  getFileExtensionLower,
  getTextFileCategory,
} from '@/lib/utils/text-file-types';

import {
  TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS,
  useTextPreview,
} from '../hooks/use-document-preview';
import {
  codeGutterStyle,
  PreviewContentSkeleton,
  PreviewPane,
  previewCodeTextClasses,
  previewPaneReadableClasses,
} from './preview-pane';

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
  const shikiTheme = resolvedTheme === 'dark' ? 'min-dark' : 'min-light';
  // Until its highlight lands, a code file under both caps is laid out the
  // way the highlight will lay it out: unwrapped, in the numbered column.
  const willHighlight =
    isCodeFile &&
    !!ext &&
    !!content &&
    content.length <=
      Math.min(TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS, MAX_SHIKI_BYTES);

  useEffect(() => {
    setHighlightedHtml(null);
    if (!content || !willHighlight) return undefined;

    let cancelled = false;
    const lang = resolveLanguage(ext);
    void highlightCode(content, lang, shikiTheme).then((result) => {
      if (!cancelled) setHighlightedHtml(result?.html ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [content, ext, willHighlight, shikiTheme]);

  const highlightRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && highlightedHtml) el.innerHTML = highlightedHtml;
    },
    [highlightedHtml],
  );

  return (
    <PreviewPane className={previewPaneReadableClasses}>
      {isLoading && (
        <PreviewContentSkeleton kind="text" label={t('preview.loading')} />
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
            style={codeGutterStyle(content)}
            className={cn(
              'code-line-numbers w-full [&_pre]:m-0! [&_pre]:overflow-x-auto [&_pre]:bg-transparent! [&_pre]:p-0!',
              previewCodeTextClasses,
            )}
          />
        ) : (
          <pre
            className={cn(
              'm-0! bg-transparent! p-0!',
              previewCodeTextClasses,
              // Scroll sideways like the highlight's `pre`, but never shrink
              // into a second vertical scroller inside the pane.
              willHighlight && 'shrink-0 overflow-x-auto',
            )}
          >
            <code
              style={isCodeFile ? codeGutterStyle(content) : undefined}
              className={cn(
                'text-foreground',
                isCodeFile && 'code-text-column block',
                willHighlight
                  ? 'whitespace-pre'
                  : 'wrap-break-word whitespace-pre-wrap',
              )}
            >
              {content}
            </code>
          </pre>
        ))}
    </PreviewPane>
  );
}
