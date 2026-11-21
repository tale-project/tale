import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeTextPdf } from '../extraction/pdf.test-helpers';
import { sniffDocumentExtension } from '../extraction/sniff';
import { sniffDocumentFile } from './sniff_file';

/**
 * A file's kind told from the file is the kind told from its bytes: the
 * crawler and the drive import ask the file, which is on disk, where they
 * used to hold the whole download to ask it (tale-project/tale#4942).
 */

const WORKBOOK = fileURLToPath(
  new URL(
    '../../../../../tests/integration/fixtures/document-tools/workbook.xlsx',
    import.meta.url,
  ),
);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sniff-file-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * An Office file as its package names it: the part its content types file
 * calls the main one. `before` puts that much other content ahead of the
 * content types file, where some writers leave it.
 */
async function officeFile(
  mainType: string,
  part: string,
  before = 0,
): Promise<Uint8Array> {
  const zip = new JSZip();
  if (before > 0) {
    zip.file(`${part.split('/')[0]}/media/picture.bin`, new Uint8Array(before));
  }
  zip.file(part, '<x/>');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${mainType}.main+xml"/></Types>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

const WORD =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SLIDES =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** The bytes as a file, under a name that says nothing of what they are. */
function fileOf(name: string, bytes: Uint8Array): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, bytes);
  return filePath;
}

describe('sniffDocumentFile', () => {
  it.each([
    ['a workbook', () => new Uint8Array(readFileSync(WORKBOOK)), '.xlsx'],
    ['a PDF', () => makeTextPdf('The employee handbook'), '.pdf'],
    ['a Word document', () => officeFile(WORD, 'word/document.xml'), '.docx'],
    [
      'a presentation',
      () => officeFile(SLIDES, 'ppt/presentation.xml'),
      '.pptx',
    ],
    // Its content types file stands behind megabytes of other content: told
    // from the file's first bytes alone, it would be an archive of nothing.
    [
      'a Word document that names itself late',
      () => officeFile(WORD, 'word/document.xml', 3 * 1024 * 1024),
      '.docx',
    ],
    [
      'a table as text',
      () => new TextEncoder().encode('alpha,beta\n1,2\n'),
      null,
    ],
    [
      'an image',
      () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      null,
    ],
    ['nothing at all', () => new Uint8Array(), null],
  ])('reads %s as its bytes read', async (name, make, extension) => {
    const bytes = await make();

    const fromFile = await sniffDocumentFile(fileOf(`${name}.bin`, bytes));

    expect(fromFile).toBe(extension);
    expect(fromFile).toBe(await sniffDocumentExtension(bytes));
  });

  // A PDF says what it is in its first bytes, wherever its pages end.
  it('reads a long PDF as a PDF', async () => {
    const long = new Uint8Array(12 * 1024 * 1024).fill(0x20);
    long.set(makeTextPdf('A long report'), 0);

    expect(await sniffDocumentFile(fileOf('long.bin', long))).toBe('.pdf');
  });

  it('reads none from a file that is not there', async () => {
    const warned = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    expect(await sniffDocumentFile(path.join(dir, 'missing'))).toBeNull();
    expect(warned).toHaveBeenCalled();
    warned.mockRestore();
  });
});
