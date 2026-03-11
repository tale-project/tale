'use client';

import { useCallback, useEffect, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
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
    if (!content || !isCodeFile || !ext) return;

    let cancelled = false;
    const lang = resolveLanguage(ext);
    void highlightCode(content, lang, shikiTheme).then((html) => {
      if (!cancelled) setHighlightedHtml(html || null);
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
        <Text as="div" variant="muted" align="center" className="mt-4">
          {t('preview.loading')}
        </Text>
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
          <div
            ref={highlightRef}
            className="code-line-numbers mx-auto max-w-4xl text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:bg-transparent! [&_pre]:p-0!"
          />
        ) : (
          <div className="mx-auto max-w-4xl">
            <pre className="m-0! bg-transparent! p-0!">
              <code className="text-foreground font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                {content}
              </code>
            </pre>
          </div>
        ))}
    </PreviewPane>
  );
}
