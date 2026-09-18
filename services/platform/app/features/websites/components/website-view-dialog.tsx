'use client';

import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { CopyableField } from '@tale/ui/copyable-field';
import { EmptyState } from '@tale/ui/empty-state';
import {
  EntityViewDialog,
  EntityViewSection,
} from '@tale/ui/entity/entity-view-dialog';
import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { SearchInput } from '@tale/ui/search-input';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import type { StatGridItem } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { FileText, Globe, Play, Search as SearchIcon } from 'lucide-react';
import {
  type RefObject,
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import {
  PAGE_FAILURE_KINDS,
  type CrawlerChunk,
  type CrawlerPage,
  type CrawlerSearchResult,
} from '@/backend/core/websites/types';
import { useT } from '@/lib/i18n/client';

import { useResumeScanning } from '../hooks/mutations';
import { indexedPageCount } from '../lib/indexed-page-count';
import {
  classifyScanError,
  isHollowSiteScan,
  scanEmptyMessageKey,
  scanErrorMessageKey,
} from '../lib/scan-error';
import { isScanPaused } from '../lib/scan-paused';
import { WebsiteEditDialog } from './website-edit-dialog';

const PAGE_SIZE = 20;

const FAILURE_KIND_KEYS = {
  dns_failed: 'pagesDialog.errorKind.dnsFailed',
  timeout: 'pagesDialog.errorKind.timeout',
  insecure_public_http: 'pagesDialog.errorKind.insecurePublicHttp',
  private_ip: 'pagesDialog.errorKind.privateIp',
  host_not_allowed: 'pagesDialog.errorKind.hostNotAllowed',
  http_error: 'pagesDialog.errorKind.httpError',
  network_error: 'pagesDialog.errorKind.networkError',
  render_failed: 'pagesDialog.errorKind.renderFailed',
  extraction_failed: 'pagesDialog.errorKind.extractionFailed',
  invalid_url: 'pagesDialog.errorKind.invalidUrl',
  unsupported_protocol: 'pagesDialog.errorKind.unsupportedProtocol',
  redirect_missing_location: 'pagesDialog.errorKind.redirectMissingLocation',
  redirect_limit_exceeded: 'pagesDialog.errorKind.redirectLimitExceeded',
  response_too_large: 'pagesDialog.errorKind.responseTooLarge',
  response_too_small: 'pagesDialog.errorKind.responseTooSmall',
  aborted: 'pagesDialog.errorKind.aborted',
  tls_error: 'pagesDialog.errorKind.tlsError',
  unsupported_content: 'pagesDialog.errorKind.unsupportedContent',
  robots_noindex: 'pagesDialog.errorKind.robotsNoindex',
} as const satisfies Record<
  (typeof PAGE_FAILURE_KINDS)[number],
  `pagesDialog.errorKind.${string}`
>;

function isFailureKind(kind: string): kind is keyof typeof FAILURE_KIND_KEYS {
  return Object.hasOwn(FAILURE_KIND_KEYS, kind);
}

function pageFailureCaption(
  page: CrawlerPage,
  t: (key: string, values?: Record<string, unknown>) => string,
): string | null {
  if (page.fail_count <= 0) return null;
  if (page.last_error === null && page.last_error_kind === null) return null;
  const kind = page.last_error_kind;
  const reason =
    kind !== null && isFailureKind(kind)
      ? t(FAILURE_KIND_KEYS[kind])
      : (page.last_error ?? t('pagesDialog.errorKind.fallback'));
  if (page.fail_count > 1) {
    return t('pagesDialog.lastError', {
      count: page.fail_count,
      message: reason,
    });
  }
  return reason;
}

const statusVariant = {
  active: 'green',
  scanning: 'blue',
  error: 'destructive',
  deleting: 'destructive',
} as const;

interface WebsiteViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

const PLACEHOLDER_PAGE: CrawlerPage = {
  url: 'https://example.com/placeholder',
  title: 'Placeholder page title',
  word_count: 0,
  status: 'discovered',
  content_hash: null,
  last_crawled_at: null,
  discovered_at: null,
  chunks_count: 0,
  indexed: false,
  fail_count: 0,
  last_error: null,
  last_error_kind: null,
  last_error_at: null,
};

function PageRow({
  page,
  websiteId,
}: {
  page: CrawlerPage;
  websiteId: WebsiteDoc['_id'];
}) {
  const { t } = useT('websites');
  const { formatDate } = useFormatDate();
  const [chunks, setChunks] = useState<CrawlerChunk[] | null>(null);

  const { mutate: fetchChunks, isPending } = useBackendAction(
    'websites/actions:fetchChunks',
    {
      onSuccess: (data) => setChunks(data.chunks),
    },
  );

  const handleToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (e.currentTarget.open && chunks === null && !isPending) {
        fetchChunks({ websiteId, url: page.url });
      }
    },
    [chunks, isPending, fetchChunks, websiteId, page.url],
  );

  const failedCaption = pageFailureCaption(page, t);
  const label = page.title || page.url;

  const summary = (
    <Stack gap={1} className="min-w-0 flex-1">
      <Heading level={4} size="sm" weight="medium" className="wrap-anywhere">
        <SkeletonBox>
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {label}
          </a>
        </SkeletonBox>
      </Heading>
      {page.title ? (
        <Text variant="caption">
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="wrap-anywhere hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <SkeletonBox>{page.url}</SkeletonBox>
          </a>
        </Text>
      ) : null}
      <Row gap={3} wrap className="text-muted-foreground text-xs">
        {failedCaption === null ? (
          <>
            <span>
              <SkeletonBox>
                {t('pagesDialog.wordCount', { count: page.word_count })}
              </SkeletonBox>
            </span>
            <span>
              <SkeletonBox>
                {t('pagesDialog.chunks', { count: page.chunks_count })}
              </SkeletonBox>
            </span>
          </>
        ) : (
          <Badge variant="destructive">{t('pagesDialog.failed')}</Badge>
        )}
        {page.last_crawled_at && (
          <span>
            {t('pagesDialog.lastCrawled', {
              date: formatDate(page.last_crawled_at),
            })}
          </span>
        )}
      </Row>
      {failedCaption !== null && (
        <Text
          variant="caption"
          className="text-muted-foreground wrap-anywhere"
          title={page.last_error ?? undefined}
        >
          {failedCaption}
        </Text>
      )}
    </Stack>
  );

  return (
    <BorderedSection>
      <CollapsibleDetails summary={summary} onToggle={handleToggle}>
        <Stack gap={2} className="mt-3">
          {isPending && (
            <Row gap={0} justify="center" className="py-2">
              <Spinner size="sm" />
            </Row>
          )}
          {chunks?.length === 0 && (
            <Text variant="muted">{t('pagesDialog.noChunks')}</Text>
          )}
          {chunks?.map((chunk) => (
            <div key={chunk.chunk_index} className="bg-muted/50 rounded-md p-3">
              <Text variant="caption" className="mb-1 block font-medium">
                {t('pagesDialog.chunkIndex', { index: chunk.chunk_index + 1 })}
              </Text>
              <Text className="max-h-48 overflow-y-auto text-sm wrap-anywhere whitespace-pre-wrap">
                {chunk.chunk_content}
              </Text>
            </div>
          ))}
        </Stack>
      </CollapsibleDetails>
    </BorderedSection>
  );
}

function SearchResultItem({ result }: { result: CrawlerSearchResult }) {
  const { t } = useT('websites');

  return (
    <BorderedSection>
      <Stack gap={2}>
        <Heading level={4} size="sm" weight="medium" className="wrap-anywhere">
          {result.title || result.url}
        </Heading>
        <Text variant="caption">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="wrap-anywhere hover:underline"
          >
            {result.url}
          </a>
        </Text>
        <div className="bg-muted/50 rounded-md p-3">
          <Text variant="caption" className="mb-1 block font-medium">
            {t('pagesDialog.chunkIndex', { index: result.chunk_index + 1 })}
          </Text>
          <Text className="max-h-48 overflow-y-auto text-sm wrap-anywhere whitespace-pre-wrap">
            {result.chunk_content}
          </Text>
        </div>
      </Stack>
    </BorderedSection>
  );
}

export function WebsiteViewDialog({
  isOpen,
  onClose,
  website,
  restoreFocusRef,
}: WebsiteViewDialogProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('websites');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const { mutate: resumeScanning } = useResumeScanning();
  const paused = isScanPaused(website);

  const [pages, setPages] = useState<CrawlerPage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CrawlerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const isSearchMode = activeQuery.length > 0;

  const { mutate: fetchPages, isPending } = useBackendAction(
    'websites/actions:fetchPages',
    {
      errorToast: false,
      onSuccess: (data) => {
        if (data.offset === 0) {
          setPages(data.pages);
        } else {
          setPages((prev) => [...prev, ...data.pages]);
        }
        setHasMore(data.hasMore);
        setIsFirstLoad(false);
      },
      onError: () => {
        setIsFirstLoad(false);
        toast({ title: t('toast.fetchPagesError'), variant: 'destructive' });
      },
    },
  );

  const { mutate: searchContent } = useBackendAction(
    'websites/actions:searchContent',
    {
      errorToast: false,
      onSuccess: (data) => {
        setSearchResults(data.results);
        setIsSearching(false);
      },
      onError: () => {
        setIsSearching(false);
        toast({ title: t('toast.searchError'), variant: 'destructive' });
      },
    },
  );

  useEffect(() => {
    if (isOpen) {
      setPages([]);
      setOffset(0);
      setHasMore(false);
      setIsFirstLoad(true);
      setSearchQuery('');
      setActiveQuery('');
      setSearchResults([]);
      fetchPages({ websiteId: website._id, offset: 0, limit: PAGE_SIZE });
    }
  }, [isOpen, website._id, fetchPages]);

  const triggerSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    setActiveQuery(query);
    setIsSearching(true);
    searchContent({ websiteId: website._id, query, limit: 20 });
  }, [searchQuery, website._id, searchContent]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchPages({
      websiteId: website._id,
      offset: nextOffset,
      limit: PAGE_SIZE,
    });
  }, [offset, website._id, fetchPages]);

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    if (!e.target.value.trim()) {
      setActiveQuery('');
      setSearchResults([]);
      setIsSearching(false);
    }
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerSearch();
      }
    },
    [triggerSearch],
  );

  const scanIntervals: Record<string, string> = useMemo(
    () => ({
      '60m': t('scanIntervals.1hour'),
      '6h': t('scanIntervals.6hours'),
      '12h': t('scanIntervals.12hours'),
      '1d': t('scanIntervals.1day'),
      '5d': t('scanIntervals.5days'),
      '7d': t('scanIntervals.7days'),
      '30d': t('scanIntervals.30days'),
    }),
    [t],
  );

  const statusLabel =
    (website.status &&
      (
        {
          scanning: t('filter.status.scanning'),
          active: t('filter.status.active'),
          error: t('filter.status.error'),
          deleting: t('filter.status.deleting'),
        } satisfies Record<string, string>
      )[website.status]) ||
    website.status ||
    t('viewDialog.unknown');

  const lastSyncError =
    typeof website.metadata?.lastSyncError === 'string'
      ? website.metadata.lastSyncError
      : null;
  const scanErrorKind =
    lastSyncError === null ? 'generic' : classifyScanError(lastSyncError);
  const hollowScan = isHollowSiteScan(website, pages, paused);

  // Paused (repeated failures to reach the knowledge database) wins over the
  // stored `error` status — this site stopped retrying and needs a manual
  // resume, which the notice explains. Scan dumps stay on `title`, never in
  // the facts grid.
  const statusNotice = paused ? t('viewDialog.scanPausedNotice') : null;

  const facts = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('viewDialog.scanInterval'),
        value: (
          <Text>
            {scanIntervals[website.scanInterval] || website.scanInterval}
          </Text>
        ),
      },
      {
        label: t('viewDialog.lastScanned'),
        value: (
          <Text>
            {website.lastScannedAt
              ? formatDate(new Date(website.lastScannedAt), 'long')
              : t('viewDialog.notScannedYet')}
          </Text>
        ),
      },
      {
        label: t('viewDialog.created'),
        value: (
          <Text>{formatDate(new Date(website._creationTime), 'long')}</Text>
        ),
      },
      ...(statusNotice
        ? [
            {
              label: t('viewDialog.status'),
              value: (
                <Text
                  className={
                    paused ? 'text-muted-foreground' : 'text-destructive'
                  }
                >
                  {statusNotice}
                </Text>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
      ...(website.description
        ? [
            {
              label: t('viewDialog.descriptionField'),
              value: (
                <Text className="leading-relaxed whitespace-pre-wrap">
                  {website.description}
                </Text>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
      {
        label: t('viewDialog.websiteId'),
        value: <CopyableField value={website._id} />,
        colSpan: 2,
      },
    ],
    [website, t, formatDate, scanIntervals, statusNotice, paused],
  );

  const failedPageCount = website.failedPageCount ?? 0;

  return (
    <EntityViewDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewDialog.title')}
      description={t('viewDialog.description')}
      name={website.domain}
      summary={website.title}
      icon={Globe}
      badges={
        paused ? (
          <Badge variant="orange" dot>
            {t('scanPausedBadge')}
          </Badge>
        ) : (
          <Badge
            variant={
              website.status && website.status in statusVariant
                ? statusVariant[website.status]
                : 'outline'
            }
            dot
          >
            {statusLabel}
          </Badge>
        )
      }
      edit={
        canWrite
          ? {
              label: tCommon('actions.edit'),
              render: ({ onBack, onDone }) => (
                <WebsiteEditDialog
                  isOpen
                  onClose={onBack}
                  onSaved={onDone}
                  restoreFocusRef={restoreFocusRef}
                  website={website}
                />
              ),
            }
          : undefined
      }
      actions={[
        {
          // Only offered while the crawler has paused this site: clears the
          // pause and starts a scan right away, as the row menu does.
          key: 'resume',
          label: t('resumeScanning'),
          icon: Play,
          onClick: () => resumeScanning({ websiteId: website._id }),
          visible: canWrite && paused,
        },
      ]}
      facts={facts}
      restoreFocusRef={restoreFocusRef}
    >
      {hollowScan ? (
        <div title={lastSyncError ?? undefined}>
          <EmptyState
            title={t(scanErrorMessageKey(scanErrorKind))}
            description={t(scanEmptyMessageKey(scanErrorKind))}
            className="py-6"
          />
        </div>
      ) : (
        <EntityViewSection
          title={t('pagesDialog.title')}
          meta={
            <>
              {indexedPageCount(website)} {t('indexed').toLowerCase()}
              {failedPageCount > 0 &&
                ` · ${t('pagesDialog.failedPages', { count: failedPageCount })}`}
            </>
          }
        >
          {lastSyncError !== null && !paused ? (
            <Text
              variant="caption"
              className="text-muted-foreground"
              title={lastSyncError}
            >
              {t(scanErrorMessageKey(scanErrorKind))}
            </Text>
          ) : null}
          <Row gap={2}>
            <SearchInput
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('pagesDialog.searchPlaceholder')}
              aria-label={t('pagesDialog.searchPlaceholder')}
              wrapperClassName="flex-1"
              className="max-w-none"
            />
            <IconButton
              icon={SearchIcon}
              variant="secondary"
              onClick={triggerSearch}
              disabled={!searchQuery.trim() || isSearching}
              aria-label={t('pagesDialog.searchPlaceholder')}
            />
          </Row>

          {isSearchMode ? (
            <Stack gap={2}>
              {isSearching && (
                <Row gap={0} justify="center" className="py-4">
                  <Spinner size="sm" />
                </Row>
              )}

              {!isSearching && searchResults.length === 0 && (
                <EmptyState
                  icon={SearchIcon}
                  title={t('pagesDialog.noSearchResults')}
                  description={t('pagesDialog.noSearchResultsDescription')}
                />
              )}

              {searchResults.map((result, idx) => (
                <SearchResultItem
                  key={`${result.url}-${result.chunk_index}-${idx}`}
                  result={result}
                />
              ))}
            </Stack>
          ) : (
            <Stack gap={2}>
              {!isFirstLoad && pages.length === 0 && (
                <EmptyState
                  icon={FileText}
                  title={t('pagesDialog.noPages')}
                  description={t('pagesDialog.noPagesDescription')}
                />
              )}

              <Skeletonize loading={isFirstLoad && isPending}>
                <Stack gap={2}>
                  {(isFirstLoad && isPending
                    ? [
                        { ...PLACEHOLDER_PAGE, url: 'placeholder-1' },
                        { ...PLACEHOLDER_PAGE, url: 'placeholder-2' },
                        { ...PLACEHOLDER_PAGE, url: 'placeholder-3' },
                      ]
                    : pages
                  ).map((page) => (
                    <PageRow
                      key={page.url}
                      page={page}
                      websiteId={website._id}
                    />
                  ))}
                </Stack>
              </Skeletonize>

              {hasMore && (
                <Row gap={0} justify="center" className="pt-2">
                  <Button
                    variant="secondary"
                    onClick={loadMore}
                    isLoading={isPending}
                  >
                    {t('pagesDialog.loadMore')}
                  </Button>
                </Row>
              )}
            </Stack>
          )}
        </EntityViewSection>
      )}
    </EntityViewDialog>
  );
}
