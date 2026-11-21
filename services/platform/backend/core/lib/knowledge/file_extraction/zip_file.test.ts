import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GuardedZip } from '../extraction/ooxml';
import { rawZip, type RawPart } from './zip.test-helpers';
import { openGuardedZip, openZipFile } from './zip_file';

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'guarded-zip-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function archive(
  parts: Record<string, string | Uint8Array>,
  options: JSZip.JSZipGeneratorOptions<'uint8array'> = { type: 'uint8array' },
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  return zip.generateAsync(options);
}

function onDisk(bytes: Uint8Array): string {
  serial += 1;
  const file = path.join(dir, `archive-${serial}.zip`);
  writeFileSync(file, bytes);
  return file;
}

/** The same archive, read from memory and from disk. */
async function bothWays(
  bytes: Uint8Array,
  maxUncompressed?: number,
): Promise<[string, GuardedZip][]> {
  return [
    ['from memory', await GuardedZip.load(bytes, maxUncompressed)],
    ['from disk', await openGuardedZip(onDisk(bytes), maxUncompressed)],
  ];
}

describe('an archive read from memory and from disk', () => {
  it('reads the same parts from memory and from disk', async () => {
    const bytes = await archive(
      {
        'word/document.xml': '<w:document>Zürich 東京</w:document>',
        'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 0, 255]),
        'empty.txt': '',
      },
      { type: 'uint8array', compression: 'DEFLATE' },
    );
    const listings: string[][] = [];
    for (const [how, zip] of await bothWays(bytes)) {
      // The archive's folders are parts of it too, either way.
      listings.push(zip.names().sort());
      expect(zip.names(), how).toEqual(
        expect.arrayContaining([
          'empty.txt',
          'word/document.xml',
          'word/media/image1.png',
        ]),
      );
      expect(await zip.readString('word/document.xml'), how).toBe(
        '<w:document>Zürich 東京</w:document>',
      );
      expect(await zip.readBytes('word/media/image1.png'), how).toEqual(
        new Uint8Array([137, 80, 78, 71, 0, 255]),
      );
      expect(await zip.readString('empty.txt'), how).toBe('');
      expect(await zip.readString('absent.xml'), how).toBeNull();
      expect(await zip.readBytes('absent.bin'), how).toBeNull();
      zip.close();
    }
    expect(listings[1]).toEqual(listings[0]);
  });

  it('refuses the part that takes it over the most it inflates, counting the parts before it', async () => {
    const bytes = await archive(
      { 'a.txt': 'x'.repeat(60), 'b.txt': 'y'.repeat(60) },
      { type: 'uint8array', compression: 'DEFLATE' },
    );
    for (const [how, zip] of await bothWays(bytes, 100)) {
      expect(await zip.readString('a.txt'), how).toHaveLength(60);
      await expect(zip.readString('b.txt'), how).rejects.toThrow(
        'File exceeds maximum decompressed size (120 bytes)',
      );
      zip.close();
    }
  });

  it('reads a part from disk without inflating the parts beside it', async () => {
    // A megabyte of zeros deflates to a kilobyte: under a cap of a thousand
    // bytes the small part is read, and the large one is refused by the
    // size it states, before a byte of it is inflated.
    const bytes = await archive(
      { 'small.txt': 'small', 'large.bin': new Uint8Array(1024 * 1024) },
      { type: 'uint8array', compression: 'DEFLATE' },
    );
    const zip = await openGuardedZip(onDisk(bytes), 1000);
    expect(await zip.readString('small.txt')).toBe('small');
    await expect(zip.readBytes('large.bin')).rejects.toThrow(
      'File exceeds maximum decompressed size (1048581 bytes)',
    );
    zip.close();
  });

  it('says a file that is no archive is invalid, from memory and from disk', async () => {
    const bytes = new TextEncoder().encode('this is not a zip');
    await expect(GuardedZip.load(bytes)).rejects.toThrow(
      'Invalid or corrupt file',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(openGuardedZip(onDisk(bytes))).rejects.toThrow(
        'Invalid or corrupt file',
      );
    } finally {
      warn.mockRestore();
    }
  });

  // JSZip reads an archive whose directory names a part twice, and keeps
  // the last; the reader by part refuses to choose. Such an archive is read
  // whole, so a document that was readable stays readable.
  it('reads whole an archive that names a part twice', async () => {
    const once = await archive({ 'a.txt': 'first', 'b.txt': 'other' });
    // The same bytes with the second part renamed to the first one's name:
    // two entries called `a.txt`.
    const twice = Buffer.from(once);
    let renamed = 0;
    for (
      let at = twice.indexOf('b.txt');
      at !== -1;
      at = twice.indexOf('b.txt', at + 1)
    ) {
      twice.write('a.txt', at, 'latin1');
      renamed += 1;
    }
    // Once in its local header and once in the directory.
    expect(renamed).toBe(2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fromDisk = await openGuardedZip(onDisk(twice));
      const fromMemory = await GuardedZip.load(twice);
      expect(fromDisk.names()).toEqual(fromMemory.names());
      expect(await fromDisk.readString('a.txt')).toBe(
        await fromMemory.readString('a.txt'),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('the archive names a.txt twice'),
      );
      fromDisk.close();
    } finally {
      warn.mockRestore();
    }
  });
});

// JSZip, which reads an archive from memory, and yauzl, which reads it from
// disk, do not file every archive's parts under the same names. Where they
// would differ the archive is not read by part at all: it is read whole, by
// JSZip, and so reads as it always did.
describe('an archive two readers would read differently', () => {
  const DOCUMENT = '<w:document>the text of the letter</w:document>';

  const CASES: [string, RawPart[], string][] = [
    [
      'a part named with a leading ./',
      [{ name: './word/document.xml', data: DOCUMENT }],
      'not plain',
    ],
    [
      'a part named with a doubled slash',
      [{ name: 'word//document.xml', data: DOCUMENT }],
      'not plain',
    ],
    [
      'a part named with a . in its path',
      [{ name: 'word/./document.xml', data: DOCUMENT }],
      'not plain',
    ],
    [
      'a part named with a backslash',
      [{ name: 'word\\document.xml', data: DOCUMENT }],
      'invalid characters in fileName',
    ],
    [
      'a part named outside ASCII without the flag that says UTF-8',
      [
        { name: 'word/document.xml', data: DOCUMENT },
        { name: 'word/média.xml', data: '<m/>', utf8Flag: false },
      ],
      'not in UTF-8',
    ],
    [
      'a part its own header calls something else',
      [
        {
          name: 'word/document.xml',
          ownName: 'word/other.xml',
          data: '<w:document>what the directory calls the document</w:document>',
        },
        {
          name: 'word/other.xml',
          ownName: 'word/document.xml',
          data: '<w:document>what its own header calls it</w:document>',
        },
      ],
      'differently in its two places',
    ],
  ];

  it.each(CASES)(
    'is not opened by part when it holds %s',
    async (_what, parts, why) => {
      await expect(openZipFile(onDisk(rawZip(parts)))).rejects.toThrow(why);
    },
  );

  it.each(CASES)(
    'reads from disk what it reads from memory when it holds %s',
    async (_what, parts) => {
      const bytes = rawZip(parts);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const fromMemory = await GuardedZip.load(bytes);
        const fromDisk = await openGuardedZip(onDisk(bytes));
        expect(fromDisk.names().sort()).toEqual(fromMemory.names().sort());
        for (const name of [
          'word/document.xml',
          'word/other.xml',
          ...fromMemory.names(),
        ]) {
          expect(await fromDisk.readString(name), name).toBe(
            await fromMemory.readString(name),
          );
        }
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('reading an archive whole'),
        );
        fromDisk.close();
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('opens by part an archive written plainly, names in UTF-8 included', async () => {
    const bytes = rawZip([
      { name: 'word/', data: '' },
      { name: 'word/document.xml', data: DOCUMENT },
      { name: 'word/média/图.xml', data: '<m/>' },
    ]);
    const { zip, entries } = await openZipFile(onDisk(bytes));
    try {
      expect([...entries.keys()]).toEqual([
        'word/',
        'word/document.xml',
        'word/média/图.xml',
      ]);
    } finally {
      zip.close();
    }
    const fromMemory = await GuardedZip.load(bytes);
    const fromDisk = await openGuardedZip(onDisk(bytes));
    expect(await fromDisk.readString('word/média/图.xml')).toBe(
      await fromMemory.readString('word/média/图.xml'),
    );
    expect(await fromDisk.readString('word/document.xml')).toBe(DOCUMENT);
    fromDisk.close();
  });
});
