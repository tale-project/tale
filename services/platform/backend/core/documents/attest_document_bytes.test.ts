import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS } from '../../../lib/shared/file-types';
import { attestDocumentContentType } from './attest_document_bytes';

const encoder = new TextEncoder();

async function officeXmlBytes(
  family: 'docx' | 'pptx' | 'xlsx',
): Promise<Uint8Array> {
  const definition = {
    docx: {
      part: 'word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    },
    pptx: {
      part: 'ppt/presentation.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    },
    xlsx: {
      part: 'xl/workbook.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    },
  }[family];
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${definition.part}" ContentType="${definition.contentType}"/></Types>`,
  );
  zip.file(definition.part, '<?xml version="1.0"?><root/>');
  return await zip.generateAsync({ type: 'uint8array' });
}

async function odtBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', {
    compression: 'STORE',
  });
  zip.file('content.xml', '<?xml version="1.0"?><office:document/>');
  return await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.oasis.opendocument.text',
  });
}

function legacyOfficeBytes(streamName: string): Uint8Array {
  const bytes = new Uint8Array(3 * 512);
  bytes.fill(0xff, 76, 512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 0, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(68, 0xfffffffe, true);
  view.setUint32(76, 1, true);

  const writeDirectoryEntry = (
    offset: number,
    name: string,
    objectType: number,
  ): void => {
    for (let index = 0; index < name.length; index++) {
      view.setUint16(offset + index * 2, name.charCodeAt(index), true);
    }
    view.setUint16(offset + name.length * 2, 0, true);
    view.setUint16(offset + 64, (name.length + 1) * 2, true);
    view.setUint8(offset + 66, objectType);
    view.setUint8(offset + 67, 1);
    view.setUint32(offset + 68, 0xffffffff, true);
    view.setUint32(offset + 72, 0xffffffff, true);
    view.setUint32(offset + 76, 0xffffffff, true);
    view.setUint32(offset + 116, 0xfffffffe, true);
  };
  writeDirectoryEntry(512, 'Root Entry', 5);
  writeDirectoryEntry(512 + 128, streamName, 2);

  for (let offset = 1024; offset < bytes.length; offset += 4) {
    view.setUint32(offset, 0xffffffff, true);
  }
  view.setUint32(1024, 0xfffffffe, true);
  view.setUint32(1028, 0xfffffffd, true);
  return bytes;
}

function legacyMarkerSpoof(streamName: string): Uint8Array {
  const bytes = new Uint8Array(512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  for (let index = 0; index < streamName.length; index++) {
    bytes[64 + index * 2] = streamName.charCodeAt(index);
  }
  return bytes;
}

describe('replacement byte-derived MIME attestation', () => {
  const attested: [string, Uint8Array, string][] = [
    [
      'file.pdf',
      new Uint8Array([
        ...encoder.encode('%PDF-1.7\n'),
        0x25,
        0xe2,
        0xe3,
        0xcf,
        0xd3,
      ]),
      'application/pdf',
    ],
    [
      'image.jpg',
      new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9]),
      'image/jpeg',
    ],
    [
      'photo.jpeg',
      new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9]),
      'image/jpeg',
    ],
    [
      'image.png',
      new Uint8Array(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWq5sAAAAASUVORK5CYII=',
          'base64',
        ),
      ),
      'image/png',
    ],
    ['image.gif', encoder.encode('GIF89a'), 'image/gif'],
    [
      'image.webp',
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56,
        0x50, 0x38, 0x20,
      ]),
      'image/webp',
    ],
    ['notes.txt', encoder.encode('plain UTF-8 text\n'), 'text/plain'],
    ['rows.csv', encoder.encode('name,value\nalpha,1\n'), 'text/csv'],
    // The text-typed working files the upload lane admits: a controlled
    // record of these types must be replaceable, so attest must know them.
    ['report.md', encoder.encode('# Report\n\nDone.\n'), 'text/markdown'],
    ['seed.json', encoder.encode('{"a":1}\n'), 'application/json'],
    ['policy.yaml', encoder.encode('key: value\n'), 'application/x-yaml'],
    ['policy.yml', encoder.encode('key: value\n'), 'application/x-yaml'],
    ['transform.py', encoder.encode('print("ok")\n'), 'text/x-python'],
    // The opaque vendor container: no signature to check, stored as bytes.
    [
      'ledger.ac2',
      new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]),
      'application/octet-stream',
    ],
    // The proprietary container may carry a generic signature (a ZIP or
    // gzip block, a Compound File without an Office stream) — none of them
    // is a document type another allowed extension claims, so the ledger
    // stays replaceable.
    [
      'zipped-ledger.ac2',
      encoder.encode('PK\u0003\u0004not an Office package'),
      'application/octet-stream',
    ],
    [
      'gzipped-ledger.ac2',
      new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]),
      'application/octet-stream',
    ],
    [
      'compound-ledger.ac2',
      legacyOfficeBytes('LedgerData'),
      'application/octet-stream',
    ],
    ['legacy.doc', legacyOfficeBytes('WordDocument'), 'application/msword'],
    ['legacy.xls', legacyOfficeBytes('Workbook'), 'application/vnd.ms-excel'],
    [
      'legacy.ppt',
      legacyOfficeBytes('PowerPoint Document'),
      'application/vnd.ms-powerpoint',
    ],
  ];

  it.each(attested)(
    'attests %s from its bytes',
    async (fileName, bytes, expected) => {
      await expect(attestDocumentContentType(bytes, fileName)).resolves.toBe(
        expected,
      );
    },
  );

  it('knows every extension the upload lane admits', () => {
    // The upload lane never attests, so a type it admits but this module
    // does not know uploads fine and can never be replaced: the controlled
    // record is frozen for good. Every allowed extension needs a passing
    // fixture above (the Office ZIP family has its own cases below).
    const covered = new Set(
      attested.map(([fileName]) => fileName.split('.').at(-1)),
    );
    for (const extension of ['docx', 'pptx', 'xlsx', 'odt']) {
      covered.add(extension);
    }
    const missing = [...DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS].filter(
      (extension) => !covered.has(extension),
    );
    expect(missing).toEqual([]);
  });

  it.each([
    [
      'replacement.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'replacement.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    [
      'replacement.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  ])('inspects the Office ZIP container for %s', async (fileName, expected) => {
    const extension = fileName.split('.').at(-1);
    if (extension !== 'docx' && extension !== 'pptx' && extension !== 'xlsx') {
      throw new Error('unexpected Office test extension');
    }
    await expect(
      attestDocumentContentType(await officeXmlBytes(extension), fileName),
    ).resolves.toBe(expected);
  });

  it('inspects the ODT mimetype entry', async () => {
    await expect(
      attestDocumentContentType(await odtBytes(), 'replacement.odt'),
    ).resolves.toBe('application/vnd.oasis.opendocument.text');
  });

  it.each([
    ['spoofed.pdf', encoder.encode('not a PDF')],
    ['spoofed.docx', encoder.encode('PK\u0003\u0004not an Office package')],
    ['spoofed.doc', legacyMarkerSpoof('WordDocument')],
    ['spoofed.txt', new Uint8Array([0, 1, 2, 3, 4])],
    ['spoofed.md', new Uint8Array([0, 1, 2, 3, 4])],
    ['spoofed.json', new Uint8Array([0xff, 0xd8, 0xff, 0xdb])],
    ['spoofed.ac2', new Uint8Array([0xff, 0xd8, 0xff, 0xdb])],
    ['spoofed-office.ac2', legacyOfficeBytes('WordDocument')],
    ['wrong-extension.pdf', new Uint8Array([0xff, 0xd8, 0xff, 0xdb])],
  ])('rejects spoofed bytes for %s', async (fileName, bytes) => {
    await expect(attestDocumentContentType(bytes, fileName)).rejects.toThrow(
      /UPLOAD_MIME_MISMATCH/,
    );
  });
});
