// A document's text through the heavy slot, as the backend asks for it.
// Most of this suite starts real children, from the sources: what crosses
// the process boundary, and what a child is killed for, is the point.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import type { PiiConfig } from '@tale/shared/schemas/pii';
import JSZip from 'jszip';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as XLSX from 'xlsx';

import { prepareDocument } from '../../core/knowledge/prepare.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import { makePagedPdf } from '../../core/lib/knowledge/extraction/pdf.test-helpers.ts';
import { extractDocument } from '../../core/lib/knowledge/extraction/router.ts';
import {
  buildS3ObjectStore,
  type S3ObjectStore,
} from '../../core/lib/storage/object_store.ts';
import {
  DocumentMissingError,
  extractInHeavySlot,
  jobLabel,
  prepareInHeavySlot,
  readInHeavySlot,
  type DocumentSource,
} from './documents.ts';
import {
  keepJobDirsSwept,
  newJobDir,
  removeJobDir,
  sweepJobDirs,
} from './job-dir.ts';
import {
  configureHeavySlot,
  DEFAULT_HEAVY_SLOT_MEMORY_MB,
  DEFAULT_HEAVY_SLOTS,
  HeavyLimitError,
  heavySlotLoad,
  runHeavySlotInline,
} from './slot.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const bytesOf = (bytes: Uint8Array): DocumentSource => ({
  kind: 'bytes',
  bytes,
});

/** The job directories under the temporary directory. */
const jobDirs = (): string[] =>
  readdirSync(tmpdir())
    .filter((name) => name.startsWith('tale-heavy-'))
    .sort();

/** A store that holds one object, `null` for one that holds none. */
function storeHolding(object: Uint8Array | null): {
  kind: 'store';
  store: S3ObjectStore;
  key: string;
} {
  const store = buildS3ObjectStore(
    {
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'tale-blobs',
      region: 'us-east-1',
      forcePathStyle: true,
    },
    { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  );
  Object.assign(store.client, {
    fetch: vi.fn(() =>
      Promise.resolve(
        object === null
          ? new Response(null, { status: 404 })
          : new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(object);
                  controller.close();
                },
              }),
              { status: 200 },
            ),
      ),
    ),
  });
  return { kind: 'store', store, key: 'acme/doc' };
}

function spreadsheet(rows: unknown[][]): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

/** A text long enough to be cut into many chunks. */
const REPORT = Array.from(
  { length: 300 },
  (_line, at) =>
    `Section ${at}. ${'The figures follow by region. '.repeat(12)}`,
).join('\n\n');

const background = { priority: 'background' as const };
const interactive = { priority: 'interactive' as const };

// A temporary directory of this suite's own: what it finds there is what
// it left there, whatever the suites beside it are doing.
let ownTmp: string;
const systemTmp = process.env.TMPDIR;
beforeAll(() => {
  ownTmp = mkdtempSync(path.join(tmpdir(), 'heavy-slot-documents-'));
  process.env.TMPDIR = ownTmp;
});
afterAll(() => {
  if (systemTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = systemTmp;
  rmSync(ownTmp, { recursive: true, force: true });
});

let before: string[];
beforeEach(() => {
  // The server suites read a document in their own process; this one is
  // about the child, unless a case says otherwise.
  runHeavySlotInline(false);
  before = jobDirs();
});
afterEach(() => {
  runHeavySlotInline(false);
  configureHeavySlot({
    slots: DEFAULT_HEAVY_SLOTS,
    memoryMb: DEFAULT_HEAVY_SLOT_MEMORY_MB,
  });
  // Whatever a call made of its job, it leaves no files behind.
  expect(jobDirs()).toEqual(before);
});

describe.each([
  ['in a child', false],
  ['in this process', true],
])('a document read through the heavy slot, %s', (_where, inline) => {
  beforeEach(() => {
    runHeavySlotInline(inline);
  });

  it('reads the text and the facts the extractor reads from bytes', async () => {
    const pdf = makePagedPdf(3);
    expect(
      await extractInHeavySlot(bytesOf(pdf), 'report.pdf', background),
    ).toEqual(await extractDocument(new Uint8Array(pdf), 'report.pdf'));

    const sheet = spreadsheet([
      ['name', 'count'],
      ['alpha', 3],
    ]);
    expect(
      await extractInHeavySlot(bytesOf(sheet), 'table.xlsx', background),
    ).toEqual({
      text: '--- Sheet: Data ---\nname | count\nalpha | 3',
      visionUsed: false,
    });
  });

  // A caller that has the document in a file already (a page the crawler
  // fetched) hands over the file: it is read where it is, not copied, and
  // it is the caller's to remove (tale-project/tale#4942).
  it('reads a file its caller has on disk where it is, and leaves it there', async () => {
    const own = mkdtempSync(path.join(tmpdir(), 'caller-'));
    const filePath = path.join(own, 'body');
    writeFileSync(filePath, enc('Grüße — café, 東京, 😀'));
    try {
      expect(
        await extractInHeavySlot(
          { kind: 'file', path: filePath },
          'notes.txt',
          background,
        ),
      ).toEqual({ text: 'Grüße — café, 東京, 😀', visionUsed: false });
      expect(readFileSync(filePath, 'utf8')).toBe('Grüße — café, 東京, 😀');
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it('reads a stored object', async () => {
    expect(
      await extractInHeavySlot(
        storeHolding(enc('Grüße — café, 東京, 😀')),
        'notes.txt',
        interactive,
      ),
    ).toEqual({ text: 'Grüße — café, 東京, 😀', visionUsed: false });
  });

  it('says a stored object that is not there is missing', async () => {
    await expect(
      extractInHeavySlot(storeHolding(null), 'gone.txt', background),
    ).rejects.toBeInstanceOf(DocumentMissingError);
    await expect(
      prepareInHeavySlot(storeHolding(null), 'gone.txt', {
        ...background,
        piiConfig: null,
      }),
    ).rejects.toThrow('S3 GET acme/doc failed: 404 the object does not exist');
  });

  it("refuses a file an extractor refuses for good, with the extractor's own error", async () => {
    const binary = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff]);
    const refused = extractInHeavySlot(bytesOf(binary), 'tool.txt', background);
    await expect(refused).rejects.toBeInstanceOf(ExtractionError);
    await expect(refused).rejects.toMatchObject({
      code: 'not_text',
      message: expect.stringContaining('"tool.txt"'),
    });
    await expect(
      extractInHeavySlot(bytesOf(enc('not a PDF')), 'broken.pdf', background),
    ).rejects.toMatchObject({ name: 'ExtractionError', code: 'malformed' });
  });

  it('fails with what any other failure said', async () => {
    await expect(
      extractInHeavySlot(bytesOf(enc('x')), 'archive.zip', background),
    ).rejects.toThrow('Unsupported file type: .zip');
    await expect(
      extractInHeavySlot(bytesOf(enc('no archive')), 'letter.docx', background),
    ).rejects.toThrow('Invalid or corrupt file');
  });

  describe('for a reader who is waiting', () => {
    const limits = {
      ...interactive,
      maxBytes: 1024 * 1024,
      maxTextChars: 10_000,
      piiConfig: null,
    };

    it('hands on the text', async () => {
      expect(
        await readInHeavySlot(
          storeHolding(enc('A short note.')),
          'note.txt',
          limits,
        ),
      ).toEqual({
        kind: 'text',
        text: 'A short note.',
        facts: { visionUsed: false },
      });
    });

    it('answers the facts of the file beside its verdict', async () => {
      const read = await readInHeavySlot(
        storeHolding(makePagedPdf(2)),
        'two-pages.pdf',
        limits,
      );
      expect(read).toMatchObject({
        kind: 'text',
        facts: { pageCount: 2, scannedPagesDetected: 0 },
      });
    });

    it('says an object that is not there, or holds nothing, is missing', async () => {
      expect(
        await readInHeavySlot(storeHolding(null), 'gone.txt', limits),
      ).toEqual({ kind: 'missing' });
      expect(
        await readInHeavySlot(
          storeHolding(new Uint8Array()),
          'empty.txt',
          limits,
        ),
      ).toEqual({ kind: 'missing' });
    });

    it('takes no more bytes of the object than it was told', async () => {
      expect(
        await readInHeavySlot(storeHolding(enc('x'.repeat(2000))), 'big.txt', {
          ...limits,
          maxBytes: 1999,
        }),
      ).toEqual({ kind: 'too-large' });
      expect(
        await readInHeavySlot(storeHolding(enc('x'.repeat(2000))), 'big.txt', {
          ...limits,
          maxBytes: 2000,
        }),
      ).toMatchObject({ kind: 'text' });
    });

    it('hands on no more text than it was told', async () => {
      expect(
        await readInHeavySlot(storeHolding(enc('x'.repeat(2000))), 'big.txt', {
          ...limits,
          maxTextChars: 1999,
        }),
      ).toEqual({ kind: 'too-much', facts: { visionUsed: false } });
    });

    it('refuses a file that holds a credential', async () => {
      expect(
        await readInHeavySlot(
          storeHolding(enc('api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n')),
          'config.txt',
          limits,
        ),
      ).toEqual({
        kind: 'refused',
        skipped: 'secret-detected',
        facts: { visionUsed: false },
      });
    });

    it('says a file with no text is empty', async () => {
      expect(
        await readInHeavySlot(
          storeHolding(enc('  \n\t ')),
          'blank.txt',
          limits,
        ),
      ).toEqual({ kind: 'empty', facts: { visionUsed: false } });
    });
  });

  describe('made ready to index', () => {
    it('hands back the chunks and the hash this process would have made, from disk', async () => {
      const expected = prepareDocument({
        text: REPORT,
        bytes: enc(REPORT),
        filename: 'report.txt',
      });
      if (expected.kind !== 'ready') throw new Error('the report is ready');

      const file = await prepareInHeavySlot(
        bytesOf(enc(REPORT)),
        'report.txt',
        {
          ...background,
          piiConfig: null,
        },
      );
      try {
        expect(file.facts).toEqual({ visionUsed: false });
        if (file.prepared.kind !== 'ready') throw new Error('not ready');
        expect(file.prepared.contentHash).toBe(expected.contentHash);
        expect(file.prepared.filename).toBe('report.txt');
        expect(file.prepared.chunks.total).toBe(expected.chunks.total);
        expect(file.prepared.chunks.total).toBeGreaterThan(64);
        expect(await file.prepared.chunks.window(0, 64)).toEqual(
          await expected.chunks.window(0, 64),
        );
        expect(
          await file.prepared.chunks.window(64, expected.chunks.total),
        ).toEqual(await expected.chunks.window(64, expected.chunks.total));
        // Its chunks are on disk until they are let go.
        expect(jobDirs()).toHaveLength(before.length + 1);
      } finally {
        await file.release();
      }
    });

    it('titles the chunks as it is told', async () => {
      const file = await prepareInHeavySlot(bytesOf(enc(REPORT)), 'cv.txt', {
        ...background,
        piiConfig: null,
        title: 'Application — from A. Sender',
      });
      try {
        if (file.prepared.kind !== 'ready') throw new Error('not ready');
        const [first] = await file.prepared.chunks.window(0, 1);
        expect(first?.chunk.header).toBe('Application — from A. Sender');
      } finally {
        await file.release();
      }
    });

    it('prepares a text that was read already, as given', async () => {
      const expected = prepareDocument({ text: REPORT, filename: 'kept.txt' });
      if (expected.kind !== 'ready') throw new Error('the report is ready');
      const file = await prepareInHeavySlot(
        { kind: 'text', text: REPORT },
        'kept.txt',
        { ...background, piiConfig: null },
      );
      try {
        // Nothing was read off a file: there is nothing to say of one.
        expect(file.facts).toBeNull();
        if (file.prepared.kind !== 'ready') throw new Error('not ready');
        expect(file.prepared.contentHash).toBe(expected.contentHash);
        expect(await file.prepared.chunks.window(0, 5)).toEqual(
          await expected.chunks.window(0, 5),
        );
      } finally {
        await file.release();
      }
    });

    it('does not scan again a text that was given: its bytes were scanned when it was read', async () => {
      const text = 'api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n';
      const file = await prepareInHeavySlot(
        { kind: 'text', text },
        'kept.txt',
        {
          ...background,
          piiConfig: null,
        },
      );
      try {
        expect(file.prepared.kind).toBe('ready');
      } finally {
        await file.release();
      }
    });

    it('refuses a file that holds a credential, in words for its uploader', async () => {
      const file = await prepareInHeavySlot(
        bytesOf(enc('api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n')),
        'config.txt',
        { ...background, piiConfig: null },
      );
      expect(file.prepared).toEqual({
        kind: 'refused',
        skipped: 'secret-detected',
        reason:
          'This file looks like it contains a credential (secret keyword). Remove it and upload the file again.',
      });
      await file.release();
    });

    it('says a file with no text is empty, and what it is all the same', async () => {
      const file = await prepareInHeavySlot(
        bytesOf(enc('  \n\t ')),
        'blank.txt',
        { ...background, piiConfig: null },
      );
      expect(file.prepared).toEqual({ kind: 'empty' });
      expect(file.facts).toEqual({ visionUsed: false });
      await file.release();
    });

    it("applies the organization's PII policy to the text and to the name", async () => {
      const policy: PiiConfig = {
        enabled: true,
        mode: 'mask',
        enabledPatterns: ['email'],
      };
      const text = `Write to anna.keller@example.com about the offer.\n\n${REPORT}`;
      const expected = prepareDocument({
        text,
        bytes: enc(text),
        piiConfig: policy,
        filename: 'offer.txt',
      });
      if (expected.kind !== 'ready') throw new Error('the offer is ready');
      const file = await prepareInHeavySlot(bytesOf(enc(text)), 'offer.txt', {
        ...background,
        piiConfig: policy,
      });
      try {
        if (file.prepared.kind !== 'ready') throw new Error('not ready');
        expect(file.prepared.contentHash).toBe(expected.contentHash);
        const [first] = await file.prepared.chunks.window(0, 1);
        expect(first?.chunk.text).not.toContain('anna.keller@example.com');
        expect(first).toEqual((await expected.chunks.window(0, 1))[0]);
      } finally {
        await file.release();
      }
    });
  });
});

describe('a file that needs more than the cap', () => {
  // The child says so before it tries: it stops writing a text out where
  // the cap has no room to read it back, and answers that. No process is
  // stopped for it, on any system.
  it('fails with the limit and the setting that raises it, and leaves no files [KNOW-R22]', async () => {
    configureHeavySlot({ memoryMb: 96 });
    // Sixty megabytes of text: read whole to be chunked, it is far more
    // than a child may hold under 96 MiB.
    const large = Buffer.alloc(60 * 1024 * 1024, 'lorem ipsum dolor\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = prepareInHeavySlot(
      bytesOf(large),
      'Ledger of Anna Keller.txt',
      {
        ...background,
        piiConfig: null,
      },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    await expect(job).rejects.toMatchObject({
      limitMb: 96,
      message: expect.stringContaining('HEAVY_SLOT_MEMORY_MB'),
    });
    // One line for the operator, which names the kind of file and the
    // variable, and nothing of what the file is called.
    const said = warn.mock.calls.map(([line]) => String(line));
    warn.mockRestore();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      '[heavy-slot] reading a .txt file needs more than the 96 MiB one file is given and was not attempted',
    );
    expect(said[0]).toContain('HEAVY_SLOT_MEMORY_MB');
    expect(said[0]).not.toContain('Anna');
  }, 60_000);
});

describe('a text the cap has no room for', () => {
  // A sheet that says it is sixteen thousand columns wide makes a line of
  // fifty kilobytes of every row that shows something: twenty-two kilobytes
  // of workbook became two hundred megabytes of text. The reader is stopped
  // where the text passes what the cap could hold, and the job fails with
  // the limit, in a second, having filled no disk.
  it('stops a small workbook that states a vast range, with the limit', async () => {
    configureHeavySlot({ memoryMb: 128 });
    const rows = Array.from(
      { length: 4000 },
      (_row, at) =>
        `<row r="${at + 1}"><c r="A${at + 1}"><v>${at}</v></c></row>`,
    ).join('');
    const book = new JSZip();
    book.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    );
    book.file(
      'xl/workbook.xml',
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    book.file(
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    book.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData>${rows}</sheetData></worksheet>`,
    );
    const bytes = await book.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
    });
    expect(bytes.length).toBeLessThan(64 * 1024);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const started = Date.now();
    const job = prepareInHeavySlot(bytesOf(bytes), 'wide.xlsx', {
      ...background,
      piiConfig: null,
    });
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    await expect(job).rejects.toMatchObject({ limitMb: 128 });
    warn.mockRestore();
    // Stopped at the forty-eight megabytes a cap of 128 MiB has room for:
    // well before the two hundred it had to write.
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it('refuses a text it was given that the cap has no room for, before it reads it', async () => {
    configureHeavySlot({ memoryMb: 128 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Fifty-four megabytes of text under a cap with room for forty-eight
    // and its bytes beside it.
    const job = prepareInHeavySlot(
      { kind: 'text', text: 'lorem ipsum dolor\n'.repeat(3_000_000) },
      'kept.txt',
      { ...background, piiConfig: null },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('needs more than the 128 MiB one file is given'),
    );
    warn.mockRestore();
  }, 60_000);
});

describe('what a job is called', () => {
  // In the log and in an error, which an operator and a report both read:
  // the kind of file, and nothing of what its owner named it.
  it.each([
    ['Lebenslauf Anna Keller.PDF', 'reading a .pdf file'],
    ['orders.2025.csv', 'reading a .csv file'],
    ['notes', 'reading a file'],
    ['archive.tar.gz', 'reading a .gz file'],
    ['strange.extension-of-its-own', 'reading a file'],
    ['.env', 'reading a .env file'],
  ])('calls the job of %s "%s"', (fileName, label) => {
    expect(jobLabel(fileName)).toBe(label);
    expect(label).not.toContain('Anna');
  });
});

describe('a long file within the cap', () => {
  // A child holds a document's text once while it cuts it, and writes each
  // chunk as it is cut. Held as the lists of its pieces and of its chunks,
  // as it once was, this text is several times the cap. The characters
  // outside Latin-1 make every character two bytes in memory, which is what
  // a text from a word processor is. The cap is not the small host's 96 MiB:
  // a child of this suite runs from the sources, whose loader costs it some
  // 45 MiB more than the build, and `scripts/build-backend.test.ts` holds
  // the build to 96.
  it('prepares twelve megabytes of text under a cap its lists would not fit, to its last line', async () => {
    configureHeavySlot({ memoryMb: 128 });
    const line = 'The figures of the region follow, „as agreed“, for 20 €.\n';
    const lines = Math.ceil((12 * 1024 * 1024) / Buffer.byteLength(line));
    const readied = await prepareInHeavySlot(
      bytesOf(Buffer.from(line.repeat(lines))),
      'large.txt',
      { ...background, piiConfig: null },
    );
    try {
      expect(readied.prepared.kind).toBe('ready');
      if (readied.prepared.kind !== 'ready') return;
      const { chunks } = readied.prepared;
      expect(chunks.total).toBeGreaterThan(4000);
      const [first] = await chunks.window(0, 1);
      expect(first?.chunk.text.startsWith('The figures of the region')).toBe(
        true,
      );
      const [last] = await chunks.window(chunks.total - 1, chunks.total);
      expect(last?.chunk.index).toBe(chunks.total - 1);
      expect(last?.chunk.text.endsWith('„as agreed“, for 20 €.')).toBe(true);
    } finally {
      await readied.release();
    }
  }, 60_000);
});

describe('one job at a time', () => {
  it('has one child at work however many documents are asked for [KNOW-R23]', async () => {
    let most = 0;
    const watch = setInterval(() => {
      most = Math.max(most, heavySlotLoad().running);
    }, 5);
    try {
      const read = await Promise.all(
        ['first.pdf', 'second.pdf', 'third.pdf'].map((name) =>
          extractInHeavySlot(bytesOf(makePagedPdf(2)), name, background),
        ),
      );
      expect(read.map((document) => document.pageCount)).toEqual([2, 2, 2]);
    } finally {
      clearInterval(watch);
    }
    expect(most).toBe(1);
  });

  it('stops a job whose caller gives up while it waits or works', async () => {
    const caller = new AbortController();
    const job = extractInHeavySlot(bytesOf(makePagedPdf(40)), 'long.pdf', {
      ...background,
      signal: caller.signal,
    });
    caller.abort(new Error('the job was cancelled'));
    await expect(job).rejects.toThrow('the job was cancelled');
  });
});

describe('the job directories a process left behind', () => {
  const two_hours_ago = new Date(Date.now() - 2 * 60 * 60_000);
  /** What `/proc` says of when a process started, as a directory's name
   * carries it. */
  const startOf = (pid: number): string => {
    const line = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return line.slice(line.lastIndexOf(')') + 2).split(' ')[19] ?? '';
  };
  const machine = hostname()
    .replace(/[^A-Za-z0-9.]/g, '')
    .slice(0, 32);
  const made: string[] = [];
  const make = (name: string, old = false): string => {
    const dir = path.join(tmpdir(), name);
    mkdirSync(dir, { recursive: true });
    if (old) utimesSync(dir, two_hours_ago, two_hours_ago);
    made.push(dir);
    return name;
  };
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes one whose owner cannot be told once it is old, and leaves a new one', async () => {
    const stale = make('tale-heavy-test-stale', true);
    const live = make('tale-heavy-test-live');
    expect(await sweepJobDirs()).toBeGreaterThanOrEqual(1);
    expect(jobDirs()).not.toContain(stale);
    expect(jobDirs()).toContain(live);
    // With no age to wait for, the other goes too.
    expect(await sweepJobDirs(0)).toBeGreaterThanOrEqual(1);
    expect(jobDirs()).not.toContain(live);
  });

  // A process that is killed is started again within seconds: what it left
  // is seconds old then, and nobody's. The same process killed over and
  // over left a recording behind each time.
  describe.runIf(process.platform === 'linux')(
    'on a system that says which processes run',
    () => {
      it("names a job's directory after this process", async () => {
        const dir = await newJobDir();
        try {
          expect(
            path
              .basename(dir)
              .startsWith(
                `tale-heavy-${machine}-${process.pid}-${startOf(process.pid)}-`,
              ),
          ).toBe(true);
        } finally {
          await removeJobDir(dir);
        }
      });

      it('removes at once the directory of a process that is gone', async () => {
        // A process id this system does not have, and one it has, with a
        // start that is not that process's: the id was handed out again.
        const gone = make(`tale-heavy-${machine}-4194000-12345-AbCdEf`);
        const reused = make(`tale-heavy-${machine}-${process.ppid}-1-AbCdEf`);
        expect(await sweepJobDirs()).toBeGreaterThanOrEqual(2);
        expect(jobDirs()).not.toContain(gone);
        expect(jobDirs()).not.toContain(reused);
      });

      it('leaves the directory of a process that runs, however old', async () => {
        const running = make(
          `tale-heavy-${machine}-${process.ppid}-${startOf(process.ppid)}-AbCdEf`,
          true,
        );
        await sweepJobDirs(0);
        expect(jobDirs()).toContain(running);
      });

      it("leaves another machine's directory to its age", async () => {
        const young = make('tale-heavy-othermachine-4194000-12345-AbCdEf');
        const old = make('tale-heavy-othermachine-4194000-12345-GhIjKl', true);
        await sweepJobDirs();
        expect(jobDirs()).toContain(young);
        expect(jobDirs()).not.toContain(old);
      });

      it('leaves a job of this process that is at work, and removes one it forgot', async () => {
        const atWork = await newJobDir();
        utimesSync(atWork, two_hours_ago, two_hours_ago);
        // The same name as a job of this process would give it, and no job.
        const forgotten = make(
          `tale-heavy-${machine}-${process.pid}-${startOf(process.pid)}-AbCdEf`,
        );
        try {
          await sweepJobDirs(0);
          expect(jobDirs()).toContain(path.basename(atWork));
          expect(jobDirs()).not.toContain(forgotten);
        } finally {
          await removeJobDir(atWork);
        }
        expect(jobDirs()).not.toContain(path.basename(atWork));
      });
    },
  );

  it('looks now and keeps looking, until it is told to stop', async () => {
    const stale = make('tale-heavy-test-swept', true);
    const reported: number[] = [];
    const stop = keepJobDirsSwept((removed) => reported.push(removed));
    try {
      await vi.waitFor(() => expect(jobDirs()).not.toContain(stale));
      await vi.waitFor(() => expect(reported.length).toBe(1));
      expect(reported[0]).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
    }
  });
});

describe('letting go of a prepared document', () => {
  // The chunk files are opened when the first chunks are asked for. A job
  // whose files could not be opened still has a directory, with the
  // document's text in it.
  it("removes the job's files when its chunk files never opened", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const readied = await prepareInHeavySlot(
      bytesOf(enc(REPORT)),
      'report.txt',
      {
        ...background,
        piiConfig: null,
      },
    );
    if (readied.prepared.kind !== 'ready') throw new Error('not ready');
    const dir = jobDirs().find((name) => !before.includes(name));
    expect(dir).toBeDefined();
    rmSync(path.join(tmpdir(), dir ?? '', 'chunks.jsonl'));
    await expect(readied.prepared.chunks.window(0, 1)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await expect(readied.release()).resolves.toBeUndefined();
    expect(jobDirs()).toEqual(before);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be opened has nothing to close'),
    );
    warn.mockRestore();
  });

  it('can be let go of twice', async () => {
    const readied = await prepareInHeavySlot(
      bytesOf(enc(REPORT)),
      'report.txt',
      {
        ...background,
        piiConfig: null,
      },
    );
    await readied.release();
    await expect(readied.release()).resolves.toBeUndefined();
  });
});
