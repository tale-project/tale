import { describe, expect, it } from 'vitest';

import { classifyScanError, isHollowSiteScan } from './scan-error';

describe('classifyScanError', () => {
  it('maps a sandbox/docker dump to runtime', () => {
    expect(
      classifyScanError(
        'sandbox session create failed (502): {"error":"create_failed","message":"docker run (session) failed: Unable to find image \'tale-sandbox-runtime:latest\'"}',
      ),
    ).toBe('runtime');
  });

  it('maps a DNS dump to dns', () => {
    expect(
      classifyScanError(
        'Host does not resolve: docs.example.com (getaddrinfo ENOTFOUND docs.example.com)',
      ),
    ).toBe('dns');
  });

  it('maps a missing corpus row', () => {
    expect(
      classifyScanError(
        'Website not found in crawler. Please delete and re-add it.',
      ),
    ).toBe('notInCorpus');
  });

  it('falls back for an unknown dump', () => {
    expect(classifyScanError('something exploded')).toBe('generic');
  });
});

describe('isHollowSiteScan', () => {
  const errorSite = {
    status: 'error',
    crawledPageCount: 0,
    failedPageCount: 0,
  };

  it('is true when the scan never indexed or failed a page', () => {
    expect(
      isHollowSiteScan(errorSite, [{ chunks_count: 0, fail_count: 0 }], false),
    ).toBe(true);
  });

  it('is false when a page failed', () => {
    expect(
      isHollowSiteScan(errorSite, [{ chunks_count: 0, fail_count: 1 }], false),
    ).toBe(false);
  });

  it('is false when the site has indexed pages', () => {
    expect(
      isHollowSiteScan({ ...errorSite, crawledPageCount: 1 }, [], false),
    ).toBe(false);
  });
});
