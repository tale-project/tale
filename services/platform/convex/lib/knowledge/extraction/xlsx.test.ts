import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { extractTextFromXlsxBytes } from './xlsx';

function makeWorkbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}

describe('extractTextFromXlsxBytes', () => {
  it('extracts rows joined by pipes with a sheet header', async () => {
    const bytes = makeWorkbook({
      Sheet1: [
        ['A1', 'B1'],
        ['A2', 'B2'],
      ],
    });
    const [text, visionUsed] = await extractTextFromXlsxBytes(bytes);
    expect(text).toContain('--- Sheet: Sheet1 ---');
    expect(text).toContain('A1 | B1');
    expect(text).toContain('A2 | B2');
    expect(visionUsed).toBe(false);
  });

  it('skips fully empty rows', async () => {
    const bytes = makeWorkbook({
      Data: [
        ['x', 'y'],
        [null, null],
        ['z', 'w'],
      ],
    });
    const [text] = await extractTextFromXlsxBytes(bytes);
    const lines = text.split('\n').filter((l) => l.includes('|'));
    expect(lines).toHaveLength(2);
  });

  it('handles multiple sheets', async () => {
    const bytes = makeWorkbook({
      First: [['one']],
      Second: [['two']],
    });
    const [text] = await extractTextFromXlsxBytes(bytes);
    expect(text).toContain('--- Sheet: First ---');
    expect(text).toContain('--- Sheet: Second ---');
  });

  it('tolerates empty input without throwing', async () => {
    // Behavioral divergence from the previous openpyxl path: SheetJS is
    // format-tolerant and auto-detects CSV/TSV/etc., so it does not reject
    // arbitrary or empty bytes. Empty input yields an empty extraction.
    const [text, visionUsed] = await extractTextFromXlsxBytes(new Uint8Array());
    expect(text).toBe('');
    expect(visionUsed).toBe(false);
  });
});
