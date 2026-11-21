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
 *
 * **A chunk is cut when it is asked for.** {@link chunksOf} hands the chunks
 * over one at a time, and nothing here holds more of the document than the
 * text itself and the chunk being cut: the pieces, the bodies and the chunks
 * of a long document were five to seven times its text when they were lists.
 * A caller that stores each chunk as it comes holds a large file's text and
 * little else (tale-project/tale#4942); {@link chunkDocument} is the same
 * chunks as a list, for a text that is small.
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
  return [...chunksOf(text, options)];
}

/**
 * The chunks {@link chunkDocument} lists, each cut when it is asked for, in
 * order. Nothing is held between two of them but the text and the bodies of
 * the chunk before and the chunk after, which a chunk's spans are told from.
 */
export function* chunksOf(
  text: string | null | undefined,
  options: ChunkOptions = {},
): Generator<ContextualChunk, void, undefined> {
  if (!text || text.trim() === '') return;

  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  // A chunk cannot repeat more than half of itself, or consecutive chunks stop
  // advancing through the document.
  const overlap = Math.min(
    options.chunkOverlap ?? CHUNK_OVERLAP,
    Math.floor(chunkSize / 2),
  );

  const placed = strictlyAdvancing(
    packSegments(segmentsOf(text, 0, chunkSize), chunkSize, overlap),
  );
  let current = placed.next();
  if (current.done === true) return;

  const headings = headingOutline(text);
  const title = options.title?.trim() ?? '';
  let previous: PlacedBody | undefined;

  for (let index = 0; current.done !== true; index++) {
    const following = placed.next();
    const next = following.done === true ? undefined : following.value;
    const { start, body } = current.value;
    const end = start + body.length;

    // The first chunk owns everything before it and the last chunk everything
    // after it, so whitespace the splitter trimmed at the document's edges is
    // still owned by exactly one chunk and reassembly stays exact.
    const coreStart = index === 0 ? 0 : start;
    const coreEnd = next === undefined ? text.length : next.start;

    let prefixOverlap = '';
    if (previous !== undefined) {
      const previousEnd = previous.start + previous.body.length;
      if (previousEnd > start) {
        prefixOverlap = text.slice(start, Math.min(previousEnd, coreEnd));
      }
    }

    let suffixOverlap = '';
    if (next !== undefined && end > next.start) {
      suffixOverlap = text.slice(next.start, end);
    }

    const header = renderHeader(title, headingPathAt(headings, start));
    yield {
      index,
      text: body,
      header,
      embedText: header === '' ? body : `${header}\n\n${body}`,
      core: text.slice(coreStart, coreEnd),
      prefixOverlap,
      suffixOverlap,
    };

    previous = current.value;
    current = following;
  }
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

/**
 * ATX headings (`## Section`) outside fenced code blocks, in document order.
 * The lines are read one at a time: a list of every line of a long document
 * is a second copy of it.
 */
function headingOutline(text: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  let inFence = false;
  for (;;) {
    const lineEnd = text.indexOf('\n', offset);
    const line =
      lineEnd === -1 ? text.slice(offset) : text.slice(offset, lineEnd);
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
    if (lineEnd === -1) return headings;
    offset = lineEnd + 1;
  }
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
 * Where a text may be cut, coarse to fine. Each pattern splits BEFORE or
 * AFTER its delimiter so the delimiter stays attached to a piece and
 * concatenation stays lossless. A search through one of them starts from a
 * copy (`matchAll`), so they are shared by every cut, at every depth.
 */
const BOUNDARIES: readonly RegExp[] = [
  /(?<=\n)(?=\s{0,3}#{1,6}\s)/g, // before a heading line
  /(?<=```\n)/g, // after a code-fence line
  /(?<=\n\n)/g, // paragraph break
  /(?<=\n)/g, // line break
  /(?<=[.!?]\s)/g, // sentence end
  /(?<=\s)/g, // word boundary
];

/**
 * Cut `text` into atomic pieces at the coarsest boundary whose pieces all fit
 * `chunkSize`, one piece at a time. Pieces concatenate back to `text`, and
 * their offsets are absolute into the whole document.
 */
function* segmentsOf(
  text: string,
  start: number,
  chunkSize: number,
): Generator<Segment, void, undefined> {
  if (text.length <= chunkSize) {
    yield { start, text };
    return;
  }

  for (const boundary of BOUNDARIES) {
    const pieces = piecesAt(text, boundary);
    // A boundary that leaves the text in one piece does not cut it: the
    // next, finer one is tried.
    const first = pieces.next();
    if (first.done === true) continue;
    const second = pieces.next();
    if (second.done === true) continue;

    let offset = start;
    for (const piece of startingWith(first.value, second.value, pieces)) {
      if (piece.length <= chunkSize) yield { start: offset, text: piece };
      else yield* segmentsOf(piece, offset, chunkSize);
      offset += piece.length;
    }
    return;
  }

  // A single unbroken run longer than the budget — a base64 blob, a minified
  // line. Cut it by length; there is no boundary left to respect.
  for (let i = 0; i < text.length; i += chunkSize) {
    yield { start: start + i, text: text.slice(i, i + chunkSize) };
  }
}

/** Two pieces that were looked at already, then the rest of their line. */
function* startingWith(
  first: string,
  second: string,
  rest: Iterable<string>,
): Generator<string, void, undefined> {
  yield first;
  yield second;
  yield* rest;
}

/** The pieces of `text` between the matches of `boundary`, the delimiter
 * kept attached to its piece. */
function* piecesAt(
  text: string,
  boundary: RegExp,
): Generator<string, void, undefined> {
  let last = 0;
  for (const match of text.matchAll(boundary)) {
    if (match.index > last) {
      yield text.slice(last, match.index);
      last = match.index;
    }
  }
  if (last < text.length) yield text.slice(last);
}

/**
 * Greedily fill chunks with segments, carrying an `overlap` budget of trailing
 * segments into the next chunk. Bodies are trimmed of surrounding whitespace;
 * the trimmed gaps are absorbed by the forward-owning spans in
 * {@link chunksOf}, which is what keeps reassembly exact.
 */
function* packSegments(
  segments: Iterable<Segment>,
  chunkSize: number,
  overlap: number,
): Generator<PlacedBody, void, undefined> {
  let current: Segment[] = [];
  let currentLength = 0;

  const flush = (): PlacedBody | undefined => {
    if (current.length === 0) return undefined;
    let joined = '';
    for (const segment of current) joined += segment.text;
    const leading = joined.length - joined.trimStart().length;
    const body = joined.trim();
    return body !== ''
      ? { start: current[0].start + leading, body }
      : undefined;
  };

  for (const segment of segments) {
    if (currentLength + segment.text.length > chunkSize && current.length > 0) {
      const placed = flush();
      if (placed !== undefined) yield placed;
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
  const last = flush();
  if (last !== undefined) yield last;
}

/**
 * Drop bodies that do not advance through the document.
 *
 * When one segment is larger than the overlap budget the carry can reproduce
 * the previous chunk's start; keeping such a body would give two chunks the
 * same forward-owning span and break the reassembly identity. Of bodies that
 * start at one place the longest is kept, so a body is handed on only once
 * the one after it has started further on.
 */
function* strictlyAdvancing(
  placed: Iterable<PlacedBody>,
): Generator<PlacedBody, void, undefined> {
  let held: PlacedBody | undefined;
  for (const candidate of placed) {
    if (held === undefined) {
      held = candidate;
    } else if (candidate.start > held.start) {
      yield held;
      held = candidate;
    } else if (candidate.body.length > held.body.length) {
      held = candidate;
    }
  }
  if (held !== undefined) yield held;
}
