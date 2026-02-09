'use client';

import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
// Note: mammoth is dynamically imported to reduce initial bundle size (~200KB)

interface DocumentPreviewDocxProps {
  url: string;
}

export function DocumentPreviewDocx({ url }: DocumentPreviewDocxProps) {
  const { t } = useT('documents');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok)
          throw new Error(`Failed to fetch document (${res.status})`);
        const ab = await res.arrayBuffer();
        // Dynamically import mammoth to reduce bundle size
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: ab });
        const sanitized = DOMPurify.sanitize(result.value || '');
        if (!isCancelled) setHtml(sanitized);
      } catch (e) {
        console.error('Error loading DOCX:', e);
        if (!isCancelled) setError(t('preview.failedToLoad'));
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, [url, t]);

  return (
    <div className="relative mx-auto w-full flex-1 overflow-x-auto overflow-y-auto p-6">
      {loading && (
        <div className="mt-4 text-center text-gray-500">
          {t('preview.loading')}
        </div>
      )}
      {!loading && error && (
        <div className="mt-4 text-center text-red-500">{error}</div>
      )}
      {!loading && !error && (
        <div
          className="prose mx-auto aspect-[1/1.4] w-full max-w-2xl"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
