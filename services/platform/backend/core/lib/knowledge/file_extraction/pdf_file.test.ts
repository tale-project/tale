// A PDF read from a file on disk against the same PDF read from memory:
// the two must read the same, and the file must be let go of as it is read.

import {
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  extractTextFromPdfBytes,
  type PdfExtractionOptions,
  type PdfExtractionResult,
} from '../extraction/pdf';
import {
  makeIllustratedPdf,
  makePagedPdf,
  type IllustratedPage,
} from '../extraction/pdf.test-helpers';
import { extractTextFromPdfFile } from './pdf_file';
import { MemoryTextSink } from './text_sink';

/** A line long enough that its page is not one with almost no text. */
const PROSE = [
  'The quarterly figures follow, set out by region and by product line.',
];
const WHOLE_PAGE: [number, number] = [595, 842];
const A_CORNER: [number, number] = [150, 120];

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pdf-file-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function onDisk(bytes: Uint8Array): string {
  serial += 1;
  const file = path.join(dir, `document-${serial}.pdf`);
  writeFileSync(file, bytes);
  return file;
}

async function fromFile(
  bytes: Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const sink = new MemoryTextSink();
  const facts = await extractTextFromPdfFile(
    onDisk(bytes),
    sink,
    'document.pdf',
    options,
  );
  return { text: sink.text(), ...facts };
}

/** pdf.js takes the bytes it is given for its own: every read gets a copy. */
function fromBytes(
  bytes: Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  return extractTextFromPdfBytes(
    new Uint8Array(bytes),
    'document.pdf',
    options,
  );
}

describe('a PDF read from a file', () => {
  it('reads the text and the page count it reads from memory', async () => {
    const bytes = makePagedPdf(7);
    const read = await fromFile(bytes);
    expect(read).toEqual(await fromBytes(bytes));
    expect(read.pageCount).toBe(7);
    expect(read.text.split('\n\n')).toHaveLength(7);
    expect(read.text).toContain('--- Page 7 ---\nPage 7');
  });

  it('stops at the page limit it stops at from memory', async () => {
    const bytes = makePagedPdf(5);
    const read = await fromFile(bytes, { maxPages: 3 });
    expect(read).toEqual(await fromBytes(bytes, { maxPages: 3 }));
    expect(read.pageCount).toBe(5);
    expect(read.text).not.toContain('Page 4');
  });

  it('reports each page read, as from memory', async () => {
    const calls: [number, number][] = [];
    await fromFile(makePagedPdf(3), {
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it.each([
    ['nothing', new Uint8Array()],
    ['text that is no PDF', new TextEncoder().encode('not a PDF at all')],
  ])('refuses a file that holds %s as malformed', async (_what, bytes) => {
    await expect(fromFile(bytes)).rejects.toMatchObject({
      name: 'ExtractionError',
      code: 'malformed',
    });
    await expect(fromBytes(bytes)).rejects.toMatchObject({
      name: 'ExtractionError',
      code: 'malformed',
    });
  });

  it('counts the pages that are scans as it counts them from memory', async () => {
    const bytes = makeIllustratedPdf([
      { text: PROSE },
      { image: { pixels: [300, 400], painted: WHOLE_PAGE } },
      { text: ['Cover'], image: { pixels: [300, 400], painted: A_CORNER } },
    ]);
    const read = await fromFile(bytes);
    expect(read).toEqual(await fromBytes(bytes));
    expect(read.scannedPagesDetected).toBe(1);
  });

  it('counts them with a picture over the pixel budget, as from memory', async () => {
    const bytes = makeIllustratedPdf([
      { image: { pixels: [300, 400], painted: WHOLE_PAGE } },
      { text: ['Cover'], image: { pixels: [300, 400], painted: A_CORNER } },
    ]);
    const options = { maxImagePixels: 100_000 };
    const read = await fromFile(bytes, options);
    expect(read).toEqual(await fromBytes(bytes, options));
    expect(read.scannedPagesDetected).toBe(1);
  });

  // pdf.js keeps every range it has loaded until the document is closed, and
  // a page that shows a picture loads the picture's bytes even when it never
  // decodes them. Opening the document again is what bounds that.
  it('opens the document again once it has loaded its budget, and reads the same text', async () => {
    const pages: IllustratedPage[] = Array.from(
      { length: 24 },
      (_page, at) => ({
        text: [...PROSE, `This is page ${at + 1} of the report.`],
        image: {
          pixels: [200, 200],
          painted: A_CORNER,
          padToBytes: 200 * 200 * 3,
        },
      }),
    );
    const bytes = makeIllustratedPdf(pages);
    const file = onDisk(bytes);

    // The end of the file is what opening the document reads: the reads of
    // its last range count the times it was opened.
    const probe = await open(file, 'r');
    const handle: { read: (...args: never[]) => unknown } =
      Object.getPrototypeOf(probe);
    await probe.close();
    const reads = vi.spyOn(handle, 'read');
    try {
      const sink = new MemoryTextSink();
      await extractTextFromPdfFile(file, sink, 'report.pdf', {
        reopenAfterBytes: 150_000,
      });
      expect(sink.text()).toBe((await fromBytes(bytes)).text);
      const lastRange = bytes.length - (bytes.length % (64 * 1024));
      const opened = reads.mock.calls.filter(
        (call: unknown[]) => call[3] === lastRange,
      ).length;
      // Once at the start, and again at least once.
      expect(opened).toBeGreaterThanOrEqual(2);
    } finally {
      reads.mockRestore();
    }
  });

  // A page is found through the pages before it, where a PDF hangs them all
  // off one list: a document opened again loads its way back to where it
  // was. Opened again whenever it held more than its budget, it was opened
  // for every page once that way back cost the budget alone, and a file was
  // read hundreds of times over. Opened again only for what it loaded since,
  // and no sooner than that is worth the way back, it reads the file a few
  // times over, however long it is.
  it('reads a long PDF a few times over at most, however small its budget', async () => {
    const pages: IllustratedPage[] = Array.from(
      { length: 120 },
      (_page, at) => ({
        text: [...PROSE, `This is page ${at + 1} of the report.`],
        image: {
          pixels: [200, 200],
          painted: A_CORNER,
          padToBytes: 200 * 200 * 3,
        },
      }),
    );
    const bytes = makeIllustratedPdf(pages);
    const file = onDisk(bytes);

    const probe = await open(file, 'r');
    const handle: { read: (...args: never[]) => unknown } =
      Object.getPrototypeOf(probe);
    await probe.close();
    const reads = vi.spyOn(handle, 'read');
    try {
      const sink = new MemoryTextSink();
      const facts = await extractTextFromPdfFile(file, sink, 'report.pdf', {
        reopenAfterBytes: 150_000,
      });
      expect(facts.pageCount).toBe(120);
      expect(sink.text()).toContain('This is page 120 of the report.');
      const asked = reads.mock.calls.reduce(
        (sum, call: unknown[]) =>
          sum + (typeof call[2] === 'number' ? call[2] : 0),
        0,
      );
      // Opened again for every page, this read the file some sixty times.
      expect(asked).toBeLessThan(6 * bytes.length);
    } finally {
      reads.mockRestore();
    }
  });

  it('fails, and lets go of the file, when the file cannot be read part-way', async () => {
    const pages: IllustratedPage[] = Array.from(
      { length: 12 },
      (_page, at) => ({
        text: [...PROSE, `This is page ${at + 1} of the report.`],
        image: {
          pixels: [200, 200],
          painted: A_CORNER,
          padToBytes: 200 * 200 * 3,
        },
      }),
    );
    const file = onDisk(makeIllustratedPdf(pages));
    const probe = await open(file, 'r');
    const handle: { read: (...args: never[]) => Promise<unknown> } =
      Object.getPrototypeOf(probe);
    await probe.close();
    const real = handle.read;
    let asked = 0;
    const reads = vi.spyOn(handle, 'read').mockImplementation(function (
      this: unknown,
      ...args: never[]
    ) {
      asked += 1;
      return asked > 8
        ? Promise.reject(new Error('EIO: i/o error, read'))
        : Reflect.apply(real, this, args);
    });
    /** The descriptors this process holds on the file; Linux lists them. */
    const held = (): number =>
      process.platform === 'linux'
        ? readdirSync('/proc/self/fd').filter((fd) => {
            try {
              return readlinkSync(`/proc/self/fd/${fd}`) === file;
            } catch (error) {
              // The listing's own descriptor is gone by the time it is read.
              if (error instanceof Error && 'code' in error) return false;
              throw error;
            }
          }).length
        : 0;
    try {
      await expect(
        extractTextFromPdfFile(file, new MemoryTextSink(), 'report.pdf', {}),
      ).rejects.toThrow(
        'a range of the PDF could not be read: EIO: i/o error, read',
      );
      expect(asked).toBeGreaterThan(8);
      expect(held()).toBe(0);
    } finally {
      reads.mockRestore();
    }
  });
});
