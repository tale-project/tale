import {
  parseWebsiteEmbeddingFailure,
  type WebsiteEmbeddingFailureClass,
} from '@/backend/core/websites/scan_scheduling';

/**
 * lastSyncError on a website row is what the scan threw: the embedding
 * provider's own sentence behind a prefix that names the model, or an
 * operator dump (sandbox JSON, DNS syscalls). The view dialog leads with a
 * one-line reason and shows the sentence beneath it; a dump is folded under
 * "Technical details".
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

/**
 * What a source missing from the crawler is told: a whole site is registered
 * again by its next scan, so it only has to wait for one (or start one); a
 * URL list cannot be, because its URLs were the registration, and has to be
 * deleted and added again. A row without a kind is a whole site.
 */
type SourceKind = 'site' | 'list' | undefined;

export function scanErrorMessageKey(
  kind: ScanErrorKind,
  source?: SourceKind,
):
  | 'viewDialog.scanError.runtime'
  | 'viewDialog.scanError.notInCorpus'
  | 'viewDialog.scanError.notInCorpusSite'
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
      if (source === 'list') return 'viewDialog.scanError.notInCorpus';
      return 'viewDialog.scanError.notInCorpusSite';
    default:
      return 'viewDialog.scanError.generic';
  }
}

export function scanEmptyMessageKey(
  kind: ScanErrorKind,
  source?: SourceKind,
):
  | 'viewDialog.scanEmpty.runtime'
  | 'viewDialog.scanEmpty.dns'
  | 'viewDialog.scanEmpty.notInCorpus'
  | 'viewDialog.scanEmpty.notInCorpusSite'
  | 'viewDialog.scanEmpty.generic' {
  switch (kind) {
    case 'runtime':
      return 'viewDialog.scanEmpty.runtime';
    case 'dns':
      return 'viewDialog.scanEmpty.dns';
    case 'notInCorpus':
      if (source === 'list') return 'viewDialog.scanEmpty.notInCorpus';
      return 'viewDialog.scanEmpty.notInCorpusSite';
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

export type EmbeddingFailureClass = WebsiteEmbeddingFailureClass;

/**
 * Why the embedding model could not embed, as the crawl action recorded it
 * in the reason; null for any other reason, and for one written before the
 * class was recorded.
 */
export function embeddingFailureClass(
  message: string,
): EmbeddingFailureClass | null {
  return parseWebsiteEmbeddingFailure(message)?.failureClass ?? null;
}

/**
 * What to do about an embedding failure, by its class: whom to ask and
 * where. Without a class, the model's setting is the one place to look.
 */
export function embeddingHintKey(
  failureClass: EmbeddingFailureClass | null,
):
  | 'viewDialog.scanDetail.credential'
  | 'viewDialog.scanDetail.credit'
  | 'viewDialog.scanDetail.unresolved'
  | 'viewDialog.scanDetail.dimension'
  | 'viewDialog.scanDetail.throttled'
  | 'viewDialog.scanDetail.upstream'
  | 'viewDialog.scanDetail.generic' {
  switch (failureClass) {
    case 'credential':
      return 'viewDialog.scanDetail.credential';
    case 'credit':
      return 'viewDialog.scanDetail.credit';
    case 'unresolved':
      return 'viewDialog.scanDetail.unresolved';
    case 'dimension':
      return 'viewDialog.scanDetail.dimension';
    case 'throttled':
      return 'viewDialog.scanDetail.throttled';
    case 'upstream':
      return 'viewDialog.scanDetail.upstream';
    default:
      return 'viewDialog.scanDetail.generic';
  }
}

/**
 * The stored reason as the dialog shows it: an embedding failure's own
 * sentence, without the prefix and class the one-liner already said; any
 * other reason as it was stored. Empty when there is nothing to show.
 */
export function scanErrorDetail(message: string): string {
  const embedding = parseWebsiteEmbeddingFailure(message);
  if (embedding !== null) return embedding.sentence;
  return message.trim();
}
