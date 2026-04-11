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
  input?: string;
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
 * Try to unwrap safeStringify'd output — handles both JSON-wrapped
 * strings and nested objects with a `response` or `output` field.
 */
function unwrapOutput(raw: string): string {
  let output = raw;

  // Unwrap JSON-wrapped string: "\"...\""
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

  return output;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

interface JsonFieldsResult {
  response?: string;
  filename?: string;
  fileId?: string;
}

/**
 * Extract metadata fields from a JSON tool output string.
 * Handles both direct objects and nested `{ value: { ... } }` wrappers.
 */
function extractJsonFields(output: string): JsonFieldsResult | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isPlainObject(parsed)) return undefined;

    // Check nested value wrapper (tool-result shape)
    const obj = isPlainObject(parsed.value) ? parsed.value : parsed;

    const response =
      typeof obj.response === 'string'
        ? obj.response
        : typeof obj.output === 'string'
          ? obj.output
          : undefined;
    // filename field (retrieve), or title as fallback
    const filename =
      typeof obj.filename === 'string'
        ? obj.filename
        : typeof obj.title === 'string'
          ? obj.title
          : undefined;
    const fileId = typeof obj.fileId === 'string' ? obj.fileId : undefined;

    return response || filename || fileId
      ? { response, filename, fileId }
      : undefined;
  } catch {
    // not JSON
  }
  return undefined;
}

/**
 * Detect whether a rag_search tool call is a 'retrieve' operation
 * by examining its input. Returns parsed input data if it is.
 */
function parseRetrieveInput(
  inputStr: string | undefined,
): { fileId: string } | undefined {
  if (!inputStr) return undefined;
  try {
    const parsed: unknown = JSON.parse(inputStr);
    if (
      isPlainObject(parsed) &&
      parsed.operation === 'retrieve' &&
      typeof parsed.fileId === 'string'
    ) {
      return { fileId: parsed.fileId };
    }
  } catch {
    // not JSON
  }
  return undefined;
}

/**
 * Parse citations from tool usage records.
 *
 * Processes RAG search and retrieve operations plus web tool outputs,
 * offsetting citation numbers between successive calls to avoid collisions.
 */
export function parseCitationsFromToolsUsage(
  toolsUsage: ToolUsageInput[],
): Map<number, CitationInfo> {
  const allCitations = new Map<number, CitationInfo>();
  let nextNumber = 1;

  for (const usage of toolsUsage) {
    if (!usage.output) continue;

    const output = unwrapOutput(usage.output);

    if (usage.toolName === 'rag_search') {
      const fields = extractJsonFields(output);
      // First try to parse as formatted search results ([N] Relevance: ...)
      const responseText = fields?.response ?? output;
      const ragCitations = parseRagCitations(responseText);

      if (ragCitations.size > 0) {
        // Offset all numbers so successive rag_search calls don't collide
        const offset = nextNumber - 1;
        for (const [, citation] of ragCitations) {
          const newNum = citation.number + offset;
          allCitations.set(newNum, { ...citation, number: newNum });
          if (newNum >= nextNumber) nextNumber = newNum + 1;
        }
      } else {
        // No formatted citations — could be a retrieve operation
        const retrieveInput = parseRetrieveInput(usage.input);
        if (retrieveInput) {
          const content = fields?.response ?? output;
          if (content && content !== 'Document has no text content.') {
            allCitations.set(nextNumber, {
              number: nextNumber,
              fileId: fields?.fileId ?? retrieveInput.fileId,
              filename: fields?.filename ?? undefined,
              type: 'rag',
              content,
            });
            nextNumber++;
          }
        }
      }
    } else if (usage.toolName === 'web') {
      const webCitations = parseWebCitations(output);
      const offset = nextNumber - 1;
      for (const [, citation] of webCitations) {
        const newNum = citation.number + offset;
        allCitations.set(newNum, { ...citation, number: newNum });
        if (newNum >= nextNumber) nextNumber = newNum + 1;
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
    // Include a content fingerprint so different chunks from the same
    // file/page are kept as separate entries.
    const contentKey = citation.content?.slice(0, 80) ?? '';
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}:${citation.page ?? ''}:${contentKey}`
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
  // Track which original citation numbers we've already added as chunks
  // to avoid duplicating content when deduplicateCitations maps multiple
  // keys to the same citation object.
  const addedChunkIds = new Map<string, Set<number>>();

  for (const [mapKey, citation] of citations) {
    const sourceKey =
      citation.type === 'rag'
        ? `rag:${citation.fileId ?? ''}`
        : `web:${citation.url ?? ''}`;

    // Use the Map key as the inline reference number (the [N] in the text),
    // since deduplicateCitations may remap multiple keys to the same citation.
    const inlineNumber = mapKey;

    const existing = groups.get(sourceKey);
    if (existing) {
      existing.chunkNumbers.push(inlineNumber);

      // Only add chunk detail if this is a genuinely different chunk
      // (not a remapped duplicate pointing to the same original citation)
      let chunkSet = addedChunkIds.get(sourceKey);
      if (!chunkSet) {
        chunkSet = new Set();
        addedChunkIds.set(sourceKey, chunkSet);
      }
      if (!chunkSet.has(citation.number)) {
        chunkSet.add(citation.number);
        existing.chunks.push({
          number: citation.number,
          page: citation.page,
          relevance: citation.relevance,
          content: citation.content,
        });
        if (citation.page != null && !existing.pages.includes(citation.page)) {
          existing.pages.push(citation.page);
        }
        if (
          citation.relevance != null &&
          (existing.relevance == null ||
            citation.relevance > existing.relevance)
        ) {
          existing.relevance = citation.relevance;
        }
      }
    } else {
      const chunkSet = new Set([citation.number]);
      addedChunkIds.set(sourceKey, chunkSet);
      groups.set(sourceKey, {
        number: inlineNumber,
        filename: citation.filename,
        fileId: citation.fileId,
        url: citation.url,
        type: citation.type,
        chunkNumbers: [inlineNumber],
        pages: citation.page != null ? [citation.page] : [],
        relevance: citation.relevance,
        chunks: [
          {
            number: citation.number,
            page: citation.page,
            relevance: citation.relevance,
            content: citation.content,
          },
        ],
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
