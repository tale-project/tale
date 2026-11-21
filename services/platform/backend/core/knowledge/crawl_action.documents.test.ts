// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_ROBOTS_POLICY } from '../../../lib/knowledge/crawl-parse';
import { safeFetchBinary } from '../../../lib/net/safe-fetch';
import { heavySlotLoad, withHeavySlot } from '../../lib/heavy-slot/slot';
import { makeTextPdf } from '../lib/knowledge/extraction/pdf.test-helpers';
import { fetchAndStorePage } from './crawl_action';

vi.mock('../../../lib/net/safe-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetchBinary: vi.fn(),
}));

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
  vi.mocked(safeFetchBinary).mockReset();
  vi.mocked(safeFetchBinary).mockResolvedValue({
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/pdf' }),
    body: new Blob([new Uint8Array(makeTextPdf('The employee handbook'))]),
    finalUrl: URL,
  });
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
    vi.mocked(safeFetchBinary).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      body: new Blob([new TextEncoder().encode('%PDF-1.7 not really a PDF')]),
      finalUrl: URL,
    });
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
