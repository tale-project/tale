import { describe, expect, it } from 'vitest';

import {
  WEBSITE_EMBEDDING_FAILED_PREFIX,
  WEBSITE_NOT_IN_CORPUS_MESSAGE,
} from '@/backend/core/websites/scan_scheduling';
import { renderLaneHaltMessage } from '@/lib/knowledge/crawl-parse';

import {
  classifyScanError,
  isHollowSiteScan,
  isSiteLevelScanError,
  scanEmptyMessageKey,
  scanErrorMessageKey,
} from './scan-error';

describe('isSiteLevelScanError', () => {
  it('holds for what stops a scan as a whole', () => {
    expect(
      (['embedding', 'runtime', 'renderLane', 'notInCorpus'] as const).map(
        isSiteLevelScanError,
      ),
    ).toEqual([true, true, true, true]);
  });

  it('does not hold for what the page rows carry themselves', () => {
    expect(
      (['dns', 'timeout', 'generic'] as const).map(isSiteLevelScanError),
    ).toEqual([false, false, false]);
  });
});

describe('classifyScanError', () => {
  // The render lane's own halts end a scan with a sentence for operators.
  // They read as the last scan not finishing, told beside the pages.
  it('maps a render lane halt, whichever the cause', () => {
    expect(
      classifyScanError(
        renderLaneHaltMessage(
          {
            reason: 'egress_proxy',
            error: 'page.goto: net::ERR_TUNNEL_CONNECTION_FAILED',
          },
          'docs.example.com',
        ),
      ),
    ).toBe('renderLane');
    expect(
      classifyScanError(
        renderLaneHaltMessage(
          { reason: 'browser', error: 'Target page has been closed; Timeout' },
          'docs.example.com',
        ),
      ),
    ).toBe('renderLane');
    expect(scanErrorMessageKey('renderLane')).toBe(
      'viewDialog.scanError.generic',
    );
    expect(scanEmptyMessageKey('renderLane')).toBe(
      'viewDialog.scanEmpty.generic',
    );
  });

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

  it('maps a missing corpus row, as rows carry it now and as they did', () => {
    expect(classifyScanError(WEBSITE_NOT_IN_CORPUS_MESSAGE)).toBe(
      'notInCorpus',
    );
    expect(
      classifyScanError(
        'Website not found in crawler. Please delete and re-add it.',
      ),
    ).toBe('notInCorpus');
  });

  // A whole site is registered again by its next scan; only a URL list,
  // whose URLs were the registration, has to be deleted and added again.
  it('tells a missing site and a missing URL list apart', () => {
    expect(scanErrorMessageKey('notInCorpus', 'site')).toBe(
      'viewDialog.scanError.notInCorpusSite',
    );
    expect(scanEmptyMessageKey('notInCorpus', 'site')).toBe(
      'viewDialog.scanEmpty.notInCorpusSite',
    );
    // A row from before sources had a kind is a whole site.
    expect(scanErrorMessageKey('notInCorpus')).toBe(
      'viewDialog.scanError.notInCorpusSite',
    );
    expect(scanEmptyMessageKey('notInCorpus')).toBe(
      'viewDialog.scanEmpty.notInCorpusSite',
    );
    expect(scanErrorMessageKey('notInCorpus', 'list')).toBe(
      'viewDialog.scanError.notInCorpus',
    );
    expect(scanEmptyMessageKey('notInCorpus', 'list')).toBe(
      'viewDialog.scanEmpty.notInCorpus',
    );
  });

  // A rejected embedding key left "401 User not found." on the site and
  // the page could only say the last scan did not finish.
  it("maps the crawler's embedding failure, whatever the provider said", () => {
    expect(
      classifyScanError(
        `${WEBSITE_EMBEDDING_FAILED_PREFIX}: 401 User not found.`,
      ),
    ).toBe('embedding');
    expect(
      classifyScanError(
        `${WEBSITE_EMBEDDING_FAILED_PREFIX}: Request timeout after 30s`,
      ),
    ).toBe('embedding');
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
