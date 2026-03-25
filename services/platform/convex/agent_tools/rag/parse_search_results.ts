/**
 * Shared parser for formatted RAG search results.
 *
 * Used by context management utilities to split
 * RAG results by relevance threshold.
 */

export interface ParsedRagEntry {
  fullMatch: string;
  index: number;
  relevance: number;
}

const RAG_RESULT_PATTERN =
  /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)(?:\s*\[Source:.*?\])?(?:\s*\[(?:Modified|Created):.*?\])?(?:\s*\[FileID:.*?\])?\n([\s\S]*?)(?=\n\n---\n\n|\n*$)/g;

export function parseRagResults(ragContext: string): ParsedRagEntry[] {
  const entries: ParsedRagEntry[] = [];
  const pattern = new RegExp(
    RAG_RESULT_PATTERN.source,
    RAG_RESULT_PATTERN.flags,
  );
  let match;
  while ((match = pattern.exec(ragContext)) !== null) {
    entries.push({
      fullMatch: match[0],
      index: parseInt(match[1], 10),
      relevance: parseFloat(match[2]) / 100,
    });
  }
  return entries;
}
