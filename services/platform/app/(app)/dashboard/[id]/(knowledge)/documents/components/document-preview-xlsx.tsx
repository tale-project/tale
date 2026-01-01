'use client';

import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useT } from '@/lib/i18n';
// Note: xlsx is dynamically imported to reduce initial bundle size

interface DocumentPreviewXlsxProps {
  url: string;
}

export function DocumentPreviewXlsx({ url }: DocumentPreviewXlsxProps) {
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
          throw new Error(`Failed to fetch spreadsheet (${res.status})`);
        const ab = await res.arrayBuffer();
        // Dynamically import xlsx to reduce bundle size
        const { read, utils } = await import('xlsx');
        const wb = read(ab);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const tableHtml = utils.sheet_to_html(ws);
        const sanitized = DOMPurify.sanitize(tableHtml);
        if (!isCancelled) setHtml(sanitized);
      } catch (e) {
        console.error('Error loading XLSX:', e);
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
    <div className="p-6 mx-auto relative overflow-y-auto w-full flex-1 overflow-x-auto">
      {loading && (
        <div className="mt-4 text-gray-500 text-center">
          {t('preview.loading')}
        </div>
      )}
      {!loading && error && (
        <div className="mt-4 text-red-500 text-center">{error}</div>
      )}
      {!loading && !error && (
        <div
          className="max-w-none [&_td]:border [&_td]:border-border [&_table]:bg-background text-foreground [&_table]:w-full [&_table]:border-collapse [&_th]:text-left [&_td]:align-top [&_tr]:border-b [&_td]:px-3 [&_td]:py-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
