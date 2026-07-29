import { useMemo } from 'react';

export interface CitationInfo {
  number: number;
  filename?: string;
  fileId?: string;
  page?: number;
  relevance?: number;
  url?: string;
  type: 'rag' | 'web';
}

interface StructuredCitation {
  index: number;
  type: 'rag' | 'web';
  source: string;
  fileId?: string;
  url?: string;
  page?: number;
  relevance?: number;
}

/**
 * Deduplicate citations by source identity (fileId or url).
 * Keeps the first occurrence of each unique source and maps
 * duplicate numbers to the existing citation.
 */
function deduplicateCitations(
  citations: Map<number, CitationInfo>,
): Map<number, CitationInfo> {
  const seen = new Map<string, number>(); // sourceKey → kept citation number
  const deduped = new Map<number, CitationInfo>();

  for (const [num, citation] of citations) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}:${citation.page ?? ''}`
        : `web:${citation.url ?? ''}`;

    const existingNum = seen.get(sourceKey);
    if (existingNum !== undefined) {
      const existing = deduped.get(existingNum);
      if (existing) deduped.set(num, existing);
    } else {
      seen.set(sourceKey, num);
      deduped.set(num, citation);
    }
  }

  return deduped;
}

export interface SourceGroup {
  /** The first citation number (used for ordering and as key). */
  number: number;
  filename?: string;
  fileId?: string;
  url?: string;
  type: 'rag' | 'web';
  /** All inline citation numbers that reference this source. */
  chunkNumbers: number[];
  /** Number of distinct chunks/citations referencing this source. */
  chunkCount: number;
  /** Highest relevance score among the grouped citations. */
  relevance?: number;
}

/**
 * Group citations by source (fileId for RAG, url for web) for display
 * in source cards. Same file with different pages/chunks is merged
 * into a single entry.
 */
export function getUniqueSources(
  citations: Map<number, CitationInfo>,
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const seenNumbers = new Map<string, Set<number>>();

  for (const [mapKey, citation] of citations) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}`
        : `web:${citation.url ?? ''}`;

    const existing = groups.get(sourceKey);
    if (existing) {
      existing.chunkNumbers.push(mapKey);

      let numSet = seenNumbers.get(sourceKey);
      if (!numSet) {
        numSet = new Set();
        seenNumbers.set(sourceKey, numSet);
      }
      if (!numSet.has(citation.number)) {
        numSet.add(citation.number);
        existing.chunkCount++;
        if (
          citation.relevance != null &&
          (existing.relevance == null ||
            citation.relevance > existing.relevance)
        ) {
          existing.relevance = citation.relevance;
        }
      }
    } else {
      seenNumbers.set(sourceKey, new Set([citation.number]));
      groups.set(sourceKey, {
        number: mapKey,
        filename: citation.filename,
        fileId: citation.fileId,
        url: citation.url,
        type: citation.type,
        chunkNumbers: [mapKey],
        chunkCount: 1,
        relevance: citation.relevance,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.number - b.number);
}

/**
 * Hook that provides citation lookup from structured citation metadata.
 * Citations are grouped by source identity (fileId for RAG, url for web).
 */
export function useCitations(structuredCitations?: StructuredCitation[]) {
  const citations = useMemo(() => {
    if (!structuredCitations || structuredCitations.length === 0) {
      return new Map<number, CitationInfo>();
    }

    const raw = new Map<number, CitationInfo>();

    for (const c of structuredCitations) {
      raw.set(c.index, {
        number: c.index,
        type: c.type,
        filename: c.source,
        fileId: c.fileId,
        url: c.url,
        page: c.page,
        relevance:
          c.relevance != null ? Math.round(c.relevance * 100) : undefined,
      });
    }

    return deduplicateCitations(raw);
  }, [structuredCitations]);

  return { citations, hasCitations: citations.size > 0 };
}
