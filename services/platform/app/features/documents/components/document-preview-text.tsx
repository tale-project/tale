'use client';

import { useEffect, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { useT } from '@/lib/i18n/client';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import {
  getFileExtensionLower,
  getTextFileCategory,
} from '@/lib/utils/text-file-types';

const STRICT_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be'] as const;

function decodeWithEncoding(buffer: ArrayBuffer): {
  text: string;
  encoding: string;
} {
  for (const encoding of STRICT_ENCODINGS) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(buffer);
      if (text.length > 0 && !text.includes('\uFFFD')) {
        return { text, encoding };
      }
    } catch {
      continue;
    }
  }

  const decoder = new TextDecoder('iso-8859-1');
  return { text: decoder.decode(buffer), encoding: 'iso-8859-1' };
}

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
  const [content, setContent] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ext = getFileExtensionLower(fileName || '');
  const category = getTextFileCategory(fileName || '');
  const isCodeFile =
    category === 'code' ||
    category === 'markup' ||
    category === 'config' ||
    category === 'data';
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);

        const buffer = await res.arrayBuffer();
        const { text } = decodeWithEncoding(buffer);
        if (!controller.signal.aborted) setContent(text);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error('Error loading text file:', e);
        setError(t('preview.failedToLoad'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => {
      controller.abort();
    };
  }, [url, t]);

  useEffect(() => {
    setHighlightedHtml(null);
    if (!content || !isCodeFile || !ext) return;

    let cancelled = false;
    const lang = resolveLanguage(ext);
    highlightCode(content, lang, shikiTheme).then((html) => {
      if (!cancelled) setHighlightedHtml(html || null);
    });
    return () => {
      cancelled = true;
    };
  }, [content, ext, isCodeFile, shikiTheme]);

  return (
    <div className="relative mx-auto w-full flex-1 overflow-x-auto overflow-y-auto p-6">
      {loading && (
        <div className="text-muted-foreground mt-4 text-center">
          {t('preview.loading')}
        </div>
      )}
      {!loading && error && (
        <div className="text-destructive mt-4 text-center">{error}</div>
      )}
      {!loading &&
        !error &&
        content !== null &&
        (isCodeFile && highlightedHtml ? (
          <div
            className="code-line-numbers mx-auto max-w-4xl text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:bg-transparent! [&_pre]:p-0!"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <div className="code-line-numbers mx-auto max-w-4xl">
            <pre className="m-0! bg-transparent! p-0!">
              <code className="text-foreground font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap">
                {content.split('\n').map((line, i, arr) => (
                  <span key={i} className="line">
                    {line}
                    {i < arr.length - 1 ? '\n' : ''}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        ))}
    </div>
  );
}
