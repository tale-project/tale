'use client';

import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
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
          className="[&_td]:border-border [&_table]:bg-background text-foreground max-w-none [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:text-left [&_tr]:border-b"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
