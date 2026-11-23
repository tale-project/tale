// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chunkDocument, chunksOf } from '../../../lib/knowledge/chunking';
import { prepareContent, prepareDocument } from './prepare';

/**
 * A document is prepared in two steps. Everything that decides whether it is
 * indexed — the secret scan, the organization's PII policy, whether it holds
 * any text — has run when `prepareContent` returns. Cutting it into chunks is
 * left to whoever reads them: the heavy slot's child writes each chunk to a
 * file as it is cut, and so never holds the chunks of a long document, which
 * are several times its text (tale-project/tale#4942).
 */

// A passthrough that counts the chunks the chunker has been asked for.
const cut = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../lib/knowledge/chunking', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../lib/knowledge/chunking')>();
  return {
    ...original,
    chunksOf: vi.fn(function* counted(
      ...args: Parameters<typeof original.chunksOf>
    ) {
      for (const chunk of original.chunksOf(...args)) {
        cut.count += 1;
        yield chunk;
      }
    }),
  };
});

beforeEach(() => {
  cut.count = 0;
  vi.mocked(chunksOf).mockClear();
});

/** Three hundred sections, each a chunk's worth, and in their middle an
 * export of one line repeated, which is cut into chunks of the same text. */
const SECTIONS = Array.from(
  { length: 300 },
  (_section, at) =>
    `Section ${at}. ${'The figures follow by region. '.repeat(60)}`,
);
const REPORT = [
  ...SECTIONS.slice(0, 150),
  'No orders were placed on this day.\n'.repeat(1500).trimEnd(),
  ...SECTIONS.slice(150),
].join('\n\n');

describe('a document prepared a chunk at a time', () => {
  it('has cut one chunk when it answers, and cuts each of the others when it is asked for', () => {
    const content = prepareContent({ text: REPORT, filename: 'report.txt' });
    expect(content.kind).toBe('ready');
    if (content.kind !== 'ready') return;
    // The first, which says that the document holds text at all.
    expect(cut.count).toBe(1);

    const chunks = content.chunks[Symbol.iterator]();
    expect(chunks.next().value?.chunk.index).toBe(0);
    expect(cut.count).toBe(1);
    expect(chunks.next().value?.chunk.index).toBe(1);
    expect(cut.count).toBe(2);
    expect(chunks.next().value?.chunk.index).toBe(2);
    expect(cut.count).toBe(3);
  });

  it('hands over the chunks of the text, in order, to the last', () => {
    const content = prepareContent({ text: REPORT, filename: 'report.txt' });
    if (content.kind !== 'ready') throw new Error('not ready');
    const handed = [...content.chunks].map(({ chunk }) => chunk);
    expect(handed).toEqual(chunkDocument(REPORT, { title: 'report.txt' }));
    expect(handed.length).toBeGreaterThan(250);
    expect(vi.mocked(chunksOf)).toHaveBeenCalledTimes(1);
  });

  it('marks a chunk whose text an earlier chunk has, and not the first to have it', () => {
    const content = prepareContent({ text: REPORT, filename: 'report.txt' });
    if (content.kind !== 'ready') throw new Error('not ready');
    const records = [...content.chunks];
    const firstWith = new Map<string, number>();
    for (const { chunk, repeat } of records) {
      const earlier = firstWith.get(chunk.text);
      expect(repeat, `chunk ${chunk.index}`).toBe(earlier !== undefined);
      if (earlier === undefined) firstWith.set(chunk.text, chunk.index);
    }
    // The export's line makes a run of chunks with one text: some chunks
    // repeat, most do not.
    const repeats = records.filter(({ repeat }) => repeat).length;
    expect(repeats).toBeGreaterThan(0);
    expect(repeats).toBeLessThan(records.length / 2);
  });

  it('names the document and hashes its text before a second chunk is cut', () => {
    const content = prepareContent({
      text: REPORT,
      filename: 'report.txt',
      title: 'Quarterly report',
    });
    if (content.kind !== 'ready') throw new Error('not ready');
    expect(content.filename).toBe('report.txt');
    expect(content.contentHash).toBe(computeContentHash(REPORT));
    expect(cut.count).toBe(1);
    const [first] = content.chunks;
    expect(first?.chunk.header).toBe('Quarterly report');
  });

  it.each([
    ['no text', ''],
    ['white space alone', ' \n\t\n '],
  ])('says a document of %s is empty, without a chunk', (_what, text) => {
    expect(prepareContent({ text, filename: 'blank.txt' })).toEqual({
      kind: 'empty',
    });
    expect(cut.count).toBe(0);
  });

  it('refuses a document whose bytes hold a credential before it cuts anything', () => {
    const content = prepareContent({
      text: REPORT,
      filename: 'notes.txt',
      scanned: {
        rejected: true,
        reason: 'This file looks like it contains a credential.',
      },
    });
    expect(content).toEqual({
      kind: 'refused',
      skipped: 'secret-detected',
      reason: 'This file looks like it contains a credential.',
    });
    expect(vi.mocked(chunksOf)).not.toHaveBeenCalled();
  });
});

describe('a document prepared whole', () => {
  it('lists what the chunk-at-a-time preparation hands over: the chunks, the repeats, the hash and the name', async () => {
    const args = { text: REPORT, filename: 'report.txt' };
    const content = prepareContent(args);
    if (content.kind !== 'ready') throw new Error('not ready');
    const records = [...content.chunks];

    const prepared = prepareDocument(args);
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') return;
    expect(prepared.contentHash).toBe(content.contentHash);
    expect(prepared.filename).toBe(content.filename);
    expect(prepared.chunks.total).toBe(records.length);
    expect(await prepared.chunks.window(0, records.length)).toEqual(records);
    expect(await prepared.chunks.window(40, 44)).toEqual(records.slice(40, 44));
  });
});
