import {
  mkdtempSync,
  read as readDescriptor,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** The most bytes one read of a file hands back. A read may come back
 * short of what was asked for while the file has more (a network file
 * system, a signal): a test lowers this to have every read do so. */
const disk = vi.hoisted(() => ({ atMost: Number.POSITIVE_INFINITY }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const open: typeof actual.open = async (...args) => {
    const file = await actual.open(...args);
    Object.assign(file, {
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ) =>
        new Promise((resolve, reject) => {
          readDescriptor(
            file.fd,
            buffer,
            offset,
            Math.min(length, disk.atMost),
            position,
            (error, bytesRead) => {
              if (error === null) resolve({ bytesRead, buffer });
              else reject(error);
            },
          );
        }),
    });
    return file;
  };
  return { ...actual, default: { ...actual, open }, open };
});

import { DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS } from '../../../lib/shared/file-types';
import {
  attestDocumentContentType,
  attestDocumentSource,
} from './attest_document_bytes';
import { attestDocumentFile } from './attest_document_file';

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

/**
 * A Compound File whose directory and allocation table stand where the
 * header says, in a file of `sectors` sectors: not at its start, as in the
 * smallest one above.
 */
function spreadLegacyOfficeBytes(
  streamName: string,
  layout: { sectors: number; directory: number; table: number },
): Uint8Array {
  const bytes = new Uint8Array((layout.sectors + 1) * 512);
  bytes.fill(0xff, 76, 512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, layout.directory, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(68, 0xfffffffe, true);
  view.setUint32(76, layout.table, true);

  const directory = (layout.directory + 1) * 512;
  const writeName = (offset: number, name: string, objectType: number) => {
    for (let index = 0; index < name.length; index++) {
      view.setUint16(offset + index * 2, name.charCodeAt(index), true);
    }
    view.setUint16(offset + 64, (name.length + 1) * 2, true);
    view.setUint8(offset + 66, objectType);
  };
  writeName(directory, 'Root Entry', 5);
  writeName(directory + 128, streamName, 2);

  const table = (layout.table + 1) * 512;
  for (let entry = 0; entry < 128; entry++) {
    view.setUint32(table + entry * 4, 0xffffffff, true);
  }
  view.setUint32(table + layout.directory * 4, 0xfffffffe, true);
  view.setUint32(table + layout.table * 4, 0xfffffffd, true);
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

/**
 * A replacement document is attested where it is, in a file, and never read
 * whole (tale-project/tale#4942). What a file is told to be is what its
 * bytes are told to be: the same type, or the same refusal.
 */
describe('a document in a file is attested as its bytes are', () => {
  let dir: string;
  let files = 0;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'attest-file-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** What each attestation makes of the same bytes under the same name. */
  async function bothWays(
    bytes: Uint8Array,
    fileName: string,
  ): Promise<{ fromBytes: string; fromFile: string }> {
    const filePath = path.join(dir, `document-${(files += 1)}`);
    writeFileSync(filePath, bytes);
    const said = (attempt: Promise<string>): Promise<string> =>
      attempt.then(
        (mime) => mime,
        (error: unknown) =>
          `refused: ${error instanceof Error ? error.message : String(error)}`,
      );
    return {
      fromBytes: await said(attestDocumentContentType(bytes, fileName)),
      fromFile: await said(attestDocumentFile(filePath, fileName)),
    };
  }

  const text = (value: string): Uint8Array => encoder.encode(value);

  it.each<[string, string, () => Uint8Array | Promise<Uint8Array>, RegExp]>([
    [
      'a PDF',
      'file.pdf',
      () => text('%PDF-1.7\n%âãÏÓ\n'),
      /^application\/pdf$/,
    ],
    [
      'a Word package',
      'a.docx',
      () => officeXmlBytes('docx'),
      /wordprocessingml/,
    ],
    ['a workbook', 'a.xlsx', () => officeXmlBytes('xlsx'), /spreadsheetml/],
    ['slides', 'a.pptx', () => officeXmlBytes('pptx'), /presentationml/],
    ['an OpenDocument text', 'a.odt', () => odtBytes(), /opendocument\.text$/],
    [
      'an image',
      'a.png',
      () =>
        new Uint8Array(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWq5sAAAAASUVORK5CYII=',
            'base64',
          ),
        ),
      /^image\/png$/,
    ],
    [
      'a legacy Word file',
      'a.doc',
      () => legacyOfficeBytes('WordDocument'),
      /^application\/msword$/,
    ],
    // Its directory and its table are sectors into the file: read from the
    // disk where the header says they are.
    [
      'a legacy workbook whose directory stands far into the file',
      'a.xls',
      () =>
        spreadLegacyOfficeBytes('Workbook', {
          sectors: 100,
          directory: 71,
          table: 93,
        }),
      /^application\/vnd\.ms-excel$/,
    ],
    [
      'a legacy file of another kind',
      'a.xls',
      () => legacyOfficeBytes('WordDocument'),
      /^refused: /,
    ],
    [
      'a Compound File cut short',
      'a.doc',
      () => legacyOfficeBytes('WordDocument').subarray(0, 700),
      /^refused: /,
    ],
    ['a text', 'a.txt', () => text('plain UTF-8 text\n'), /^text\/plain$/],
    ['an empty text', 'a.txt', () => new Uint8Array(), /^text\/plain$/],
    [
      'a text that opens with a byte order mark',
      'a.csv',
      () => new Uint8Array([0xef, 0xbb, 0xbf, ...text('a,b\n')]),
      /^text\/csv$/,
    ],
    // Longer than one piece of a file, with characters of two, three and
    // four bytes that a piece's end cuts through.
    [
      'a long text of every width',
      'a.md',
      () => text('é€😀 – Grüße\n'.repeat(12_000)),
      /^text\/markdown$/,
    ],
    [
      'a text with a NUL far into it',
      'a.txt',
      () => {
        const bytes = text('line of text\n'.repeat(9_000));
        bytes[100_000] = 0;
        return bytes;
      },
      /^refused: /,
    ],
    [
      'a text that ends inside a character',
      'a.txt',
      () => text('line\n'.repeat(9_000) + 'é').subarray(0, 45_001),
      /^refused: /,
    ],
    [
      'a text with a stray byte far into it',
      'a.json',
      () => {
        const bytes = text('"line of text",\n'.repeat(9_000));
        bytes[120_000] = 0xff;
        return bytes;
      },
      /^refused: /,
    ],
    [
      'a text that is mostly control characters',
      'a.txt',
      () => text('\u0001\u0002a'.repeat(30_000)),
      /^refused: /,
    ],
    [
      'an opaque container',
      'a.ac2',
      () => new Uint8Array([0, 0x11, 0x22, 0x33]),
      /^application\/octet-stream$/,
    ],
    [
      'an opaque container that is a legacy Word file',
      'a.ac2',
      () => legacyOfficeBytes('WordDocument'),
      /^refused: /,
    ],
    [
      'a picture under a document name',
      'a.pdf',
      () => new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
      /^refused: /,
    ],
  ])('%s', async (_what, fileName, make, expected) => {
    const said = await bothWays(await make(), fileName);

    expect(said.fromFile).toBe(said.fromBytes);
    expect(said.fromFile).toMatch(expected);
  });

  // The line between text and not text is drawn by counting: one control
  // character in a hundred. A file is counted a piece at a time, and must
  // come to the same sum.
  it('draws the line between text and not text where its bytes draw it', async () => {
    const withControls = (controls: number): Uint8Array =>
      text('\u0001'.repeat(controls) + 'a'.repeat(100_000 - controls));

    expect(await bothWays(withControls(1_000), 'a.txt')).toEqual({
      fromBytes: 'text/plain',
      fromFile: 'text/plain',
    });
    const over = await bothWays(withControls(1_001), 'a.txt');
    expect(over.fromFile).toBe(over.fromBytes);
    expect(over.fromFile).toMatch(/^refused: /);
  });

  // A read may come back short of what was asked for while the file has
  // more. The directory of a legacy Office file is read at an offset, and
  // is read whole all the same; a text is decoded across pieces of any
  // length.
  it('reads on when the disk hands back less than it was asked for', async () => {
    disk.atMost = 7;
    try {
      expect(
        await bothWays(
          spreadLegacyOfficeBytes('Workbook', {
            sectors: 100,
            directory: 71,
            table: 93,
          }),
          'a.xls',
        ),
      ).toEqual({
        fromBytes: 'application/vnd.ms-excel',
        fromFile: 'application/vnd.ms-excel',
      });
      expect(
        await bothWays(text('é€😀 – Grüße\n'.repeat(400)), 'a.md'),
      ).toEqual({ fromBytes: 'text/markdown', fromFile: 'text/markdown' });
    } finally {
      disk.atMost = Number.POSITIVE_INFINITY;
    }
  });

  // A reader that fails has said nothing about the document.
  it('tells a reader that failed as its failure, not as a document of the wrong type', async () => {
    const gaveOut = new Error('EIO: i/o error, read');

    await expect(
      attestDocumentSource(
        {
          size: 32,
          detect: () => Promise.resolve(undefined),
          read: () => Promise.reject(gaveOut),
          async *pieces() {
            yield encoder.encode('the first piece ');
            throw gaveOut;
          },
        },
        'notes.txt',
      ),
    ).rejects.toBe(gaveOut);
  });

  it('answers the same for bytes of every kind, cut anywhere', async () => {
    // Pieces of text, control characters, NULs and stray bytes, to lengths
    // on both sides of a file's piece.
    const alphabet = [
      text('plain words '),
      text('é€😀'),
      text('\n'),
      new Uint8Array([0x01]),
      new Uint8Array([0xc3]),
      new Uint8Array([0xf0, 0x9f]),
    ];
    let seed = 4942;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    for (let round = 0; round < 60; round++) {
      const parts: Uint8Array[] = [];
      const pieces = 1 + next(6_000);
      for (let index = 0; index < pieces; index++) {
        // Mostly words: the odd bytes are the exception they are in a file.
        parts.push(
          alphabet[next(40) < 37 ? next(3) : 3 + next(3)] ?? alphabet[0]!,
        );
      }
      const bytes = Buffer.concat(parts);
      const said = await bothWays(bytes, 'a.txt');
      expect(said.fromFile, `round ${round}, ${bytes.byteLength} bytes`).toBe(
        said.fromBytes,
      );
    }
  });
});
