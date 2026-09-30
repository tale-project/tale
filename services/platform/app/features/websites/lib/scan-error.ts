/**
 * lastSyncError on a website row is an operator dump (sandbox JSON, DNS
 * syscalls). The view dialog shows a one-line reason; the dump stays on
 * `title` for hover.
 */
export type ScanErrorKind =
  | 'runtime'
  | 'dns'
  | 'notInCorpus'
  | 'embedding'
  | 'renderLane'
  | 'timeout'
  | 'generic';

export function classifyScanError(message: string): ScanErrorKind {
  const m = message.toLowerCase();
  if (m.includes('website not found in crawler')) return 'notInCorpus';
  // Before the timeout test: a provider's own words may name one.
  if (m.includes('embedding model could not embed')) return 'embedding';
  // The render lane halted the scan: its egress proxy refused the site, or
  // its browser stopped answering. The pages are not the cause, and what
  // rendered before the halt is stored, so it is neither a scan that did
  // not run nor anything a page row says.
  if (m.includes('the render sandbox')) return 'renderLane';
  if (
    m.includes('sandbox session') ||
    m.includes('tale-sandbox-runtime') ||
    m.includes('docker run')
  ) {
    return 'runtime';
  }
  if (
    m.includes('enotfound') ||
    m.includes('getaddrinfo') ||
    m.includes('does not resolve') ||
    m.includes('dns_failed')
  ) {
    return 'dns';
  }
  if (m.includes('etimedout') || m.includes('timeout')) return 'timeout';
  return 'generic';
}

/**
 * Whether the scan failed as a whole, for a reason no page row carries. A
 * scan that ends on its pages' own failures ("no page could be stored") is
 * explained by the rows; one that the embedding model, the crawler's
 * browser or a missing registration stopped is not, however many pages
 * beside it failed for reasons of their own.
 */
export function isSiteLevelScanError(kind: ScanErrorKind): boolean {
  return (
    kind === 'embedding' ||
    kind === 'runtime' ||
    kind === 'renderLane' ||
    kind === 'notInCorpus'
  );
}

export function scanErrorMessageKey(
  kind: ScanErrorKind,
):
  | 'viewDialog.scanError.runtime'
  | 'viewDialog.scanError.notInCorpus'
  | 'viewDialog.scanError.embedding'
  | 'viewDialog.scanError.generic'
  | 'pagesDialog.errorKind.dnsFailed'
  | 'pagesDialog.errorKind.timeout' {
  switch (kind) {
    case 'runtime':
      return 'viewDialog.scanError.runtime';
    case 'embedding':
      return 'viewDialog.scanError.embedding';
    case 'dns':
      return 'pagesDialog.errorKind.dnsFailed';
    case 'timeout':
      return 'pagesDialog.errorKind.timeout';
    case 'notInCorpus':
      return 'viewDialog.scanError.notInCorpus';
    default:
      return 'viewDialog.scanError.generic';
  }
}

export function scanEmptyMessageKey(
  kind: ScanErrorKind,
):
  | 'viewDialog.scanEmpty.runtime'
  | 'viewDialog.scanEmpty.dns'
  | 'viewDialog.scanEmpty.notInCorpus'
  | 'viewDialog.scanEmpty.embedding'
  | 'viewDialog.scanEmpty.generic' {
  switch (kind) {
    case 'runtime':
      return 'viewDialog.scanEmpty.runtime';
    case 'embedding':
      return 'viewDialog.scanEmpty.embedding';
    case 'dns':
      return 'viewDialog.scanEmpty.dns';
    case 'notInCorpus':
      return 'viewDialog.scanEmpty.notInCorpus';
    default:
      return 'viewDialog.scanEmpty.generic';
  }
}

/** Site-level Error with nothing indexed and no failed page to inspect. */
export function isHollowSiteScan(
  website: {
    status?: string;
    crawledPageCount?: number;
    failedPageCount?: number;
  },
  pages: ReadonlyArray<{ chunks_count: number; fail_count: number }>,
  paused: boolean,
): boolean {
  if (paused) return false;
  if (website.status !== 'error') return false;
  if ((website.crawledPageCount ?? 0) > 0) return false;
  if ((website.failedPageCount ?? 0) > 0) return false;
  return !pages.some((page) => page.chunks_count > 0 || page.fail_count > 0);
}
