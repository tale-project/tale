import { useMemo } from 'react';

export interface CitationInfo {
  number: number;
  filename?: string;
  fileId?: string;
  page?: number;
  relevance?: number;
}

/**
 * Parse citation metadata from RAG search result text.
 *
 * Extracts structured citation data from the format:
 * `[N] (Relevance: X%) [Source: filename] [Page: Y] [FileID: id]`
 */
export function parseCitations(contextText: string): Map<number, CitationInfo> {
  const citations = new Map<number, CitationInfo>();
  const pattern =
    /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[Page:\s*(\d+)\])?(?:\s*\[(?:Modified|Created):\s*[^\]]+\])?(?:\s*\[FileID:\s*([^\]]+)\])?/g;

  let match;
  while ((match = pattern.exec(contextText)) !== null) {
    const num = parseInt(match[1], 10);
    citations.set(num, {
      number: num,
      relevance: parseFloat(match[2]),
      filename: match[3] || undefined,
      page: match[4] ? parseInt(match[4], 10) : undefined,
      fileId: match[5] || undefined,
    });
  }

  return citations;
}

/**
 * Hook that provides citation lookup from message context.
 */
export function useCitations(contextText?: string) {
  const citations = useMemo(
    () => (contextText ? parseCitations(contextText) : new Map()),
    [contextText],
  );

  return { citations, hasCitations: citations.size > 0 };
}
