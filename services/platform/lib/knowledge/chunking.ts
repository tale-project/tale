/**
 * Structure-aware chunking with contextual headers.
 *
 * Two contracts hold at once, and they are why the chunk shape has four text
 * fields instead of one.
 *
 * **Every chunk says what it belongs to.** A chunk is retrieved alone, into a
 * context that has none of the document around it, so "the limit is 40 hours"
 * is useless without "Employment handbook › Working time". Each chunk therefore
 * carries a `header` — the document title and the markdown heading path
 * enclosing it, joined with `›` — and {@link ContextualChunk.embedText} is that
 * header followed by the chunk body. Embedding and full-text indexing both use
 * `embedText`, so the context participates in matching as well as in reading.
 * It is on by default: it costs a few tokens per chunk and removes an entire
 * class of confidently-wrong answers.
 *
 * **The original document is recoverable byte for byte.** Chunks overlap so a
 * sentence spanning a boundary is retrievable from either side, which means
 * naively concatenating chunk bodies duplicates the overlap. Each chunk also
 * carries a `core` span — its forward-owning slice of the input — with the
 * identity `chunks.map(c => c.core).join('') === text` holding exactly, for any
 * input, including one whose gaps the splitter trimmed. `prefixOverlap` and
 * `suffixOverlap` name which part of the body is shared with the neighbours, so
 * a reader can strip the seam without re-running the splitter. The header lives
 * OUTSIDE these spans: it is derived context, not document text, and folding it
 * in would break reassembly.
 *
 * Splitting happens at the coarsest structural boundary that fits the size
 * budget — heading, code fence, paragraph, line, sentence, word — and only
 * falls back to cutting mid-word when a single word exceeds the budget.
 */

/** Target size of a chunk body, in UTF-16 code units. */
const CHUNK_SIZE = 2048;

/** How much of the previous chunk's tail each chunk repeats. */
const CHUNK_OVERLAP = 200;

/** Separator between the levels of a contextual header. */
export const HEADER_SEPARATOR = ' › ';

/** Deepest heading level kept in a header; deeper ones would push the body out
 * of the chunk without adding much orientation. */
const MAX_HEADER_DEPTH = 4;

/** Ceiling on the rendered header, so a document with pathological headings
 * cannot crowd out the text it is supposed to introduce. */
const MAX_HEADER_LENGTH = 200;

export interface ContextualChunk {
  /** Position of the chunk in the document, from 0. */
  readonly index: number;
  /** The chunk body, exactly as the splitter cut it — no header, no metadata. */
  readonly text: string;
  /** «Doc › Section › Subsection», or `''` when the document offers neither a
   * title nor a heading above this chunk. */
  readonly header: string;
  /** What gets embedded and full-text indexed: the header, then the body. */
  readonly embedText: string;
  /** The chunk's forward-owning span of the input. Concatenating these across
   * all chunks reproduces the input exactly. */
  readonly core: string;
  /** The leading part of the body also present at the end of the previous
   * chunk. Empty for the first chunk. */
  readonly prefixOverlap: string;
  /** The trailing part of the body also present at the start of the next
   * chunk. Empty for the last chunk. */
  readonly suffixOverlap: string;
}

export interface ChunkOptions {
  /** The document's own name — the first level of every header. */
  readonly title?: string | null;
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
}

/**
 * Split `text` into contextual chunks.
 *
 * Empty or whitespace-only input yields no chunks: there is nothing to retrieve
 * and an empty vector would only pollute the index.
 */
export function chunkDocument(
  text: string | null | undefined,
  options: ChunkOptions = {},
): ContextualChunk[] {
  if (!text || text.trim() === '') return [];

  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  // A chunk cannot repeat more than half of itself, or consecutive chunks stop
  // advancing through the document.
  const overlap = Math.min(
    options.chunkOverlap ?? CHUNK_OVERLAP,
    Math.floor(chunkSize / 2),
  );

  const placed = packSegments(
    splitIntoSegments(text, 0, chunkSize),
    chunkSize,
    overlap,
  );
  if (placed.length === 0) return [];

  const headings = headingOutline(text);
  const title = options.title?.trim() ?? '';
  const chunks: ContextualChunk[] = [];

  for (let i = 0; i < placed.length; i++) {
    const { start, body } = placed[i];
    const end = start + body.length;

    // The first chunk owns everything before it and the last chunk everything
    // after it, so whitespace the splitter trimmed at the document's edges is
    // still owned by exactly one chunk and reassembly stays exact.
    const coreStart = i === 0 ? 0 : start;
    const coreEnd = i === placed.length - 1 ? text.length : placed[i + 1].start;

    let prefixOverlap = '';
    if (i > 0) {
      const previousEnd = placed[i - 1].start + placed[i - 1].body.length;
      if (previousEnd > start) {
        prefixOverlap = text.slice(start, Math.min(previousEnd, coreEnd));
      }
    }

    let suffixOverlap = '';
    if (i < placed.length - 1) {
      const nextStart = placed[i + 1].start;
      if (end > nextStart) suffixOverlap = text.slice(nextStart, end);
    }

    const header = renderHeader(title, headingPathAt(headings, start));
    chunks.push({
      index: i,
      text: body,
      header,
      embedText: header === '' ? body : `${header}\n\n${body}`,
      core: text.slice(coreStart, coreEnd),
      prefixOverlap,
      suffixOverlap,
    });
  }

  return chunks;
}

/**
 * Reassemble the document a chunk list came from.
 *
 * Concatenates the forward-owning spans, never the bodies — bodies overlap, and
 * joining them would duplicate every seam.
 */
export function reassemble(chunks: readonly ContextualChunk[]): string {
  let out = '';
  for (const chunk of chunks) out += chunk.core;
  return out;
}

// ------------------------------------------------------------------- headings

interface Heading {
  readonly offset: number;
  readonly level: number;
  readonly title: string;
}

/** ATX headings (`## Section`) outside fenced code blocks, in document order. */
function headingOutline(text: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    const fence = /^\s{0,3}(?:```|~~~)/.exec(line);
    if (fence) inFence = !inFence;
    if (!inFence) {
      // A heading a chunk can be attributed to: one to six `#`, a space, then
      // a non-empty title. Trailing `#`s are decoration in Markdown.
      const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) {
        const title = match[2].trim();
        if (title !== '') {
          headings.push({ offset, level: match[1].length, title });
        }
      }
    }
    offset += line.length + 1;
  }
  return headings;
}

/** The nesting of headings in force at `offset`, outermost first. */
function headingPathAt(headings: readonly Heading[], offset: number): string[] {
  const stack: Heading[] = [];
  for (const heading of headings) {
    if (heading.offset > offset) break;
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }
  const path: string[] = [];
  for (const heading of stack.slice(0, MAX_HEADER_DEPTH))
    path.push(heading.title);
  return path;
}

/** Join the title and heading path, dropping a level that merely repeats its
 * parent and truncating from the deepest end when the result grows too long. */
function renderHeader(title: string, path: readonly string[]): string {
  const levels: string[] = [];
  if (title !== '') levels.push(title);
  for (const level of path) {
    if (levels.length === 0 || levels[levels.length - 1] !== level) {
      levels.push(level);
    }
  }
  while (
    levels.length > 1 &&
    levels.join(HEADER_SEPARATOR).length > MAX_HEADER_LENGTH
  ) {
    levels.pop();
  }
  return levels.join(HEADER_SEPARATOR).slice(0, MAX_HEADER_LENGTH);
}

// ------------------------------------------------------------------ splitting

/** A contiguous piece of the input with its absolute start offset. */
interface Segment {
  readonly start: number;
  readonly text: string;
}

/** A chunk body with the offset in the input it was cut from. */
interface PlacedBody {
  readonly start: number;
  readonly body: string;
}

/**
 * Cut `text` into atomic pieces at the coarsest boundary whose pieces all fit
 * `chunkSize`. Pieces concatenate back to `text`, and their offsets are
 * absolute into the whole document.
 */
function splitIntoSegments(
  text: string,
  start: number,
  chunkSize: number,
): Segment[] {
  if (text.length <= chunkSize) return [{ start, text }];

  // Coarse to fine. Each pattern splits BEFORE or AFTER its delimiter so the
  // delimiter stays attached to a piece and concatenation stays lossless.
  const boundaries = [
    /(?<=\n)(?=\s{0,3}#{1,6}\s)/g, // before a heading line
    /(?<=```\n)/g, // after a code-fence line
    /(?<=\n\n)/g, // paragraph break
    /(?<=\n)/g, // line break
    /(?<=[.!?]\s)/g, // sentence end
    /(?<=\s)/g, // word boundary
  ];

  for (const boundary of boundaries) {
    const pieces = sliceAt(text, boundary);
    if (pieces.length <= 1) continue;
    const segments: Segment[] = [];
    let offset = start;
    for (const piece of pieces) {
      if (piece.length <= chunkSize)
        segments.push({ start: offset, text: piece });
      else segments.push(...splitIntoSegments(piece, offset, chunkSize));
      offset += piece.length;
    }
    return segments;
  }

  // A single unbroken run longer than the budget — a base64 blob, a minified
  // line. Cut it by length; there is no boundary left to respect.
  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    segments.push({ start: start + i, text: text.slice(i, i + chunkSize) });
  }
  return segments;
}

/** Split at every match, keeping the delimiter attached to its piece. */
function sliceAt(text: string, boundary: RegExp): string[] {
  const pieces: string[] = [];
  let last = 0;
  boundary.lastIndex = 0;
  for (const match of text.matchAll(boundary)) {
    if (match.index > last) {
      pieces.push(text.slice(last, match.index));
      last = match.index;
    }
  }
  if (last < text.length) pieces.push(text.slice(last));
  return pieces.length > 0 ? pieces : [text];
}

/**
 * Greedily fill chunks with segments, carrying an `overlap` budget of trailing
 * segments into the next chunk. Bodies are trimmed of surrounding whitespace;
 * the trimmed gaps are absorbed by the forward-owning spans in
 * {@link chunkDocument}, which is what keeps reassembly exact.
 */
function packSegments(
  segments: readonly Segment[],
  chunkSize: number,
  overlap: number,
): PlacedBody[] {
  const placed: PlacedBody[] = [];
  let current: Segment[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    let joined = '';
    for (const segment of current) joined += segment.text;
    const leading = joined.length - joined.trimStart().length;
    const body = joined.trim();
    if (body !== '') placed.push({ start: current[0].start + leading, body });
  };

  for (const segment of segments) {
    if (currentLength + segment.text.length > chunkSize && current.length > 0) {
      flush();
      const carry: Segment[] = [];
      let carryLength = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carryLength + current[i].text.length > overlap && carry.length > 0)
          break;
        carry.unshift(current[i]);
        carryLength += current[i].text.length;
      }
      current = carry;
      currentLength = carryLength;
    }
    current.push(segment);
    currentLength += segment.text.length;
  }
  flush();

  return strictlyAdvancing(placed);
}

/**
 * Drop bodies that do not advance through the document.
 *
 * When one segment is larger than the overlap budget the carry can reproduce
 * the previous chunk's start; keeping such a body would give two chunks the
 * same forward-owning span and break the reassembly identity.
 */
function strictlyAdvancing(placed: readonly PlacedBody[]): PlacedBody[] {
  const out: PlacedBody[] = [];
  for (const candidate of placed) {
    const previous = out[out.length - 1];
    if (previous === undefined || candidate.start > previous.start)
      out.push(candidate);
    else if (candidate.body.length > previous.body.length)
      out[out.length - 1] = candidate;
  }
  return out;
}
