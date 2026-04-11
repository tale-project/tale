import { useMemo } from 'react';

export interface CitationInfo {
  number: number;
  filename?: string;
  fileId?: string;
  page?: number;
  relevance?: number;
  url?: string;
  type: 'rag' | 'web';
  /** Chunk text content extracted from tool output. */
  content?: string;
}

interface ToolUsageInput {
  toolName: string;
  output?: string;
}

const RAG_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[Page:\s*(\d+)\])?(?:\s*\[(?:Modified|Created):\s*[^\]]+\])?(?:\s*\[FileID:\s*([^\]]+)\])?/g;

const WEB_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[URL:\s*([^\]]+)\])?/g;

/**
 * Parse citation metadata and chunk content from RAG search result text.
 *
 * The RAG output format is:
 * ```
 * [1] (Relevance: 87.3%) [Source: report.pdf] [Page: 5] [FileID: abc]
 * <chunk content>
 *
 * ---
 *
 * [2] (Relevance: 72.1%) [Source: memo.docx] [FileID: def]
 * <chunk content>
 * ```
 */
export function parseRagCitations(text: string): Map<number, CitationInfo> {
  const citations = new Map<number, CitationInfo>();

  // Split by chunk separator to get individual chunks
  const chunks = text.split(/\n\n---\n\n/);

  for (const chunk of chunks) {
    RAG_CITATION_PATTERN.lastIndex = 0;
    const match = RAG_CITATION_PATTERN.exec(chunk);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    // Content is everything after the metadata line
    const metadataEnd = (match.index ?? 0) + match[0].length;
    const content = chunk.slice(metadataEnd).trim() || undefined;

    citations.set(num, {
      number: num,
      relevance: parseFloat(match[2]),
      filename: match[3] || undefined,
      page: match[4] ? parseInt(match[4], 10) : undefined,
      fileId: match[5] || undefined,
      type: 'rag',
      content,
    });
  }
  return citations;
}

/**
 * Parse citation metadata from web search result text.
 */
export function parseWebCitations(text: string): Map<number, CitationInfo> {
  const citations = new Map<number, CitationInfo>();
  let match;
  WEB_CITATION_PATTERN.lastIndex = 0;
  while ((match = WEB_CITATION_PATTERN.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    citations.set(num, {
      number: num,
      relevance: parseFloat(match[2]),
      filename: match[3] || undefined,
      url: match[4] || undefined,
      type: 'web',
    });
  }
  return citations;
}

/**
 * Parse citations from tool usage records.
 *
 * Processes RAG and web tool outputs in order, offsetting web citation
 * numbers by the max RAG citation number to avoid collisions.
 */
export function parseCitationsFromToolsUsage(
  toolsUsage: ToolUsageInput[],
): Map<number, CitationInfo> {
  const allCitations = new Map<number, CitationInfo>();
  let maxNumber = 0;

  for (const usage of toolsUsage) {
    if (!usage.output) continue;

    // toolsUsage.output is safeStringify'd — unwrap if it's a JSON string
    let output = usage.output;
    if (output.startsWith('"') && output.endsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(output);
        if (typeof parsed === 'string') {
          output = parsed;
        }
      } catch {
        // use as-is
      }
    }

    if (usage.toolName === 'rag_search') {
      const ragCitations = parseRagCitations(output);
      for (const [num, citation] of ragCitations) {
        allCitations.set(num, citation);
        if (num > maxNumber) maxNumber = num;
      }
    } else if (usage.toolName === 'web') {
      const webCitations = parseWebCitations(output);
      for (const [originalNum, citation] of webCitations) {
        const offsetNum = originalNum + maxNumber;
        allCitations.set(offsetNum, { ...citation, number: offsetNum });
      }
    }
  }

  return allCitations;
}

/**
 * Legacy parser for backward compatibility with contextText.
 */
export function parseCitations(contextText: string): Map<number, CitationInfo> {
  return parseRagCitations(contextText);
}

/**
 * Deduplicate citations by source identity (fileId or url).
 * Keeps the first occurrence of each unique source and builds a
 * number remapping so inline [N] markers still resolve correctly.
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
      // Map this duplicate number to the existing citation
      const existing = deduped.get(existingNum);
      if (existing) deduped.set(num, existing);
    } else {
      seen.set(sourceKey, num);
      deduped.set(num, citation);
    }
  }

  return deduped;
}

export interface ChunkDetail {
  number: number;
  page?: number;
  relevance?: number;
  content?: string;
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
  /** All distinct page numbers referenced (RAG only). */
  pages: number[];
  /** Highest relevance score among the grouped citations. */
  relevance?: number;
  /** Individual chunk details with content for display. */
  chunks: ChunkDetail[];
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

  for (const citation of citations.values()) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}`
        : `web:${citation.url ?? ''}`;

    const chunk: ChunkDetail = {
      number: citation.number,
      page: citation.page,
      relevance: citation.relevance,
      content: citation.content,
    };

    const existing = groups.get(sourceKey);
    if (existing) {
      existing.chunkNumbers.push(citation.number);
      existing.chunks.push(chunk);
      if (citation.page != null && !existing.pages.includes(citation.page)) {
        existing.pages.push(citation.page);
      }
      if (
        citation.relevance != null &&
        (existing.relevance == null || citation.relevance > existing.relevance)
      ) {
        existing.relevance = citation.relevance;
      }
    } else {
      groups.set(sourceKey, {
        number: citation.number,
        filename: citation.filename,
        fileId: citation.fileId,
        url: citation.url,
        type: citation.type,
        chunkNumbers: [citation.number],
        pages: citation.page != null ? [citation.page] : [],
        relevance: citation.relevance,
        chunks: [chunk],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.number - b.number);
}

/**
 * Hook that provides citation lookup from message metadata.
 *
 * Prefers structured tool usage data when available, falling back
 * to raw context text for older messages.
 */
export function useCitations(
  toolsUsage?: ToolUsageInput[],
  contextText?: string,
) {
  const citations = useMemo(() => {
    let raw: Map<number, CitationInfo>;
    if (toolsUsage && toolsUsage.length > 0) {
      raw = parseCitationsFromToolsUsage(toolsUsage);
    } else if (contextText) {
      raw = parseCitations(contextText);
    } else {
      return new Map<number, CitationInfo>();
    }
    return deduplicateCitations(raw);
  }, [toolsUsage, contextText]);

  return { citations, hasCitations: citations.size > 0 };
}
