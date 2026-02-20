/**
 * Content Chunking for Embeddings
 *
 * Splits page content into overlapping chunks suitable for embedding generation.
 * Splits by paragraphs first, then sentences, with configurable size and overlap.
 */

const DEFAULT_CHUNK_SIZE = 1500;
const DEFAULT_CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 50;

export interface ContentChunk {
  content: string;
  index: number;
}

export function chunkContent(
  content: string,
  title?: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
): ContentChunk[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const prefix = title ? `${title}\n\n` : '';
  const effectiveChunkSize = chunkSize - prefix.length;

  if (effectiveChunkSize <= MIN_CHUNK_LENGTH) {
    return [{ content: prefix + trimmed, index: 0 }];
  }

  // If content fits in one chunk, return as-is
  if (trimmed.length <= effectiveChunkSize) {
    return [{ content: prefix + trimmed, index: 0 }];
  }

  const paragraphs = splitIntoParagraphs(trimmed);
  const rawChunks = mergeIntoChunks(
    paragraphs,
    effectiveChunkSize,
    chunkOverlap,
  );

  return rawChunks
    .filter((c) => c.length >= MIN_CHUNK_LENGTH)
    .map((c, i) => ({ content: prefix + c, index: i }));
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function mergeIntoChunks(
  segments: string[],
  maxSize: number,
  overlap: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const segment of segments) {
    // If a single segment exceeds maxSize, split it by sentences
    if (segment.length > maxSize) {
      if (current) {
        chunks.push(current.trim());
        current = getOverlapText(current, overlap);
      }
      const sentenceChunks = splitBySentences(segment, maxSize, overlap);
      for (const sc of sentenceChunks) {
        chunks.push((current + sc).trim());
        current = getOverlapText(sc, overlap);
      }
      continue;
    }

    const combined = current ? current + '\n\n' + segment : segment;
    if (combined.length <= maxSize) {
      current = combined;
    } else {
      chunks.push(current.trim());
      current = getOverlapText(current, overlap) + segment;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function splitBySentences(
  text: string,
  maxSize: number,
  overlap: number,
): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const combined = current + sentence;
    if (combined.length <= maxSize) {
      current = combined;
    } else {
      if (current) chunks.push(current.trim());
      current = getOverlapText(current, overlap) + sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function getOverlapText(text: string, overlap: number): string {
  if (text.length <= overlap) return text;
  const slice = text.slice(-overlap);
  // Try to start at a word boundary
  const wordBoundary = slice.indexOf(' ');
  return wordBoundary > 0 ? slice.slice(wordBoundary + 1) : slice;
}
