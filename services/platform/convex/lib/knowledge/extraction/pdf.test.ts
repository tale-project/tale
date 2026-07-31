import { describe, expect, it } from 'vitest';

import { extractTextFromPdfBytes, type PdfExtractionResult } from './pdf';

/**
 * Build a minimal single-page PDF whose content stream shows `text` via a
 * standard Helvetica font. Enough for pdfjs to extract the text — no external
 * PDF library needed.
 */
function makeTextPdf(text: string): Uint8Array {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  const stream = `BT /F1 24 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

describe('extractTextFromPdfBytes', () => {
  it('extracts digital text from a single-page PDF', async () => {
    const result = await extractTextFromPdfBytes(makeTextPdf('Hello World'));
    expect(result.text).toContain('Hello World');
    expect(result.visionUsed).toBe(false);
    expect(result.scannedPagesDetected).toBe(0);
    expect(result.ocrApplied).toBe(false);
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
  });

  it('invokes the progress callback per page', async () => {
    const calls: [number, number][] = [];
    await extractTextFromPdfBytes(makeTextPdf('progress'), 'doc.pdf', {
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls).toEqual([[1, 1]]);
  });
});
