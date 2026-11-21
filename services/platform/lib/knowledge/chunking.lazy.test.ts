import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chunkDocument,
  chunksOf,
  HEADER_SEPARATOR,
  type ChunkOptions,
  type ContextualChunk,
} from './chunking';

/**
 * The chunker cuts a document's chunks as they are asked for, so that a long
 * document is never held as lists of its pieces (tale-project/tale#4942).
 * What it cuts must not move by a character: a stored document's chunks and
 * its content hash are what indexing compares a file against, so a chunk cut
 * elsewhere would embed every unchanged document again.
 *
 * The reference below is the chunker as it was while it built lists, kept
 * here to be compared against. It is not a second chunker to maintain: a
 * change to how documents are cut changes both, or drops this file's first
 * suite with a reason.
 */

// ------------------------------------------------- the list-building chunker

const CHUNK_SIZE = 2048;
const CHUNK_OVERLAP = 200;
const MAX_HEADER_DEPTH = 4;
const MAX_HEADER_LENGTH = 200;

interface Heading {
  readonly offset: number;
  readonly level: number;
  readonly title: string;
}
interface Segment {
  readonly start: number;
  readonly text: string;
}
interface PlacedBody {
  readonly start: number;
  readonly body: string;
}

function referenceChunks(
  text: string | null | undefined,
  options: ChunkOptions = {},
): ContextualChunk[] {
  if (!text || text.trim() === '') return [];
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = Math.min(
    options.chunkOverlap ?? CHUNK_OVERLAP,
    Math.floor(chunkSize / 2),
  );
  const placed = referencePack(
    referenceSplit(text, 0, chunkSize),
    chunkSize,
    overlap,
  );
  if (placed.length === 0) return [];
  const headings = referenceOutline(text);
  const title = options.title?.trim() ?? '';
  const chunks: ContextualChunk[] = [];
  for (let i = 0; i < placed.length; i++) {
    const { start, body } = placed[i];
    const end = start + body.length;
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
    const header = referenceHeader(title, referencePathAt(headings, start));
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

function referenceOutline(text: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    const fence = /^\s{0,3}(?:```|~~~)/.exec(line);
    if (fence) inFence = !inFence;
    if (!inFence) {
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

function referencePathAt(
  headings: readonly Heading[],
  offset: number,
): string[] {
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

function referenceHeader(title: string, path: readonly string[]): string {
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

function referenceSplit(
  text: string,
  start: number,
  chunkSize: number,
): Segment[] {
  if (text.length <= chunkSize) return [{ start, text }];
  const boundaries = [
    /(?<=\n)(?=\s{0,3}#{1,6}\s)/g,
    /(?<=```\n)/g,
    /(?<=\n\n)/g,
    /(?<=\n)/g,
    /(?<=[.!?]\s)/g,
    /(?<=\s)/g,
  ];
  for (const boundary of boundaries) {
    const pieces = referenceSliceAt(text, boundary);
    if (pieces.length <= 1) continue;
    const segments: Segment[] = [];
    let offset = start;
    for (const piece of pieces) {
      if (piece.length <= chunkSize)
        segments.push({ start: offset, text: piece });
      else segments.push(...referenceSplit(piece, offset, chunkSize));
      offset += piece.length;
    }
    return segments;
  }
  const segments: Segment[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    segments.push({ start: start + i, text: text.slice(i, i + chunkSize) });
  }
  return segments;
}

function referenceSliceAt(text: string, boundary: RegExp): string[] {
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

function referencePack(
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

// --------------------------------------------------------- documents to cut

/** A generator of the same numbers on every run. */
function numbers(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const WORDS = [
  'refund',
  'policy',
  'the',
  'of',
  'quarter',
  'Überweisung',
  'façade',
  'naïve',
  '„Zitat“',
  'l’accord',
  '表',
  '😀',
  'x',
  'a.b',
  'e.g.',
  'done!',
  'why?',
  '#tag',
  '##',
  '```',
  '~~~',
];

/** A document of the shapes a file's text takes, and of the ones that try a
 * splitter: headings at every depth, fences, blank runs, lines without an
 * end, words longer than a chunk, text that is white space alone. */
function randomDocument(next: () => number): string {
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(next() * list.length)] ?? list[0];
  const words = (count: number): string =>
    Array.from({ length: count }, () => pick(WORDS)).join(' ');
  const parts: string[] = [];
  const blocks = 1 + Math.floor(next() * 40);
  for (let block = 0; block < blocks; block += 1) {
    const kind = next();
    if (kind < 0.16) {
      const level = 1 + Math.floor(next() * 7);
      parts.push(
        `${' '.repeat(Math.floor(next() * 5))}${'#'.repeat(level)} ${words(1 + Math.floor(next() * 5))}${next() < 0.3 ? ' ##' : ''}\n`,
      );
    } else if (kind < 0.24) {
      parts.push(
        `${pick(['```', '~~~', '   ```'])}\n# not a heading\n${words(Math.floor(next() * 30))}\n${pick(['```', '~~~'])}\n`,
      );
    } else if (kind < 0.3) {
      parts.push(pick(['\n', '\n\n', '\n\n\n', ' \n \n', '\t\n', '\r\n\r\n']));
    } else if (kind < 0.36) {
      // A word longer than any chunk it is cut with.
      parts.push(
        `${'Z'.repeat(1 + Math.floor(next() * 700))}${pick(['', ' ', '\n'])}`,
      );
    } else if (kind < 0.42) {
      // A line with no sentence end and no break.
      parts.push(words(20 + Math.floor(next() * 200)));
    } else if (kind < 0.47) {
      parts.push(' '.repeat(Math.floor(next() * 300)));
    } else if (kind < 0.52) {
      const line = `${words(3 + Math.floor(next() * 6))}\n`;
      parts.push(line.repeat(1 + Math.floor(next() * 40)));
    } else {
      const sentences = 1 + Math.floor(next() * 8);
      for (let sentence = 0; sentence < sentences; sentence += 1) {
        parts.push(
          `${words(1 + Math.floor(next() * 25))}${pick(['. ', '.\n', '! ', '? ', '\n', '.\n\n', ' '])}`,
        );
      }
    }
  }
  return parts.join('');
}

function randomOptions(next: () => number): ChunkOptions {
  const sizes = [8, 16, 40, 64, 128, 300, 1000, 2048];
  const overlaps = [0, 1, 5, 20, 64, 200, 5000];
  const titles = [
    undefined,
    '',
    '  ',
    'Handbook',
    `Long ${'title '.repeat(60)}`,
  ];
  return {
    chunkSize: sizes[Math.floor(next() * sizes.length)] ?? 64,
    chunkOverlap: overlaps[Math.floor(next() * overlaps.length)] ?? 0,
    title: titles[Math.floor(next() * titles.length)],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the chunks cut one at a time are the chunks the list-building chunker cut', () => {
  it('for two thousand documents of every shape, at every size', () => {
    const next = numbers(20_261_121);
    let chunks = 0;
    for (let round = 0; round < 2000; round += 1) {
      const text = randomDocument(next);
      const options = randomOptions(next);
      const expected = referenceChunks(text, options);
      const cut = [...chunksOf(text, options)];
      // Compared as one text, which is quick for the tens of thousands of
      // chunks this cuts; a difference is then shown chunk by chunk.
      if (JSON.stringify(cut) !== JSON.stringify(expected)) {
        const what = `round ${round} (${JSON.stringify(options)})`;
        for (const [at, chunk] of expected.entries()) {
          expect(cut[at], `${what}, chunk ${at}`).toEqual(chunk);
        }
        expect(cut.length, what).toBe(expected.length);
      }
      if (round % 100 === 0) {
        expect(chunkDocument(text, options)).toEqual(expected);
      }
      chunks += cut.length;
    }
    // The documents are long enough to be cut: this compared chunks, and
    // not two thousand empty lists.
    expect(chunks).toBeGreaterThan(50_000);
  });

  it('with the sizes a file is cut with, for documents of many chunks', () => {
    const next = numbers(4942);
    for (let round = 0; round < 12; round += 1) {
      const text = Array.from({ length: 30 }, () => randomDocument(next)).join(
        '\n\n',
      );
      const title = round % 2 === 0 ? 'report.pdf' : undefined;
      const expected = referenceChunks(text, { title });
      expect([...chunksOf(text, { title })]).toEqual(expected);
      expect(expected.length).toBeGreaterThan(3);
    }
  });

  it.each([
    ['nothing', ''],
    ['nothing at all', null],
    ['white space alone', ' \n\t \n'],
    ['one word', 'refund'],
    ['one heading', '# Refunds'],
    ['a text that ends where a paragraph ends', 'One.\n\nTwo.\n\n'],
    ['a fence that is never closed', '```\n# kept\ncode\n'],
    ['one unbroken run', 'Z'.repeat(5000)],
    ['a pair of surrogates at a cut', `${'a'.repeat(63)}😀${'b'.repeat(70)}`],
  ])('for %s', (_what, text) => {
    for (const chunkSize of [8, 64, 2048]) {
      const options = { chunkSize, chunkOverlap: 10, title: 'Doc' };
      expect([...chunksOf(text, options)]).toEqual(
        referenceChunks(text, options),
      );
    }
  });
});

describe('a chunk is cut when it is asked for', () => {
  /** Two thousand paragraphs, each a chunk's worth. */
  const LONG = Array.from(
    { length: 2000 },
    (_paragraph, at) =>
      `Paragraph ${at}. ${'It goes on for a while. '.repeat(70)}`,
  ).join('\n\n');

  // A chunk's body is trimmed once, when it is placed: the trims count the
  // bodies that exist. The heading pass reads every line of the document
  // before the first chunk and holds none of them, so it is not what is
  // counted here.
  it('hands over the first chunk of a long document without placing the rest', () => {
    const trims = vi.spyOn(String.prototype, 'trim');
    const chunks = chunksOf(LONG, { title: 'long.txt' });
    const first = chunks.next();
    const placedForOne = trims.mock.calls.length;
    trims.mockRestore();

    expect(first.done).toBe(false);
    expect(first.value?.index).toBe(0);
    expect(first.value?.text.startsWith('Paragraph 0.')).toBe(true);
    // The first body, the one after it, whose start ends the first chunk's
    // span, and the one held back to see that the second advances, beside
    // the two trims of the text and the title. The list-building chunker
    // placed two thousand.
    expect(placedForOne).toBeLessThan(8);
  });

  it('places one body for each chunk, however far into the document', () => {
    const chunks = chunksOf(LONG, { title: 'long.txt' });
    chunks.next();
    const trims = vi.spyOn(String.prototype, 'trim');
    const perChunk: number[] = [];
    for (let at = 0; at < 300; at += 1) {
      const before = trims.mock.calls.length;
      chunks.next();
      perChunk.push(trims.mock.calls.length - before);
    }
    trims.mockRestore();
    expect(Math.max(...perChunk)).toBeLessThanOrEqual(2);
    expect(perChunk.reduce((sum, count) => sum + count, 0)).toBeLessThan(310);
  });

  // The pieces a chunk is packed from are cut as they are packed. One
  // paragraph of twenty thousand sentences is cut at its sentences: every
  // piece is a slice of the text, and the heading pass, which reads the
  // text a line at a time, has three lines to read here.
  it('cuts only the pieces its next chunks are packed from', () => {
    const sentences = 20_000;
    const text = `An opening paragraph.\n\n${'It goes on. '.repeat(sentences)}`;
    const slices = vi.spyOn(String.prototype, 'slice');
    const chunks = chunksOf(text);
    const first = chunks.next();
    const second = chunks.next();
    const cut = slices.mock.calls.length;
    slices.mockRestore();

    expect(first.value?.text.startsWith('An opening paragraph.')).toBe(true);
    expect(second.value?.index).toBe(1);
    // Three or four chunks' worth of sentences, of the twenty thousand.
    expect(cut).toBeGreaterThan(100);
    expect(cut).toBeLessThan(sentences / 8);
  });

  it('stops where its reader stops', () => {
    let taken = 0;
    for (const chunk of chunksOf(LONG)) {
      taken += 1;
      if (chunk.index === 4) break;
    }
    expect(taken).toBe(5);
  });

  it('numbers the chunks from zero and ends with the list’s last chunk', () => {
    const listed = chunkDocument(LONG, { title: 'long.txt' });
    let last: ContextualChunk | undefined;
    let count = 0;
    for (const chunk of chunksOf(LONG, { title: 'long.txt' })) {
      expect(chunk.index).toBe(count);
      count += 1;
      last = chunk;
    }
    expect(count).toBe(listed.length);
    expect(last).toEqual(listed.at(-1));
    expect(count).toBeGreaterThan(1900);
  });
});
