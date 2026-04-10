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

interface ToolUsageInput {
  toolName: string;
  output?: string;
}

const RAG_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[Page:\s*(\d+)\])?(?:\s*\[(?:Modified|Created):\s*[^\]]+\])?(?:\s*\[FileID:\s*([^\]]+)\])?/g;

const WEB_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[URL:\s*([^\]]+)\])?/g;

/**
 * Parse citation metadata from RAG search result text.
 */
export function parseRagCitations(text: string): Map<number, CitationInfo> {
  const citations = new Map<number, CitationInfo>();
  let match;
  RAG_CITATION_PATTERN.lastIndex = 0;
  while ((match = RAG_CITATION_PATTERN.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    citations.set(num, {
      number: num,
      relevance: parseFloat(match[2]),
      filename: match[3] || undefined,
      page: match[4] ? parseInt(match[4], 10) : undefined,
      fileId: match[5] || undefined,
      type: 'rag',
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

/**
 * Get unique citations for display in source cards (no duplicates).
 */
export function getUniqueCitations(
  citations: Map<number, CitationInfo>,
): CitationInfo[] {
  const seen = new Set<string>();
  const unique: CitationInfo[] = [];

  for (const citation of citations.values()) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}:${citation.page ?? ''}`
        : `web:${citation.url ?? ''}`;

    if (!seen.has(sourceKey)) {
      seen.add(sourceKey);
      unique.push(citation);
    }
  }

  return unique.sort((a, b) => a.number - b.number);
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
