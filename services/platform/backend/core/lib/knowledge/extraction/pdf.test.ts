import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractTextFromPdfBytes,
  readPdf,
  type PdfExtractionOptions,
  type PdfExtractionResult,
} from './pdf';
import {
  makeIllustratedPdf,
  makePagedPdf,
  makeTextPdf,
} from './pdf.test-helpers';
import type { VisionClient } from './vision_client';

describe('extractTextFromPdfBytes', () => {
  it('extracts digital text from a single-page PDF', async () => {
    const result = await extractTextFromPdfBytes(makeTextPdf('Hello World'));
    expect(result.text).toContain('Hello World');
    expect(result.visionUsed).toBe(false);
    expect(result.scannedPagesDetected).toBe(0);
    expect(result.ocrApplied).toBe(false);
    expect(result.pageCount).toBe(1);
  });

  it('prefixes each page with a page marker', async () => {
    const result = await extractTextFromPdfBytes(
      makeTextPdf('Digital text only'),
    );
    expect(result.text).toContain('--- Page 1 ---');
    expect(result.text).toContain('Digital text only');
  });

  it('reports a typed result shape', async () => {
    const result: PdfExtractionResult = await extractTextFromPdfBytes(
      makeTextPdf('shape check'),
    );
    expect(typeof result.text).toBe('string');
    expect(typeof result.visionUsed).toBe('boolean');
    expect(typeof result.scannedPagesDetected).toBe('number');
    expect(typeof result.ocrApplied).toBe('boolean');
    expect(typeof result.pageCount).toBe('number');
  });

  it('invokes the progress callback per page', async () => {
    const calls: [number, number][] = [];
    await extractTextFromPdfBytes(makeTextPdf('progress'), 'doc.pdf', {
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([[1, 1]]);
  });
});

/** A line long enough that its page is not one with almost no text. */
const PROSE = [
  'The quarterly figures follow, set out by region and by product line.',
];
/** A picture painted over the whole page, and one in a corner of it. */
const WHOLE_PAGE: [number, number] = [595, 842];
const A_CORNER: [number, number] = [150, 120];

/** pdf.js takes the bytes it is given for its own: every read gets a copy. */
function read(
  bytes: Uint8Array,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  return extractTextFromPdfBytes(
    new Uint8Array(bytes),
    'document.pdf',
    options,
  );
}

describe('the pages of a PDF that are scans', () => {
  it('counts a page that is one picture and almost no text', async () => {
    const result = await read(
      makeIllustratedPdf([
        { text: PROSE },
        { image: { pixels: [300, 400], painted: WHOLE_PAGE } },
        {
          text: ['Figure 2'],
          image: { pixels: [300, 400], painted: WHOLE_PAGE },
        },
      ]),
    );
    expect(result.scannedPagesDetected).toBe(2);
    expect(result.pageCount).toBe(3);
    expect(result.visionUsed).toBe(false);
    expect(result.ocrApplied).toBe(false);
  });

  it('does not count a page with almost no text whose picture is small on it', async () => {
    const result = await read(
      makeIllustratedPdf([
        { text: ['Cover'], image: { pixels: [300, 400], painted: A_CORNER } },
      ]),
    );
    expect(result.scannedPagesDetected).toBe(0);
  });

  it('does not count a page of text, whatever it shows beside its text', async () => {
    const result = await read(
      makeIllustratedPdf([
        { text: PROSE, image: { pixels: [300, 400], painted: WHOLE_PAGE } },
      ]),
    );
    expect(result.scannedPagesDetected).toBe(0);
    expect(result.text).toContain(PROSE[0]);
  });

  describe('with a picture over the pixel budget', () => {
    // 300 by 400 is 120,000 pixels: over a budget of 100,000, so pdf.js
    // leaves the picture out of the page.
    const options: PdfExtractionOptions = { maxImagePixels: 100_000 };

    it('still counts the page it covers', async () => {
      const result = await read(
        makeIllustratedPdf([
          { image: { pixels: [300, 400], painted: WHOLE_PAGE } },
          {
            text: ['Plate 1'],
            image: { pixels: [300, 400], painted: WHOLE_PAGE },
          },
        ]),
        options,
      );
      expect(result.scannedPagesDetected).toBe(2);
    });

    it('still does not count a page it is small on', async () => {
      const result = await read(
        makeIllustratedPdf([
          {
            text: ['Cover'],
            image: { pixels: [300, 400], painted: A_CORNER },
          },
        ]),
        options,
      );
      expect(result.scannedPagesDetected).toBe(0);
    });

    it('counts a picture within the budget as it counts one with no budget', async () => {
      const result = await read(
        makeIllustratedPdf([
          { image: { pixels: [200, 300], painted: WHOLE_PAGE } },
          {
            text: ['Cover'],
            image: { pixels: [200, 300], painted: A_CORNER },
          },
        ]),
        options,
      );
      expect(result.scannedPagesDetected).toBe(1);
    });
  });
});

// pdf.js says that it left an image out in a console line and nowhere
// else, so the console is listened to while a page is read. The listening
// is the reading's own: it does not outlive it, it is not lost with a
// `console.warn` somebody else replaced, and it hears one page at a time.
describe('the listening for the images pdf.js leaves out', () => {
  const options: PdfExtractionOptions = { maxImagePixels: 100_000 };
  const scans = (count: number): Uint8Array =>
    makeIllustratedPdf(
      Array.from({ length: count }, () => ({
        image: { pixels: [300, 400] as [number, number], painted: WHOLE_PAGE },
      })),
    );
  /** Pages with almost no text and no picture: none of them is a scan. */
  const blanks = (count: number): Uint8Array =>
    makeIllustratedPdf(
      Array.from({ length: count }, (_page, at) => ({ text: [`p ${at + 1}`] })),
    );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves `console.warn` as it found it', async () => {
    const before = console.warn;
    await read(scans(2), options);
    expect(console.warn).toBe(before);
  });

  it('counts each document its own images when two are read side by side', async () => {
    const [text, pictures] = await Promise.all([
      read(blanks(12), options),
      read(scans(6), options),
    ]);
    expect(text.scannedPagesDetected).toBe(0);
    expect(pictures.scannedPagesDetected).toBe(6);
  });

  it('still counts after a `console.warn` that somebody replaced is put back', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await read(scans(2), options)).scannedPagesDetected).toBe(2);
    quiet.mockRestore();
    expect((await read(scans(3), options)).scannedPagesDetected).toBe(3);
    const again = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await read(scans(1), options)).scannedPagesDetected).toBe(1);
    again.mockRestore();
  });

  it('passes every line on to whoever listened before it', async () => {
    const heard: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
      heard.push(String(line));
    });
    await read(scans(1), options);
    expect(
      heard.some((line) => line.includes('exceeded maximum allowed size')),
    ).toBe(true);
  });
});

describe('a PDF whose bytes are read by ranges', () => {
  /** The bytes, handed over a range at a time, with every read counted. */
  function ranges(
    bytes: Uint8Array,
    hand: (begin: number, end: number, asked: number) => Promise<Uint8Array>,
  ) {
    let asked = 0;
    return {
      kind: 'ranges' as const,
      size: bytes.length,
      read: (begin: number, end: number) => {
        asked += 1;
        return hand(begin, end, asked);
      },
    };
  }

  it('reads what it reads from memory', async () => {
    const bytes = makePagedPdf(9);
    const pages: string[] = [];
    const facts = await readPdf(
      ranges(bytes, (begin, end) => Promise.resolve(bytes.slice(begin, end))),
      'paged.pdf',
      {},
      (page) => {
        pages.push(page);
        return Promise.resolve();
      },
    );
    const whole = await read(bytes);
    expect(pages.join('\n\n')).toBe(whole.text);
    expect(facts.pageCount).toBe(9);
  });

  // pdf.js cannot be told that a range it asked for will never come: what
  // it was doing waited for it for good, and the job with it.
  it.each([
    ['the first', 1],
    ['the third', 3],
    ['a later one', 6],
  ])('fails when %s range cannot be read', async (_which, failing) => {
    const bytes = makeIllustratedPdf(
      Array.from({ length: 8 }, (_page, at) => ({
        text: [...PROSE, `Page ${at + 1}.`],
        image: {
          pixels: [200, 200] as [number, number],
          painted: A_CORNER,
          padToBytes: 200 * 200 * 3,
        },
      })),
    );
    const reading = readPdf(
      ranges(bytes, (begin, end, asked) =>
        asked >= failing
          ? Promise.reject(new Error('the disk gave out'))
          : Promise.resolve(bytes.slice(begin, end)),
      ),
      'report.pdf',
      {},
      () => Promise.resolve(),
    );
    await expect(reading).rejects.toThrow(
      'a range of the PDF could not be read: the disk gave out',
    );
    // A fault of the place it is read from, not of the document.
    await expect(reading).rejects.not.toMatchObject({
      name: 'ExtractionError',
    });
  });

  // Wherever the reading stood when the range failed: listening for the
  // images of a page too. The next document is read as if nothing had been.
  it('reads the next PDF after one that could not be read, wherever it failed', async () => {
    // Pages of almost no text, each with a picture a long way into the
    // file: every page is looked at for its images, by ranges of its own.
    const bytes = makeIllustratedPdf(
      Array.from({ length: 6 }, (_page, at) => ({
        text: [`p ${at + 1}`],
        image: {
          pixels: [300, 400] as [number, number],
          painted: WHOLE_PAGE,
          padToBytes: 300 * 400 * 3,
        },
      })),
    );
    let failed = 0;
    for (let failing = 1; failing <= 12; failing += 1) {
      const outcome = await readPdf(
        ranges(bytes, (begin, end, asked) =>
          asked >= failing
            ? Promise.reject(new Error('the disk gave out'))
            : Promise.resolve(bytes.slice(begin, end)),
        ),
        'scans.pdf',
        { maxImagePixels: 100_000 },
        () => Promise.resolve(),
      ).then(
        (facts) => facts.scannedPagesDetected,
        (error: unknown) => (error instanceof Error ? error.message : ''),
      );
      if (typeof outcome === 'string') {
        failed += 1;
        expect(outcome).toContain('could not be read');
      } else {
        // The document needed fewer ranges than that: it was read.
        expect(outcome).toBe(6);
      }
      const next = await read(scansOf(2), { maxImagePixels: 100_000 });
      expect(next.scannedPagesDetected, `after range ${failing}`).toBe(2);
    }
    expect(failed).toBeGreaterThan(2);
  });
});

/** Pages that are one picture each. */
function scansOf(count: number): Uint8Array {
  return makeIllustratedPdf(
    Array.from({ length: count }, () => ({
      image: { pixels: [300, 400] as [number, number], painted: WHOLE_PAGE },
    })),
  );
}

describe('a PDF read for a vision client', () => {
  const vision: VisionClient = {
    ocrImage: (image) => Promise.resolve(`[read ${image.length} bytes]`),
    describeImage: (image) =>
      Promise.resolve(`a picture of ${image.length} bytes`),
  };

  it('describes a picture on a page of text, and reads a page that is a scan', async () => {
    const result = await read(
      makeIllustratedPdf([
        { text: PROSE, image: { pixels: [120, 100], painted: A_CORNER } },
        { image: { pixels: [120, 100], painted: WHOLE_PAGE } },
      ]),
      { visionClient: vision },
    );
    expect(result.visionUsed).toBe(true);
    expect(result.scannedPagesDetected).toBe(1);
    expect(result.ocrApplied).toBe(true);
    expect(result.text).toContain('[Image: a picture of');
    expect(result.text).toContain('--- Page 2 ---\n[read ');
  });

  // The pixel budget is pdf.js's to keep: a picture over it is never
  // decoded, so there is nothing of it to hand on. Without the budget the
  // same picture is decoded and described.
  it('hands the client no picture that is over the pixel budget', async () => {
    const seen: number[] = [];
    const watching: VisionClient = {
      ocrImage: (image) => Promise.resolve(`[read ${image.length} bytes]`),
      describeImage: (image) => {
        seen.push(image.length);
        return Promise.resolve('a picture');
      },
    };
    const page = (): Uint8Array =>
      makeIllustratedPdf([
        { text: PROSE, image: { pixels: [300, 400], painted: A_CORNER } },
      ]);

    const over = await read(page(), {
      visionClient: watching,
      maxImagePixels: 100_000,
    });
    expect(seen).toEqual([]);
    expect(over.text).not.toContain('[Image:');
    expect(over.text).toContain(PROSE[0]);

    const within = await read(page(), {
      visionClient: watching,
      maxImagePixels: 200_000,
    });
    expect(seen).toHaveLength(1);
    expect(within.text).toContain('[Image: a picture]');
  });

  it('leaves the pictures alone when told not to read them', async () => {
    const result = await read(
      makeIllustratedPdf([
        { text: PROSE, image: { pixels: [120, 100], painted: A_CORNER } },
      ]),
      { visionClient: vision, processImages: false },
    );
    expect(result.visionUsed).toBe(false);
    expect(result.text).not.toContain('[Image:');
  });
});
