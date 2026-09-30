import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { sniffDocumentExtension } from './sniff';

/**
 * The bytes decide what a download is when its declared type does not
 * (2026-09-30): the five documents the extraction router reads come back as
 * their extension, anything else as none.
 */
describe('sniffDocumentExtension', () => {
  it('names a workbook an XLSX whatever the server called it', async () => {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(
          '../../../../../tests/integration/fixtures/document-tools/workbook.xlsx',
          import.meta.url,
        ),
      ),
    );
    expect(await sniffDocumentExtension(bytes)).toBe('.xlsx');
  });

  it('names a PDF by its header', async () => {
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
    );
    expect(await sniffDocumentExtension(pdf)).toBe('.pdf');
  });

  it('reads none from text, an image, or nothing at all', async () => {
    expect(
      await sniffDocumentExtension(
        new TextEncoder().encode('alpha,beta\n1,2\n'),
      ),
    ).toBeNull();
    expect(
      await sniffDocumentExtension(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBeNull();
    expect(await sniffDocumentExtension(new Uint8Array())).toBeNull();
  });
});
