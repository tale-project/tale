'use client';

import DOMPurify from 'dompurify';

import { useReactQuery } from '@/app/hooks/use-react-query';

export function useDocxPreview(url: string) {
  return useReactQuery({
    queryKey: ['docx-preview', url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
      const ab = await res.arrayBuffer();
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: ab });
      return DOMPurify.sanitize(result.value || '');
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useXlsxPreview(url: string) {
  return useReactQuery({
    queryKey: ['xlsx-preview', url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok)
        throw new Error(`Failed to fetch spreadsheet (${res.status})`);
      const ab = await res.arrayBuffer();
      const { read, utils } = await import('xlsx');
      const wb = read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const tableHtml = utils.sheet_to_html(ws);
      return DOMPurify.sanitize(tableHtml);
    },
    staleTime: 5 * 60 * 1000,
  });
}

function decodeWithEncoding(buffer: ArrayBuffer): {
  text: string;
  encoding: string;
} {
  const STRICT_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be'] as const;

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

export function useTextPreview(url: string) {
  return useReactQuery({
    queryKey: ['text-preview', url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
      const buffer = await res.arrayBuffer();
      const { text } = decodeWithEncoding(buffer);
      return text;
    },
    staleTime: 5 * 60 * 1000,
  });
}
