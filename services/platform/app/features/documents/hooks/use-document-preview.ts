'use client';

import DOMPurify from 'dompurify';

import { useReactQuery } from '@/app/hooks/use-react-query';

import { normalizeConvertedDocumentHtml } from '../utils/normalize-converted-document-html';
import { odtBytesToHtml } from '../utils/odt-preview';

export function useDocxPreview(url: string) {
  return useReactQuery({
    queryKey: ['docx-preview', url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
      const ab = await res.arrayBuffer();
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: ab });
      return normalizeConvertedDocumentHtml(
        DOMPurify.sanitize(result.value || ''),
      );
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useOdtPreview(url: string) {
  return useReactQuery({
    queryKey: ['odt-preview', url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch document (${res.status})`);
      const ab = await res.arrayBuffer();
      // jszip is dynamically imported inside `odtBytesToHtml` (parity with
      // the mammoth/xlsx imports below); output is sanitized before render.
      const html = await odtBytesToHtml(ab);
      return normalizeConvertedDocumentHtml(DOMPurify.sanitize(html));
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
      // xlsx resolves to the SheetJS-maintained CDN tarball pinned in
      // package.json; output is passed through DOMPurify before rendering.
      const { read, utils } = await import('xlsx');
      const wb = read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const tableHtml = utils.sheet_to_html(ws);
      return DOMPurify.sanitize(tableHtml);
    },
    staleTime: 5 * 60 * 1000,
  });
}

const STRICT_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be'] as const;

export function decodeWithEncoding(
  buffer: ArrayBuffer | Uint8Array,
  truncated = false,
): {
  text: string;
  encoding: string;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // A byte-capped read can chop a multibyte sequence mid-character, which
  // would fail the strict decoders and mis-detect the file's encoding \u2014 trim
  // up to 3 trailing bytes to land back on a character boundary. Each encoding
  // exhausts its trim attempts before the next is tried: an even-length
  // chopped UTF-8 buffer is structurally valid UTF-16LE, so interleaving the
  // encodings per trim level would return UTF-16 mojibake instead of the
  // one-byte-trimmed UTF-8 text.
  const maxTrim = truncated ? Math.min(3, bytes.byteLength) : 0;
  for (const encoding of STRICT_ENCODINGS) {
    for (let trim = 0; trim <= maxTrim; trim += 1) {
      const candidate =
        trim === 0 ? bytes : bytes.subarray(0, bytes.byteLength - trim);
      try {
        const decoder = new TextDecoder(encoding, { fatal: true });
        const text = decoder.decode(candidate);
        if (text.length > 0 && !text.includes('\uFFFD')) {
          return { text, encoding };
        }
      } catch {
        continue;
      }
    }
  }

  const decoder = new TextDecoder('iso-8859-1');
  return { text: decoder.decode(bytes), encoding: 'iso-8859-1' };
}

/**
 * Byte cap for text/markdown previews. The preview used to download the WHOLE
 * file and render it into one `<pre>`/markdown tree \u2014 a 96 MB text document
 * froze the tab (100M-char text node layout; syntax highlighting far worse).
 * The capped stream reads at most this many bytes and cancels the rest; the
 * pane shows a "download for the full contents" notice instead.
 */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

/** Above this many characters, skip syntax highlighting (tokenizing hangs). */
export const TEXT_PREVIEW_HIGHLIGHT_MAX_CHARS = 256 * 1024;

export interface TextPreviewResult {
  text: string;
  truncated: boolean;
}

/**
 * Read at most `cap` bytes of a response body, cancelling the stream once the
 * cap is crossed so the rest of a large file is never downloaded.
 */
export async function readBodyCapped(
  res: Response,
  cap: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = res.body;
  if (!body) {
    const full = new Uint8Array(await res.arrayBuffer());
    return { bytes: full.subarray(0, cap), truncated: full.byteLength > cap };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
    if (total > cap) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(total, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.byteLength - offset;
    if (room <= 0) {
      break;
    }
    bytes.set(
      room >= chunk.byteLength ? chunk : chunk.subarray(0, room),
      offset,
    );
    offset += Math.min(room, chunk.byteLength);
  }
  return { bytes, truncated };
}

export function useTextPreview(url: string) {
  return useReactQuery({
    queryKey: ['text-preview', url],
    queryFn: async ({ signal }): Promise<TextPreviewResult> => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
      const { bytes, truncated } = await readBodyCapped(
        res,
        TEXT_PREVIEW_MAX_BYTES,
      );
      const { text } = decodeWithEncoding(bytes, truncated);
      return { text, truncated };
    },
    staleTime: 5 * 60 * 1000,
  });
}
