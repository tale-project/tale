// @vitest-environment node

import { existsSync } from 'node:fs';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_ROBOTS_POLICY } from '../../../lib/knowledge/crawl-parse';
import { safeFetchToFile } from '../../../lib/net/safe-fetch';
import { extractInHeavySlot } from '../../lib/heavy-slot/documents';
import {
  configureHeavySlot,
  DEFAULT_HEAVY_SLOT_MEMORY_MB,
  heavySlotLoad,
  withHeavySlot,
} from '../../lib/heavy-slot/slot';
import { makeTextPdf } from '../lib/knowledge/extraction/pdf.test-helpers';
import { fetchAndStorePage } from './crawl_action';
import { fetchingToFile } from './crawl_action.test-helpers';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetchToFile: vi.fn(),
}));

// The real reading, watched: what the crawler hands the slot is the point.
vi.mock('../../lib/heavy-slot/documents', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/heavy-slot/documents')>();
  return { ...actual, extractInHeavySlot: vi.fn(actual.extractInHeavySlot) };
});

/**
 * A document a crawled site links to is read in the heavy slot, which reads
 * one file at a time: it waits its turn there. The link that fetched it has
 * a time it must end by, and its job can end under it; the wait ends with
 * either, where it used to go on past both (tale-project/tale#4942).
 */

const DOMAIN = 'www.example.com';
const URL = 'https://www.example.com/handbook.pdf';

/** A corpus double recording every statement with its parameters. */
function corpus(): {
  sql: Sql;
  statements: { text: string; params: unknown[] }[];
} {
  const statements: { text: string; params: unknown[] }[] = [];
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    statements.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    return Promise.resolve([]);
  };
  const sql = {
    unsafe,
    begin: async (run: (tx: { unsafe: typeof unsafe }) => Promise<void>) =>
      run({ unsafe }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const page = { url: URL, content_hash: null, listed: true };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(extractInHeavySlot).mockClear();
  vi.mocked(safeFetchToFile).mockReset();
  vi.mocked(safeFetchToFile).mockImplementation(
    fetchingToFile({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      body: new Uint8Array(makeTextPdf('The employee handbook')),
      finalUrl: URL,
    }),
  );
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAndStorePage — a document that waits for the heavy slot', () => {
  it('reads the document when the slot is free', async () => {
    const { sql } = corpus();
    await expect(
      fetchAndStorePage(sql, DOMAIN, page, EMPTY_ROBOTS_POLICY),
    ).resolves.toMatchObject({ kind: 'stored' });
  });

  it('gives the reading up when its link ends, and writes no failure of the page', async () => {
    let letGo: () => void = () => undefined;
    const holder = withHeavySlot(
      { priority: 'background' },
      () =>
        new Promise<void>((resolve) => {
          letGo = resolve;
        }),
    );
    const link = new AbortController();
    const { sql, statements } = corpus();
    try {
      const fetched = fetchAndStorePage(
        sql,
        DOMAIN,
        page,
        EMPTY_ROBOTS_POLICY,
        undefined,
        { signal: link.signal },
      );
      // The document is fetched and stands in line behind the other file.
      await vi.waitFor(() =>
        expect(heavySlotLoad()).toEqual({ running: 1, waiting: 1 }),
      );
      link.abort(new Error('the link ran out of time'));

      await expect(fetched).resolves.toBe('failed');
      expect(heavySlotLoad()).toEqual({ running: 1, waiting: 0 });
      // The page is not at fault: nothing is recorded against it, and the
      // next link reads it.
      expect(
        statements.filter((statement) =>
          /fail_count|last_error|extraction_failed/.test(
            `${statement.text} ${JSON.stringify(statement.params)}`,
          ),
        ),
      ).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('was given up with its link'),
      );
    } finally {
      letGo();
      await holder;
    }
  });

  it("records a document it could not read as the page's failure, as before", async () => {
    vi.mocked(safeFetchToFile).mockImplementation(
      fetchingToFile({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/pdf' }),
        body: '%PDF-1.7 not really a PDF',
        finalUrl: URL,
      }),
    );
    const { sql, statements } = corpus();
    await expect(
      fetchAndStorePage(sql, DOMAIN, page, EMPTY_ROBOTS_POLICY, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toBe('failed');
    expect(
      statements.some((statement) =>
        JSON.stringify(statement.params).includes('extraction_failed'),
      ),
    ).toBe(true);
  });
});

/**
 * A page's body is fetched into a file of the visit's own and read from
 * there. It used to be held in the crawling process: a document may be
 * 100 MiB, and was there three times over while it was fetched, and twice
 * while it waited for the slot (tale-project/tale#4942).
 */
describe("fetchAndStorePage — where a page's body is kept", () => {
  afterEach(() => {
    configureHeavySlot({ memoryMb: DEFAULT_HEAVY_SLOT_MEMORY_MB });
  });

  /** The site answers the page's fetch with this text, as plain text. */
  const answersText = (text: string | Uint8Array): void => {
    vi.mocked(safeFetchToFile).mockImplementation(
      fetchingToFile({
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
        body: text,
        finalUrl: 'https://www.example.com/notes.txt',
      }),
    );
  };
  const textPage = {
    url: 'https://www.example.com/notes.txt',
    content_hash: null,
    listed: true,
  };

  it('hands the slot the file the body was written to, and removes it when the visit ends', async () => {
    const { sql } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, page, EMPTY_ROBOTS_POLICY),
    ).resolves.toMatchObject({ kind: 'stored' });

    const [source] = vi.mocked(extractInHeavySlot).mock.calls[0] ?? [];
    expect(source).toMatchObject({ kind: 'file' });
    if (source?.kind !== 'file') throw new Error('unreachable');
    // The file the fetch wrote, and nothing of it is left on the disk.
    expect(source.path).toBe(vi.mocked(safeFetchToFile).mock.calls[0]?.[1]);
    expect(existsSync(source.path)).toBe(false);
  });

  it('removes the file of a visit that fails, too', async () => {
    vi.mocked(safeFetchToFile).mockImplementation(
      fetchingToFile({
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        body: 'an error page',
        finalUrl: URL,
      }),
    );
    const { sql } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, page, EMPTY_ROBOTS_POLICY),
    ).resolves.toBe('failed');

    const written = vi.mocked(safeFetchToFile).mock.calls[0]?.[1] ?? '';
    expect(written).not.toBe('');
    expect(existsSync(written)).toBe(false);
  });

  it('stores a page of plain text as the text it is', async () => {
    answersText('Release notes. Enough words to be the text of a page.\n');
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, textPage, EMPTY_ROBOTS_POLICY),
    ).resolves.toMatchObject({ kind: 'stored' });

    expect(
      statements.some((statement) =>
        JSON.stringify(statement.params).includes(
          'Release notes. Enough words to be the text of a page.',
        ),
      ),
    ).toBe(true);
    expect(extractInHeavySlot).not.toHaveBeenCalled();
  });

  // A page that is text already is held by the crawling process as it is,
  // so it is held to what a document's text may come to under the cap.
  it("refuses a page of plain text over what one document's text may come to, in the limit's words", async () => {
    // A cap of 64 MiB leaves a text 16 MiB.
    configureHeavySlot({ memoryMb: 64 });
    answersText(new Uint8Array(16 * 1024 * 1024 + 1).fill(0x61));
    const { sql, statements } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, textPage, EMPTY_ROBOTS_POLICY),
    ).resolves.toBe('failed');

    const recorded = statements
      .map((statement) => JSON.stringify(statement.params))
      .find((params) => params.includes('extraction_failed'));
    expect(recorded).toContain('Text extraction failed for the page');
    expect(recorded).toContain('64 MiB');
    expect(recorded).toContain('HEAVY_SLOT_MEMORY_MB');
  });

  it('takes a page of plain text of exactly that size', async () => {
    configureHeavySlot({ memoryMb: 64 });
    answersText(new Uint8Array(16 * 1024 * 1024).fill(0x61));
    const { sql } = corpus();

    await expect(
      fetchAndStorePage(sql, DOMAIN, textPage, EMPTY_ROBOTS_POLICY),
    ).resolves.toMatchObject({ kind: 'stored' });
  });
});
