import { describe, expect, it } from 'vitest';

import {
  chunkDocument,
  HEADER_SEPARATOR,
  reassemble,
  type ContextualChunk,
} from './chunking';

/**
 * Two properties carry this module, and both are the kind that fail silently:
 * a chunk that does not say where it came from produces a confident wrong
 * answer, and a chunking that loses text produces a document nobody can read
 * back. So the tests check every chunk of several shaped documents, not one
 * happy path.
 */

const HANDBOOK = [
  '# Employment handbook',
  '',
  'Applies to everyone at the company.',
  '',
  '## Working time',
  '',
  'The weekly limit is 40 hours.',
  '',
  '### Overtime',
  '',
  'Overtime is approved in advance by a manager.',
  '',
  '## Leave',
  '',
  'Parental leave is 16 weeks.',
].join('\n');

function chunkAt(text: string, size: number, title?: string) {
  return chunkDocument(text, {
    chunkSize: size,
    chunkOverlap: Math.floor(size / 8),
    ...(title !== undefined && { title }),
  });
}

describe('contextual headers', () => {
  it('gives every chunk a header naming the document and its section', () => {
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.header).not.toBe('');
      expect(chunk.header.startsWith('Employment handbook')).toBe(true);
    }
  });

  it('names the heading path a chunk sits under', () => {
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    const overtime = chunks.find((chunk) =>
      chunk.text.includes('approved in advance'),
    );
    expect(overtime).toBeDefined();
    expect(overtime?.header).toBe(
      ['Employment handbook', 'Working time', 'Overtime'].join(
        HEADER_SEPARATOR,
      ),
    );
  });

  it('pops back out of a subsection when a sibling heading starts', () => {
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    const leave = chunks.find((chunk) => chunk.text.includes('16 weeks'));
    expect(leave?.header).toBe(
      ['Employment handbook', 'Leave'].join(HEADER_SEPARATOR),
    );
  });

  it('embeds and indexes the header together with the body', () => {
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    for (const chunk of chunks) {
      expect(chunk.embedText).toBe(`${chunk.header}\n\n${chunk.text}`);
    }
  });

  it('makes an out-of-context chunk say what it belongs to', () => {
    // The point of the whole feature: read one chunk with nothing around it and
    // it still identifies its document and section.
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    const limit = chunks.find((chunk) => chunk.text.includes('40 hours'));
    expect(limit?.embedText).toContain('Employment handbook');
    expect(limit?.embedText).toContain('Working time');
    expect(limit?.embedText).toContain('40 hours');
  });

  it('does not repeat a heading that merely restates the document title', () => {
    const chunks = chunkAt(
      '# Employment handbook\n\nApplies to everyone.',
      200,
      'Employment handbook',
    );
    expect(chunks[0].header).toBe('Employment handbook');
  });

  it('leaves the header empty when there is no title and no heading', () => {
    const chunks = chunkDocument('Just a sentence with no structure at all.');
    expect(chunks[0].header).toBe('');
    expect(chunks[0].embedText).toBe(chunks[0].text);
  });

  it('ignores a hash inside a fenced code block', () => {
    const text = [
      '# Guide',
      '',
      '```bash',
      '# not a heading, a shell comment',
      'echo hi',
      '```',
      '',
      'Body text.',
    ].join('\n');
    const chunks = chunkDocument(text, { title: 'Guide' });
    for (const chunk of chunks) {
      expect(chunk.header).not.toContain('shell comment');
    }
  });
});

describe('the document is recoverable', () => {
  const documents: Array<[string, string, number]> = [
    ['a structured handbook', HANDBOOK, 60],
    [
      'prose with no headings',
      'One. Two. Three. Four. Five. Six. '.repeat(20),
      50,
    ],
    ['text with wide gaps', '\n\n\nalpha\n\n\n\nbeta\n\n\n', 8],
    ['one unbroken run', 'x'.repeat(500), 64],
    ['a single short line', 'hello', 2048],
    ['combining characters and emoji', 'café 👩‍👩‍👧 naïve 漢字 '.repeat(40), 48],
  ];

  it.each(documents)(
    'reassembles %s exactly from the forward-owning spans',
    (_name, text, size) => {
      const chunks = chunkAt(text, size);
      expect(reassemble(chunks)).toBe(text);
    },
  );

  it('never lets two chunks own the same span', () => {
    const chunks = chunkAt(HANDBOOK, 60);
    let offset = 0;
    for (const chunk of chunks) {
      expect(HANDBOOK.slice(offset, offset + chunk.core.length)).toBe(
        chunk.core,
      );
      offset += chunk.core.length;
    }
    expect(offset).toBe(HANDBOOK.length);
  });

  it('keeps the header out of the reassembled text', () => {
    const chunks = chunkAt(HANDBOOK, 60, 'Employment handbook');
    expect(reassemble(chunks)).toBe(HANDBOOK);
    expect(reassemble(chunks)).not.toContain(HEADER_SEPARATOR);
  });
});

describe('overlap', () => {
  it('reports the text shared with each neighbour', () => {
    const chunks = chunkAt('One. Two. Three. Four. Five. Six. '.repeat(10), 60);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (i === 0) expect(chunk.prefixOverlap).toBe('');
      if (i === chunks.length - 1) expect(chunk.suffixOverlap).toBe('');
      if (chunk.prefixOverlap !== '') {
        expect(chunk.text.startsWith(chunk.prefixOverlap)).toBe(true);
      }
      if (chunk.suffixOverlap !== '') {
        expect(chunk.text.endsWith(chunk.suffixOverlap)).toBe(true);
      }
    }
  });

  it('advances through the document even when a segment exceeds the budget', () => {
    // A single word longer than the overlap budget used to let the carry
    // reproduce the previous chunk's start, which would give two chunks the
    // same span.
    const text = `${'y'.repeat(120)} tail `.repeat(6);
    const chunks = chunkAt(text, 64);
    expect(chunks.length).toBeGreaterThan(1);
    expect(reassemble(chunks)).toBe(text);
    // Every chunk owns a non-empty span: a chunk owning nothing means the
    // splitter stopped advancing and is emitting the same window forever.
    for (const chunk of chunks) expect(chunk.core.length).toBeGreaterThan(0);
  });

  it('numbers chunks from zero, in order', () => {
    const chunks = chunkAt(HANDBOOK, 60);
    expect(chunks.map((chunk: ContextualChunk) => chunk.index)).toEqual(
      chunks.map((_chunk, index) => index),
    );
  });
});

describe('nothing to chunk', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['only whitespace', '   \n\t  '],
  ])('returns no chunks for %s', (_name, text) => {
    expect(chunkDocument(text)).toEqual([]);
  });
});
