import { describe, expect, it, vi } from 'vitest';

import {
  crawlDocumentMaxBytes,
  DEFAULT_CRAWL_DOCUMENT_MAX_BYTES,
  MIN_CRAWL_DOCUMENT_MAX_BYTES,
} from './crawl_limits';

describe('crawlDocumentMaxBytes', () => {
  it('reads the default when the variable is unset or empty', () => {
    const warn = vi.fn();
    expect(crawlDocumentMaxBytes({}, warn)).toBe(
      DEFAULT_CRAWL_DOCUMENT_MAX_BYTES,
    );
    expect(
      crawlDocumentMaxBytes({ KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES: '' }, warn),
    ).toBe(DEFAULT_CRAWL_DOCUMENT_MAX_BYTES);
    expect(
      crawlDocumentMaxBytes({ KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES: '  ' }, warn),
    ).toBe(DEFAULT_CRAWL_DOCUMENT_MAX_BYTES);
    expect(warn).not.toHaveBeenCalled();
  });

  it('takes a whole number of bytes at or above the floor', () => {
    const warn = vi.fn();
    expect(
      crawlDocumentMaxBytes(
        { KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES: '52428800' },
        warn,
      ),
    ).toBe(50 * 1024 * 1024);
    expect(
      crawlDocumentMaxBytes(
        {
          KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES: String(
            MIN_CRAWL_DOCUMENT_MAX_BYTES,
          ),
        },
        warn,
      ),
    ).toBe(MIN_CRAWL_DOCUMENT_MAX_BYTES);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['abc', '1.5', '-1', '0', '1024', '25MiB'])(
    'refuses %s with a warning and reads the default',
    (raw) => {
      const warn = vi.fn();
      expect(
        crawlDocumentMaxBytes(
          { KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES: raw },
          warn,
        ),
      ).toBe(DEFAULT_CRAWL_DOCUMENT_MAX_BYTES);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES=${raw}`),
      );
    },
  );
});
