// @vitest-environment node

/**
 * The read of a document for the assistant, ahead of its index
 * (`read-text.ts`) — on a worker, never in the api process.
 *
 * A message carrying a document used to wait for the document's whole
 * index, so the embedding server and every upload queued before it decided
 * whether a chat could be sent. What is pinned here: an upload's door queues
 * a read and marks it; the read extracts the file with the indexer's own
 * extractor, checks it under the organization's policy (strictly — a policy
 * that cannot be read is no green light), keeps the checked text in the
 * organization's knowledge database — never in the app database — or
 * records why there is none, and hands the file's index run on in the same
 * transaction as its verdict; a document too large for a read is left to
 * its index, which then goes first; a failure it cannot name leaves the file
 * to its index instead of holding the message; a reader can ask for the read
 * of a file nothing has read yet, and for a read again once a passing fault
 * may have decided it; and the read watchdog settles a read whose job is
 * lost, so no message waits on it for good.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  READ_WITHOUT_INDEX_MAX_BYTES,
  READ_WITHOUT_INDEX_MAX_SPREADSHEET_BYTES,
  READ_WITHOUT_INDEX_MAX_TEXT,
} from '../../../lib/shared/file-types.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import {
  PRIORITY_ATTACHMENT,
  PRIORITY_INTERACTIVE,
} from '../../jobs/enqueue.ts';

const {
  addJobInTx,
  getBytes,
  readPolicy,
  extractDocument,
  gate,
  stamp,
  keepReadText,
  dropKeptText,
} = vi.hoisted(() => ({
  addJobInTx: vi.fn(),
  getBytes: vi.fn(),
  readPolicy: vi.fn(),
  extractDocument: vi.fn(),
  gate: vi.fn(),
  stamp: vi.fn(),
  keepReadText: vi.fn(),
  dropKeptText: vi.fn(),
}));

vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx,
}));
vi.mock('../../lib/object-store.ts', () => ({
  locateOrgObjectStore: () => Promise.resolve({ bucket: 'acme' }),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytesIfExists: getBytes,
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug: () => Promise.resolve('acme'),
  readGovernancePolicy: readPolicy,
}));
vi.mock(
  '../../core/lib/knowledge/extraction/router.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../core/lib/knowledge/extraction/router.ts')
    >()),
    extractDocument,
  }),
);
vi.mock('../../core/knowledge/indexing.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/indexing.ts')
  >()),
  gateDocumentText: gate,
}));
vi.mock('./extraction-metadata.ts', () => ({
  stampExtractionMetadata: stamp,
}));
vi.mock('../../core/knowledge/kept_reads.ts', () => ({
  keepReadText,
  dropKeptText,
  readKeptText: vi.fn(),
}));

const {
  queueDocumentRead,
  readUploadedFileText,
  recoverStuckReads,
  requestDocumentRead,
} = await import('./read-text.ts');

interface Statement {
  readonly text: string;
  readonly values: unknown[];
}

interface FileRow {
  storageRef: string;
  fileName: string;
  contentType: string;
  size: number;
}

interface AskedRow {
  id: string;
  fileName: string;
  contentType: string;
  textStatus: string | null;
  textErrorCode?: string | null;
  textReadAtMs?: number | null;
  ragStatus?: string | null;
}

/**
 * Scripted `sql`. The claim answers `claimed` (the read still queued or
 * running, or none); the settle answers the row's index state as the
 * statement reads it (`ragStatus`, NULL for a file that skips indexing), and
 * a settle that finds the row decided meanwhile reads it as `current`; the
 * reader's ask answers `asked`; the watchdog's walk answers `stuck`, and its
 * probe for a waiting index job `indexJobWaiting`.
 */
function fakeSql(options: {
  claimed?: FileRow | null;
  ragStatus?: string | null;
  settles?: boolean;
  current?: { textStatus: string | null; ragStatus: string | null } | null;
  asked?: AskedRow | null;
  stuck?: string[];
  indexJobWaiting?: boolean;
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (
      text.startsWith("UPDATE app.file_metadata SET text_status = 'running'")
    ) {
      return Promise.resolve(options.claimed ? [options.claimed] : []);
    }
    if (text.startsWith('SELECT fm.id FROM app.file_metadata fm')) {
      return Promise.resolve((options.stuck ?? []).map((id) => ({ id })));
    }
    if (text.includes('FROM pgboss.job')) {
      return Promise.resolve(options.indexJobWaiting ? [{ found: 1 }] : []);
    }
    if (text.startsWith('SELECT text_status AS "textStatus"')) {
      return Promise.resolve(options.current ? [options.current] : []);
    }
    if (text.includes('RETURNING CASE WHEN skip_rag_indexing')) {
      return Promise.resolve(
        options.settles === false
          ? []
          : [
              {
                ragStatus:
                  options.ragStatus === undefined
                    ? 'queued'
                    : options.ragStatus,
              },
            ],
      );
    }
    if (text.includes('FOR UPDATE')) {
      return Promise.resolve(options.asked ? [options.asked] : []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (raw: string) => raw,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const JOB = { fileId: 'file-1', organizationId: 'org-1', thenIndex: true };

function pdf(over: Partial<FileRow> = {}): FileRow {
  return {
    storageRef: 's3:tale/acme/7f3c-report',
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    size: 2048,
    ...over,
  };
}

/** The settle: the verdict's write, and the values it wrote. The text
 * itself is never among them: it goes to the knowledge database. */
function settled(statements: Statement[]) {
  const write = statements.find((s) =>
    s.text.includes('RETURNING CASE WHEN skip_rag_indexing'),
  );
  if (write === undefined) return undefined;
  const [status, code] = write.values;
  return { status, code, text: write.text, values: write.values };
}

beforeEach(() => {
  vi.clearAllMocks();
  keepReadText.mockResolvedValue(undefined);
  dropKeptText.mockResolvedValue(undefined);
  getBytes.mockResolvedValue(new TextEncoder().encode('%PDF-1.7 report'));
  extractDocument.mockResolvedValue({ text: 'Quarterly revenue rose.' });
  readPolicy.mockResolvedValue(null);
  gate.mockImplementation(({ text }: { text: string }) => ({
    kind: 'text',
    text,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queueDocumentRead — the upload door’s read', () => {
  it('marks the read queued and queues it ahead of other uploads, index after', async () => {
    const { sql, statements } = fakeSql({});
    await queueDocumentRead(sql, { fileId: 'file-1', organizationId: 'org-1' });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain("text_status = 'queued'");
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.read_file',
      { fileId: 'file-1', organizationId: 'org-1', thenIndex: true },
      { priority: PRIORITY_ATTACHMENT },
    );
  });
});

describe('readUploadedFileText — one read, decided [CHAT-R47] [CHAT-R48]', () => {
  it('keeps the checked text and hands the index on in the same transaction', async () => {
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);

    expect(extractDocument).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'report.pdf',
    );
    // What the extraction learned about the file is stamped by the read,
    // which the index then starts from.
    expect(stamp).toHaveBeenCalledWith(sql, 'file-1', {
      text: 'Quarterly revenue rose.',
    });
    // Strict: an unreadable policy must never read as no policy.
    expect(readPolicy).toHaveBeenCalledWith('acme', 'pii_config', {
      strict: true,
    });
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Quarterly revenue rose.',
        filename: 'report.pdf',
        bytes: expect.any(Uint8Array),
      }),
    );
    // The text goes to the organization's knowledge database, before the
    // verdict that sends a reader to it.
    expect(keepReadText).toHaveBeenCalledWith(
      'acme',
      's3:tale/acme/7f3c-report',
      'Quarterly revenue rose.',
    );
    expect(settled(statements)).toMatchObject({ status: 'ready', code: null });
    expect(settled(statements)?.text).not.toContain('text_content');
    expect(settled(statements)?.values).not.toContain(
      'Quarterly revenue rose.',
    );
    // Only a read still running is settled.
    expect(settled(statements)?.text).toContain("text_status = 'running'");
    // Nobody waits for this index any more: it queues like any upload, and
    // its clock starts now.
    expect(
      statements.some((s) => s.text.includes('SET rag_queued_at_ms')),
    ).toBe(true);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.index_file',
      { fileId: 'file-1' },
      { priority: PRIORITY_INTERACTIVE },
    );
    expect(dropKeptText).not.toHaveBeenCalled();
  });

  it('drops the kept text when the index completed while an upload was read', async () => {
    const { sql } = fakeSql({ claimed: pdf(), ragStatus: 'completed' });
    await readUploadedFileText(sql, JOB);
    expect(keepReadText).toHaveBeenCalledTimes(1);
    expect(dropKeptText).toHaveBeenCalledWith('acme', [
      's3:tale/acme/7f3c-report',
    ]);
  });

  it('keeps the text a reader asked for, however the index stands', async () => {
    // The on-demand lane asks only for a file the corpus does not serve.
    const { sql } = fakeSql({ claimed: pdf(), ragStatus: 'completed' });
    await readUploadedFileText(sql, { ...JOB, thenIndex: false });
    expect(keepReadText).toHaveBeenCalledTimes(1);
    expect(dropKeptText).not.toHaveBeenCalled();
  });

  it('drops the kept text of a read settled meanwhile, unless a newer read keeps the same', async () => {
    for (const [current, dropped] of [
      [null, true],
      [{ textStatus: 'deferred', ragStatus: 'queued' }, true],
      [{ textStatus: 'ready', ragStatus: 'completed' }, true],
      [{ textStatus: 'ready', ragStatus: 'queued' }, false],
    ] as const) {
      dropKeptText.mockClear();
      const { sql } = fakeSql({ claimed: pdf(), settles: false, current });
      await readUploadedFileText(sql, JOB);
      expect(dropKeptText).toHaveBeenCalledTimes(dropped ? 1 : 0);
    }
  });

  it('leaves the file to its index when the knowledge database refuses the text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    keepReadText.mockRejectedValue(new Error('knowledge down'));
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(settled(statements)).toMatchObject({
      status: 'deferred',
      code: 'read_failed',
    });
    expect(warn).toHaveBeenCalledWith(
      '[knowledge] reading a document failed; its index decides instead',
      expect.objectContaining({ error: 'knowledge down' }),
    );
  });

  it('leaves a read already decided alone', async () => {
    const { sql, statements } = fakeSql({ claimed: null });
    await readUploadedFileText(sql, JOB);
    expect(statements).toHaveLength(1);
    expect(getBytes).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['report.pdf', 'application/pdf', READ_WITHOUT_INDEX_MAX_BYTES],
    [
      'ledger.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      READ_WITHOUT_INDEX_MAX_SPREADSHEET_BYTES,
    ],
    ['notes.txt', 'text/plain', READ_WITHOUT_INDEX_MAX_TEXT],
  ])(
    'leaves %s over its cap to the index, which then goes first',
    async (fileName, contentType, cap) => {
      const { sql, statements } = fakeSql({
        claimed: pdf({ fileName, contentType, size: cap + 1 }),
      });
      await readUploadedFileText(sql, JOB);
      expect(getBytes).not.toHaveBeenCalled();
      expect(settled(statements)).toMatchObject({
        status: 'deferred',
        code: 'too_large',
      });
      expect(keepReadText).not.toHaveBeenCalled();
      // A message waits for this index: it goes ahead of other uploads.
      expect(addJobInTx).toHaveBeenCalledWith(
        sql,
        'rag.index_file',
        { fileId: 'file-1' },
        { priority: PRIORITY_ATTACHMENT },
      );
    },
  );

  it('checks the cap again on the bytes that arrive', async () => {
    getBytes.mockResolvedValue(
      new Uint8Array(READ_WITHOUT_INDEX_MAX_BYTES + 1),
    );
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(extractDocument).not.toHaveBeenCalled();
    expect(settled(statements)).toMatchObject({
      status: 'deferred',
      code: 'too_large',
    });
  });

  it('leaves more text than a read keeps to the index, before any scan', async () => {
    extractDocument.mockResolvedValue({
      text: 'x'.repeat(READ_WITHOUT_INDEX_MAX_TEXT + 1),
    });
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(gate).not.toHaveBeenCalled();
    expect(settled(statements)).toMatchObject({
      status: 'deferred',
      code: 'too_much_text',
    });
  });

  it.each([
    ['malformed', 'malformed'],
    ['not_text', 'not_text'],
  ] as const)(
    'records a file that does not read as its type (%s)',
    async (cause, code) => {
      extractDocument.mockRejectedValue(new ExtractionError(cause, 'no'));
      const { sql, statements } = fakeSql({ claimed: pdf() });
      await readUploadedFileText(sql, JOB);
      expect(settled(statements)).toMatchObject({ status: 'unreadable', code });
      expect(keepReadText).not.toHaveBeenCalled();
    },
  );

  it('records empty or vanished bytes as a file with no text', async () => {
    for (const bytes of [null, new Uint8Array(0)]) {
      getBytes.mockResolvedValue(bytes);
      const { sql, statements } = fakeSql({ claimed: pdf() });
      await readUploadedFileText(sql, JOB);
      expect(settled(statements)).toMatchObject({
        status: 'unreadable',
        code: 'empty',
      });
    }
  });

  it.each([
    ['secret-detected', 'secret_detected'],
    ['pii-blocked', 'pii_blocked'],
    ['pii-scan-failed', 'pii_scan_failed'],
  ])(
    'records a refusal by the organization’s checks (%s)',
    async (skipped, code) => {
      gate.mockReturnValue({ kind: 'refused', skipped });
      const { sql, statements } = fakeSql({ claimed: pdf() });
      await readUploadedFileText(sql, JOB);
      expect(settled(statements)).toMatchObject({ status: 'refused', code });
      expect(keepReadText).not.toHaveBeenCalled();
      // The index still runs: it owns the file's index state, and a scan
      // that could not run may run there.
      expect(addJobInTx).toHaveBeenCalledWith(
        sql,
        'rag.index_file',
        { fileId: 'file-1' },
        { priority: PRIORITY_INTERACTIVE },
      );
    },
  );

  it('records a text the policy left empty as a file with no text', async () => {
    gate.mockReturnValue({ kind: 'empty' });
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(settled(statements)).toMatchObject({
      status: 'unreadable',
      code: 'empty',
    });
  });

  it('leaves the file to its index when the policy cannot be read, never reading it unchecked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    readPolicy.mockRejectedValue(new Error('governance unreadable'));
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(gate).not.toHaveBeenCalled();
    expect(settled(statements)).toMatchObject({
      status: 'deferred',
      code: 'read_failed',
    });
    expect(keepReadText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[knowledge] reading a document failed; its index decides instead',
      expect.objectContaining({ fileId: 'file-1' }),
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.index_file',
      { fileId: 'file-1' },
      { priority: PRIORITY_ATTACHMENT },
    );
  });

  it('leaves the file to its index when a parser throws something of its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    extractDocument.mockRejectedValue(new TypeError('zip end not found'));
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, JOB);
    expect(settled(statements)).toMatchObject({
      status: 'deferred',
      code: 'read_failed',
    });
  });

  it('lets pg-boss retry a run it stopped, deciding nothing', async () => {
    const controller = new AbortController();
    extractDocument.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await expect(
      readUploadedFileText(sql, JOB, { signal: controller.signal }),
    ).rejects.toThrow('its job was cancelled');
    expect(settled(statements)).toBeUndefined();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues no index run for a read a reader asked for', async () => {
    const { sql, statements } = fakeSql({ claimed: pdf() });
    await readUploadedFileText(sql, { ...JOB, thenIndex: false });
    expect(settled(statements)).toMatchObject({ status: 'ready' });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues no index run for a file not waiting for one', async () => {
    // Indexed meanwhile, opted out (the statement reads NULL), or deleted.
    for (const options of [
      { ragStatus: 'completed' },
      { ragStatus: null },
      { settles: false },
    ]) {
      addJobInTx.mockClear();
      const { sql } = fakeSql({ claimed: pdf(), ...options });
      await readUploadedFileText(sql, JOB);
      expect(addJobInTx).not.toHaveBeenCalled();
    }
  });
});

describe('requestDocumentRead — a reader asks for a file nothing has read', () => {
  const ASK = { organizationId: 'org-1', storageRef: 's3:tale/acme/9a1b' };

  it('queues the read, without an index run, and says one is coming', async () => {
    const { sql, statements } = fakeSql({
      asked: {
        id: 'file-9',
        fileName: 'lead-verify.txt',
        contentType: 'text/plain',
        textStatus: null,
      },
    });
    await expect(requestDocumentRead(sql, ASK)).resolves.toBe(true);
    expect(statements.map((s) => s.text).join('\n')).toContain(
      "text_status = 'queued'",
    );
    // Behind a person's attachments: an automation fetching its way through
    // a project never holds them up.
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.read_file',
      { fileId: 'file-9', organizationId: 'org-1', thenIndex: false },
      { priority: PRIORITY_INTERACTIVE },
    );
  });

  it.each([
    ['the platform failed the read', 'deferred', 'read_failed'],
    ['the PII scan could not run', 'refused', 'pii_scan_failed'],
  ])(
    'reads again a file whose read %s, once the fault may have passed [CHAT-R48]',
    async (_label, textStatus, textErrorCode) => {
      const old = Date.now() - 5 * 60_000;
      for (const [ragStatus, textReadAtMs, again] of [
        [null, old, true],
        ['failed', old, true],
        [null, Date.now(), false],
        ['queued', old, false],
        ['running', old, false],
      ] as const) {
        addJobInTx.mockClear();
        const { sql } = fakeSql({
          asked: {
            id: 'file-9',
            fileName: 'report.pdf',
            contentType: 'application/pdf',
            textStatus,
            textErrorCode,
            textReadAtMs,
            ragStatus,
          },
        });
        await expect(requestDocumentRead(sql, ASK)).resolves.toBe(again);
        expect(addJobInTx).toHaveBeenCalledTimes(again ? 1 : 0);
      }
    },
  );

  it('reads again a file whose kept text went with its index', async () => {
    const { sql } = fakeSql({
      asked: {
        id: 'file-9',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        textStatus: 'ready',
      },
    });
    await expect(requestDocumentRead(sql, ASK)).resolves.toBe(true);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('queues nothing for a read already coming, and says so', async () => {
    const { sql } = fakeSql({
      asked: {
        id: 'file-9',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        textStatus: 'running',
      },
    });
    await expect(requestDocumentRead(sql, ASK)).resolves.toBe(true);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['a decided read', 'report.pdf', 'application/pdf', 'refused'],
    ['a read left to the index', 'report.pdf', 'application/pdf', 'deferred'],
    ['a file with no text', 'report.pdf', 'application/pdf', 'unreadable'],
    ['a picture', 'photo.png', 'image/png', null],
    ['a recording', 'memo.m4a', 'audio/mp4', null],
    ['a type no extractor reads', 'minutes.doc', 'application/msword', null],
  ])(
    'queues nothing for %s',
    async (_label, fileName, contentType, textStatus) => {
      const { sql } = fakeSql({
        asked: { id: 'file-9', fileName, contentType, textStatus },
      });
      await expect(requestDocumentRead(sql, ASK)).resolves.toBe(false);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it('queues nothing for a ref no live row holds', async () => {
    const { sql } = fakeSql({ asked: null });
    await expect(requestDocumentRead(sql, ASK)).resolves.toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('recoverStuckReads — no message waits on a lost read [CHAT-R47]', () => {
  it('walks the pending reads whose job is gone, or that waited too long', async () => {
    const { sql, statements } = fakeSql({ stuck: [] });
    await expect(recoverStuckReads(sql)).resolves.toBe(0);
    const walk = statements[0]?.text ?? '';
    expect(walk).toContain("fm.text_status IN ('queued', 'running')");
    expect(walk).toContain("j.name = 'rag.read_file'");
    expect(walk).toContain("j.state IN ('created', 'retry', 'active')");
  });

  it('leaves the file to its index, and hands the index on an upload’s read was to queue', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { sql, statements } = fakeSql({ stuck: ['file-1'] });
    await expect(recoverStuckReads(sql)).resolves.toBe(1);
    const settle = statements.find((s) =>
      s.text.includes("SET text_status = 'deferred'"),
    );
    expect(settle?.values).toEqual(['read_failed', 'file-1']);
    expect(settle?.text).toContain("AND text_status IN ('queued', 'running')");
    expect(
      statements.some((s) => s.text.includes('SET rag_queued_at_ms')),
    ).toBe(true);
    // A message waits for this index: it goes ahead of other uploads.
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'rag.index_file',
      { fileId: 'file-1' },
      { priority: PRIORITY_ATTACHMENT },
    );
  });

  it('never doubles an index job another door queued, nor queues one for a file not waiting', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (const options of [
      { indexJobWaiting: true },
      { ragStatus: 'completed' },
      { ragStatus: null },
    ]) {
      addJobInTx.mockClear();
      const { sql } = fakeSql({ stuck: ['file-1'], ...options });
      await expect(recoverStuckReads(sql)).resolves.toBe(1);
      expect(addJobInTx).not.toHaveBeenCalled();
    }
  });

  it('leaves a read that settled meanwhile as it is', async () => {
    const { sql } = fakeSql({ stuck: ['file-1'], settles: false });
    await expect(recoverStuckReads(sql)).resolves.toBe(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('defers a row whose settle fails to the next tick, and settles the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { sql } = fakeSql({ stuck: ['file-1', 'file-2'] });
    const begin = sql.begin.bind(sql);
    let calls = 0;
    Object.assign(sql, {
      begin: (fn: (tx: unknown) => Promise<unknown>) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('lock timeout'))
          : begin(fn as never);
      },
    });
    await expect(recoverStuckReads(sql)).resolves.toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[watchdog] settling a lost document read failed; the next tick tries again',
      expect.objectContaining({ fileId: 'file-1' }),
    );
  });
});
