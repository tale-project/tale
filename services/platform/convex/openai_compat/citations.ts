/**
 * Server-side citation parser for OpenAI-compatible API responses.
 *
 * Extracts structured citation metadata from tool usage output strings
 * produced by rag_search and web search tools.
 *
 * The regex patterns here MUST match the format produced by:
 * - convex/agent_tools/rag/format_search_results.ts (RAG format)
 * - convex/agent_tools/web/helpers/format_web_results.ts (web format)
 */

export interface Citation {
  index: number;
  type: 'rag' | 'web';
  source: string;
  fileId?: string;
  url?: string;
  page?: number;
  relevance: number;
}

interface ToolUsageInput {
  toolName: string;
  output?: string;
}

const RAG_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[Page:\s*(\d+)\])?(?:\s*\[(?:Modified|Created):\s*[^\]]+\])?(?:\s*\[FileID:\s*([^\]]+)\])?/g;

const WEB_CITATION_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:\s*([^\]]+)\])?(?:\s*\[URL:\s*([^\]]+)\])?/g;

function parseRagCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  let match;
  RAG_CITATION_PATTERN.lastIndex = 0;
  while ((match = RAG_CITATION_PATTERN.exec(text)) !== null) {
    citations.push({
      index: parseInt(match[1], 10),
      type: 'rag',
      source: match[3] || 'Unknown',
      fileId: match[5] || undefined,
      page: match[4] ? parseInt(match[4], 10) : undefined,
      relevance: parseFloat(match[2]) / 100,
    });
  }
  return citations;
}

function parseWebCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  let match;
  WEB_CITATION_PATTERN.lastIndex = 0;
  while ((match = WEB_CITATION_PATTERN.exec(text)) !== null) {
    citations.push({
      index: parseInt(match[1], 10),
      type: 'web',
      source: match[3] || 'Unknown',
      url: match[4] || undefined,
      relevance: parseFloat(match[2]) / 100,
    });
  }
  return citations;
}

/**
 * Unwrap a JSON-stringified output value.
 *
 * toolsUsage.output is safeStringify'd, so it may be wrapped
 * in an extra layer of JSON string quotes.
 */
function unwrapOutput(output: string): string {
  if (output.startsWith('"') && output.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(output);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // use as-is
    }
  }
  return output;
}

/**
 * Parse citations from tool usage records.
 *
 * Processes RAG and web tool outputs in order, offsetting web citation
 * numbers by the max RAG citation number to avoid collisions.
 * Returns a deduplicated, sorted array of Citation objects.
 */
export function parseCitationsFromToolsUsage(
  toolsUsage: ToolUsageInput[],
): Citation[] {
  const allCitations: Citation[] = [];
  let maxRagIndex = 0;

  for (const usage of toolsUsage) {
    if (!usage.output) continue;

    const output = unwrapOutput(usage.output);

    if (usage.toolName === 'rag_search') {
      const ragCitations = parseRagCitations(output);
      for (const citation of ragCitations) {
        allCitations.push(citation);
        if (citation.index > maxRagIndex) maxRagIndex = citation.index;
      }
    } else if (usage.toolName === 'web') {
      const webCitations = parseWebCitations(output);
      for (const citation of webCitations) {
        allCitations.push({
          ...citation,
          index: citation.index + maxRagIndex,
        });
      }
    }
  }

  return deduplicateAndSort(allCitations);
}

/**
 * Deduplicate citations by source identity (same fileId+page or same URL).
 * Keeps the first occurrence of each unique source.
 */
function deduplicateAndSort(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const deduped: Citation[] = [];

  for (const citation of citations) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}:${citation.page ?? ''}`
        : `web:${citation.url ?? ''}`;

    if (!seen.has(sourceKey)) {
      seen.add(sourceKey);
      deduped.push(citation);
    }
  }

  return deduped.sort((a, b) => a.index - b.index);
}
