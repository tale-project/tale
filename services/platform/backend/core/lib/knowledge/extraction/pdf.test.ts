import { describe, expect, it } from 'vitest';

import { extractTextFromPdfBytes, type PdfExtractionResult } from './pdf';
import { makeTextPdf } from './pdf.test-helpers';

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
