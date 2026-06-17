/**
 * Markdown-aware content chunking for search indexing.
 *
 * Splits at structural boundaries (headers, fenced code blocks, paragraphs,
 * lines, sentences, words, characters) while respecting a target chunk size
 * and an overlap budget.
 *
 * Each returned chunk carries three derived text fields so downstream storage
 * can both (a) faithfully reconstruct the original document and (b) keep the
 * embedding text identical to the splitter's raw output:
 *
 * - `content`        — the splitter's raw chunk text. Use this as the
 *   embedding input.
 * - `coreContent`    — the chunk's "forward-owning" span of the original
 *   input. `chunks.map(c => c.coreContent).join('') === content` exactly,
 *   even when the splitter trims whitespace at gap boundaries or at the edges
 *   of the input. Reassembly concatenates just these across chunks, which
 *   eliminates the overlap-duplication bug.
 * - `prefixOverlap`  — the portion of `coreContent` also at the tail of the
 *   previous chunk. Empty for chunk 0.
 * - `suffixOverlap`  — the portion of the raw chunk text that overlaps with the
 *   next chunk's `coreContent`. Equal to the next chunk's `prefixOverlap` when
 *   non-empty. Empty for the last chunk.
 *
 * Offsets are derived against the exact input string (UTF-16 code-unit
 * indices, applied consistently so the tiling identity holds for CJK / emoji /
 * combining characters). The previous Python implementation delegated
 * segmentation to the `semantic-text-splitter` Rust bindings, which have no
 * npm package; this is a faithful TypeScript re-implementation of the same
 * tiling/overlap contract verified by the property tests.
 */

export const CHUNK_SIZE = 2048;
export const CHUNK_OVERLAP = 200;
export const MIN_CHUNK_LENGTH = 10;

export interface ContentChunk {
  content: string;
  index: number;
  coreContent: string;
  prefixOverlap: string;
  suffixOverlap: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkLength?: number;
}

/**
 * Build a `"title\n\nurl\n\n"` prefix for embed-time bias. Lives at the call
 * site so stored chunk text stays metadata-free and the chunker invariants
 * hold unconditionally.
 */
export function buildMetadataPrefix(
  title: string | null | undefined,
  url: string | null | undefined,
): string {
  const parts: string[] = [];
  if (title && title.trim()) {
    parts.push(title.trim());
  }
  if (url && url.trim()) {
    parts.push(url.trim());
  }
  return parts.length > 0 ? `${parts.join('\n\n')}\n\n` : '';
}

/** A contiguous segment of the input with its start offset. */
interface Segment {
  start: number;
  text: string;
}

/**
 * Split `text` (a slice of the input starting at absolute offset `start`) into
 * atomic segments at the finest semantic level that yields pieces no larger
 * than `chunkSize`. Returns segments whose `text` concatenates back to `text`
 * and whose offsets are absolute into the original input.
 */
function splitIntoSegments(
  text: string,
  start: number,
  chunkSize: number,
): Segment[] {
  if (text.length <= chunkSize) {
    return [{ start, text }];
  }

  // Separators ordered coarse → fine. Each keeps its delimiter attached to the
  // preceding piece so concatenation is lossless.
  const separators = [
    /(?<=\n)(?=#{1,6}\s)/g, // before a markdown header line
    /(?<=```\n)/g, // after a closing/opening code fence line
    /(?<=\n\n)/g, // paragraph break
    /(?<=\n)/g, // line break
    /(?<=[.!?]\s)/g, // sentence end
    /(?<=\s)/g, // word boundary
  ];

  for (const separator of separators) {
    const pieces = sliceBySeparator(text, separator);
    if (pieces.length > 1 && pieces.every((p) => p.length <= chunkSize)) {
      const segments: Segment[] = [];
      let offset = start;
      for (const piece of pieces) {
        segments.push({ start: offset, text: piece });
        offset += piece.length;
      }
      return segments;
    }
    if (pieces.length > 1) {
      // Recurse into any oversized piece at a finer level.
      const segments: Segment[] = [];
      let offset = start;
      for (const piece of pieces) {
        if (piece.length <= chunkSize) {
          segments.push({ start: offset, text: piece });
        } else {
          segments.push(...splitIntoSegments(piece, offset, chunkSize));
        }
        offset += piece.length;
      }
      return segments;
    }
  }

  // No separator helped: hard-split by characters.
  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    segments.push({ start: start + i, text: text.slice(i, i + chunkSize) });
  }
  return segments;
}

/** Split `text` at every match of `separator`, keeping delimiters attached. */
function sliceBySeparator(text: string, separator: RegExp): string[] {
  const pieces: string[] = [];
  let last = 0;
  separator.lastIndex = 0;
  for (const match of text.matchAll(separator)) {
    const idx = match.index;
    if (idx > last) {
      pieces.push(text.slice(last, idx));
      last = idx;
    }
  }
  if (last < text.length) {
    pieces.push(text.slice(last));
  }
  return pieces.length > 0 ? pieces : [text];
}

/**
 * Greedily pack atomic segments into chunks no larger than `chunkSize`,
 * carrying an `overlap` budget of trailing segments into the next chunk.
 * Returns `(start, chunkText)` pairs analogous to semantic-text-splitter's
 * `chunkIndices`, with leading/trailing whitespace-only edges trimmed exactly
 * as the Rust splitter would (so the tiling re-derivation absorbs the gaps).
 */
function chunkIndices(
  content: string,
  chunkSize: number,
  overlap: number,
): [number, string][] {
  const segments = splitIntoSegments(content, 0, chunkSize);
  const pairs: [number, string][] = [];

  let current: Segment[] = [];
  let currentLen = 0;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    const joined = current.map((s) => s.text).join('');
    const trimmedStartOffset = joined.length - joined.trimStart().length;
    const trimmed = joined.trim();
    if (trimmed.length > 0) {
      pairs.push([current[0].start + trimmedStartOffset, trimmed]);
    }
  };

  for (const segment of segments) {
    if (currentLen + segment.text.length > chunkSize && current.length > 0) {
      flush();
      // Build the overlap carry: take trailing segments up to `overlap` chars.
      const carry: Segment[] = [];
      let carryLen = 0;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        if (carryLen + current[i].text.length > overlap && carry.length > 0) {
          break;
        }
        carry.unshift(current[i]);
        carryLen += current[i].text.length;
      }
      current = carry;
      currentLen = carryLen;
    }
    current.push(segment);
    currentLen += segment.text.length;
  }
  flush();

  return dedupeMonotonic(pairs);
}

/**
 * Ensure chunk start offsets are strictly increasing. The overlap carry can
 * produce a chunk whose start is <= the previous chunk's start when a single
 * segment exceeds the overlap budget; drop such degenerate duplicates so the
 * forward-owning core spans remain well-formed.
 */
function dedupeMonotonic(pairs: [number, string][]): [number, string][] {
  const out: [number, string][] = [];
  for (const pair of pairs) {
    if (out.length === 0 || pair[0] > out[out.length - 1][0]) {
      out.push(pair);
    } else if (pair[1].length > out[out.length - 1][1].length) {
      out[out.length - 1] = pair;
    }
  }
  return out;
}

/**
 * Split `content` into overlap-aware chunks.
 *
 * Returns an empty list for null / empty / whitespace-only input.
 * `minChunkLength` is accepted for backward compatibility but unused: filtering
 * short chunks would break the tiling invariant `join(core) === content`.
 */
export function chunkContent(
  content: string | null | undefined,
  options: ChunkOptions = {},
): ContentChunk[] {
  if (!content || !content.trim()) {
    return [];
  }

  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? CHUNK_OVERLAP;
  const effectiveOverlap = Math.min(chunkOverlap, Math.floor(chunkSize / 2));

  const pairs = chunkIndices(content, chunkSize, effectiveOverlap);
  if (pairs.length === 0) {
    return [];
  }

  const n = pairs.length;
  const chunks: ContentChunk[] = [];

  for (let i = 0; i < n; i += 1) {
    const [start, raw] = pairs[i];
    const end = start + raw.length;

    // Forward-owning span. Pin chunk 0 to offset 0 and the last chunk to
    // content.length so trimmed leading/trailing whitespace is absorbed into
    // the adjacent core and the tiling invariant holds.
    const coreStart = i === 0 ? 0 : start;
    const coreEnd = i === n - 1 ? content.length : pairs[i + 1][0];
    const core = content.slice(coreStart, coreEnd);

    let prefixOverlap = '';
    if (i > 0) {
      const prevEnd = pairs[i - 1][0] + pairs[i - 1][1].length;
      if (prevEnd > start) {
        prefixOverlap = content.slice(start, Math.min(prevEnd, coreEnd));
      }
    }

    let suffixOverlap = '';
    if (i < n - 1) {
      const nextStart = pairs[i + 1][0];
      if (end > nextStart) {
        suffixOverlap = content.slice(nextStart, end);
      }
    }

    chunks.push({
      content: raw,
      index: i,
      coreContent: core,
      prefixOverlap,
      suffixOverlap,
    });
  }

  return chunks;
}
