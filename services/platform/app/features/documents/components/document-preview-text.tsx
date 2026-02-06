'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { useTheme } from '@/app/components/theme/theme-provider';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import { getFileExtensionLower, getTextFileCategory } from '@/lib/utils/text-file-types';

const SUPPORTED_ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'iso-8859-1',
] as const;

function decodeWithEncoding(buffer: ArrayBuffer): { text: string; encoding: string } {
  for (const encoding of SUPPORTED_ENCODINGS) {
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

  const decoder = new TextDecoder('utf-8', { fatal: false });
  return { text: decoder.decode(buffer), encoding: 'utf-8 (fallback)' };
}

interface DocumentPreviewTextProps {
  url: string;
  fileName?: string;
}

export function DocumentPreviewText({ url, fileName }: DocumentPreviewTextProps) {
  const { t } = useT('documents');
  const { resolvedTheme } = useTheme();
  const [content, setContent] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ext = getFileExtensionLower(fileName || '');
  const category = getTextFileCategory(fileName || '');
  const isCodeFile = category === 'code' || category === 'markup' || category === 'config';
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);

        const buffer = await res.arrayBuffer();
        const { text } = decodeWithEncoding(buffer);
        if (!cancelled) setContent(text);
      } catch (e) {
        console.error('Error loading text file:', e);
        if (!cancelled) setError(t('preview.failedToLoad'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [url, t]);

  useEffect(() => {
    if (!content || !isCodeFile || !ext) return;

    let cancelled = false;
    const lang = resolveLanguage(ext);
    highlightCode(content, lang, shikiTheme).then((html) => {
      if (!cancelled && html) setHighlightedHtml(html);
    });
    return () => { cancelled = true; };
  }, [content, ext, isCodeFile, shikiTheme]);

  return (
    <div className="p-6 mx-auto relative overflow-y-auto w-full flex-1 overflow-x-auto">
      {loading && (
        <div className="mt-4 text-muted-foreground text-center">
          {t('preview.loading')}
        </div>
      )}
      {!loading && error && (
        <div className="mt-4 text-destructive text-center">{error}</div>
      )}
      {!loading && !error && content !== null && (
        isCodeFile && highlightedHtml ? (
          <div
            className="max-w-4xl mx-auto text-sm code-line-numbers [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:m-0! [&_code]:text-xs [&_code]:leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <div className="max-w-4xl mx-auto code-line-numbers">
            <pre className="bg-transparent! p-0! m-0!">
              <code className="text-xs leading-relaxed font-mono whitespace-pre-wrap wrap-break-word text-foreground">
                {content.split('\n').map((line, i, arr) => (
                  <span key={i} className="line">{line}{i < arr.length - 1 ? '\n' : ''}</span>
                ))}
              </code>
            </pre>
          </div>
        )
      )}
    </div>
  );
}
