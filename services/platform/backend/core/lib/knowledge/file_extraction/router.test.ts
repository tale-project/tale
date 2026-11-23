// The router's entry point for a file on disk against its entry point for
// bytes in memory: every format is read both ways and must read the same.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { buildDocx, para } from '../extraction/docx.test-helpers';
import {
  makeIllustratedPdf,
  makePagedPdf,
} from '../extraction/pdf.test-helpers';
import {
  buildPptx,
  buildSlideXml,
  buildTableSlideXml,
} from '../extraction/pptx.test-helpers';
import { extractDocument, type ExtractedDocument } from '../extraction/router';
import { extractDocumentFile } from './router';
import { MemoryTextSink } from './text_sink';

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'router-file-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function onDisk(bytes: Uint8Array): string {
  serial += 1;
  const file = path.join(dir, `file-${serial}`);
  writeFileSync(file, bytes);
  return file;
}

/** What a read ended with: the document, or the error it threw. */
type Outcome =
  | { document: ExtractedDocument }
  | { error: { name: string; message: string; code?: unknown } };

async function outcomeOf(
  read: () => Promise<ExtractedDocument>,
): Promise<Outcome> {
  try {
    return { document: await read() };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      error: {
        name: error.name,
        message: error.message,
        ...('code' in error ? { code: error.code } : {}),
      },
    };
  }
}

/** Read `bytes` under `name` from memory and from a file. */
async function bothWays(
  bytes: Uint8Array,
  name: string,
): Promise<{ fromBytes: Outcome; fromFile: Outcome }> {
  const quiet = [
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
  ];
  try {
    return {
      // A copy: a PDF's reader takes the bytes it is given for its own.
      fromBytes: await outcomeOf(() =>
        extractDocument(new Uint8Array(bytes), name),
      ),
      fromFile: await outcomeOf(async () => {
        const sink = new MemoryTextSink();
        const facts = await extractDocumentFile(onDisk(bytes), name, sink);
        return { text: sink.text(), ...facts };
      }),
    };
  } finally {
    for (const spy of quiet) spy.mockRestore();
  }
}

/** A document's facts with what it does not know left out, as a reader
 * that answers `undefined` for it and one that omits it must compare. */
function settled(outcome: Outcome): Outcome {
  return 'document' in outcome
    ? { document: JSON.parse(JSON.stringify(outcome.document)) }
    : outcome;
}

async function expectSame(bytes: Uint8Array, name: string): Promise<Outcome> {
  const { fromBytes, fromFile } = await bothWays(bytes, name);
  expect(settled(fromFile)).toEqual(settled(fromBytes));
  return fromFile;
}

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('a text file reads the same from a file', () => {
  it.each([
    ['plain text', enc('Hello, this is a test document.')],
    ['text in several scripts', enc('Grüße — café, 東京, Ελλάδα, 😀')],
    ['an empty file', new Uint8Array()],
    ['a file that opens with a byte order mark', enc('﻿with a mark')],
    ['a legacy encoding', Uint8Array.from([0x47, 0x72, 0xfc, 0xdf, 0x65])],
    [
      'a character cut off by the end of the file',
      Uint8Array.from([0x61, 0x62, 0xe6, 0x9d]),
    ],
    ['a NUL in text that is UTF-8', enc('before\u0000after')],
  ])('reads %s', async (_what, bytes) => {
    await expectSame(bytes, 'notes.txt');
  });

  it('refuses binary bytes as it refuses them from memory', async () => {
    const outcome = await expectSame(
      Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff]),
      'tool.txt',
    );
    expect(outcome).toMatchObject({
      error: { name: 'ExtractionError', code: 'not_text' },
    });
  });

  // The file is read a megabyte at a time: a character that straddles two
  // pieces, and a file whose last piece is what is not UTF-8.
  it('reads a character that straddles two pieces of the file', async () => {
    const piece = 1024 * 1024;
    const bytes = new Uint8Array(piece + 4).fill(0x61);
    // "東" is three bytes: one before the boundary, two after.
    bytes.set(enc('東'), piece - 1);
    const outcome = await expectSame(bytes, 'long.txt');
    expect(outcome).toMatchObject({
      document: { text: expect.stringContaining('a東aa') },
    });
  });

  it('starts over as Latin-1 when a late piece is not UTF-8', async () => {
    const piece = 1024 * 1024;
    const bytes = new Uint8Array(2 * piece + 3).fill(0x62);
    bytes[2 * piece + 1] = 0xfc;
    const outcome = await expectSame(bytes, 'legacy.csv');
    expect(outcome).toMatchObject({
      document: { text: expect.stringMatching(/^b{2097153}üb$/) },
    });
  });

  it('refuses a file whose late piece is binary', async () => {
    const piece = 1024 * 1024;
    const bytes = new Uint8Array(piece + 8).fill(0x62);
    bytes.set([0xff, 0x00, 0xfe], piece + 2);
    const outcome = await expectSame(bytes, 'dump.log');
    expect(outcome).toMatchObject({ error: { code: 'not_text' } });
  });
});

describe('a document reads the same from a file', () => {
  it('reads a PDF, with its pages counted', async () => {
    const outcome = await expectSame(makePagedPdf(4), 'report.pdf');
    expect(outcome).toMatchObject({
      document: { pageCount: 4, scannedPagesDetected: 0, visionUsed: false },
    });
  });

  it('reads a PDF with scanned pages, counted', async () => {
    const outcome = await expectSame(
      makeIllustratedPdf([
        { text: ['A line of text that is long enough to be a page of text.'] },
        { image: { pixels: [200, 300], painted: [595, 842] } },
      ]),
      'scan.pdf',
    );
    expect(outcome).toMatchObject({
      document: { pageCount: 2, scannedPagesDetected: 1 },
    });
  });

  it('refuses a PDF that does not parse, as from memory', async () => {
    const outcome = await expectSame(enc('not a PDF'), 'broken.pdf');
    expect(outcome).toMatchObject({ error: { code: 'malformed' } });
  });

  it('reads a Word document, with its tables, headers and footers', async () => {
    const outcome = await expectSame(
      await buildDocx(
        `${para('First paragraph')}<w:tbl><w:tr><w:tc>${para('a')}</w:tc><w:tc>${para('b')}</w:tc></w:tr></w:tbl>${para('Last paragraph')}`,
        { headers: ['Company header'], footers: ['Page footer'] },
      ),
      'letter.docx',
    );
    expect(outcome).toMatchObject({
      document: { text: expect.stringContaining('[Header]\nCompany header') },
    });
  });

  it('reads a deck, slide by slide', async () => {
    const outcome = await expectSame(
      await buildPptx([
        buildSlideXml(['Title', 'Subtitle']),
        buildTableSlideXml([
          ['h1', 'h2'],
          ['a', 'b'],
        ]),
      ]),
      'deck.pptx',
    );
    expect(outcome).toMatchObject({
      document: { text: expect.stringContaining('--- Slide 2 ---') },
    });
  });

  it('reads an OpenDocument text', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    zip.file(
      'content.xml',
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h>Heading</text:h><text:p>A paragraph of text.</text:p></office:text></office:body></office:document-content>',
    );
    const outcome = await expectSame(
      await zip.generateAsync({ type: 'uint8array' }),
      'note.odt',
    );
    expect(outcome).toMatchObject({
      document: { text: expect.stringContaining('A paragraph of text.') },
    });
  });

  it.each(['letter.docx', 'deck.pptx', 'note.odt'])(
    'refuses a %s that is no archive, as from memory',
    async (name) => {
      const outcome = await expectSame(enc('not an archive'), name);
      expect(outcome).toMatchObject({
        error: { message: 'Invalid or corrupt file' },
      });
    },
  );

  it('reads a spreadsheet', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['name', 'count'],
        ['alpha', 3],
      ]),
      'Data',
    );
    const outcome = await expectSame(
      new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })),
      'table.xlsx',
    );
    expect(outcome).toEqual({
      document: {
        text: '--- Sheet: Data ---\nname | count\nalpha | 3',
        visionUsed: false,
      },
    });
  });

  it('answers nothing for a picture, as from memory with no vision client', async () => {
    const outcome = await expectSame(
      Uint8Array.from([137, 80, 78, 71]),
      'photo.png',
    );
    expect(outcome).toEqual({ document: { text: '', visionUsed: false } });
  });

  it('refuses a type it has no reader for, as from memory', async () => {
    const outcome = await expectSame(enc('x'), 'archive.zip');
    expect(outcome).toMatchObject({
      error: { message: 'Unsupported file type: .zip' },
    });
  });

  it.each([
    ['a name in capitals', 'ARCHIVE.ZIP', 'Unsupported file type: .zip'],
    ['a name with no extension', 'README', 'Unsupported file type: '],
    ['a name that is all extension', '.gitignore', 'Unsupported file type: '],
  ])(
    'refuses %s in the words it is refused in from memory',
    async (_what, name, message) => {
      const outcome = await expectSame(enc('x'), name);
      expect(outcome).toMatchObject({ error: { message } });
    },
  );
});
