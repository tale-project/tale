'use client';

import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { EmptyState } from '@tale/ui/empty-state';
import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { SearchInput } from '@tale/ui/search-input';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { FileText, Pencil, Search as SearchIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
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

import {
  classifyScanError,
  isHollowSiteScan,
  scanEmptyMessageKey,
  scanErrorMessageKey,
} from '../lib/scan-error';
import { isScanPaused } from '../lib/scan-paused';
import {
  useWebsiteEditForm,
  WEBSITE_EDIT_FORM_ID,
  WebsiteEditFields,
} from './website-edit-form';

const PAGE_SIZE = 20;

const FAILURE_KIND_KEYS = {
  dns_failed: 'pagesDialog.errorKind.dnsFailed',
  timeout: 'pagesDialog.errorKind.timeout',
  insecure_public_http: 'pagesDialog.errorKind.insecurePublicHttp',
  private_ip: 'pagesDialog.errorKind.privateIp',
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

interface ViewWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
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

function websiteHref(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function WebsiteStatusBadge({ website }: { website: WebsiteDoc }) {
  const { t } = useT('websites');
  if (isScanPaused(website)) {
    return (
      <Badge variant="orange" dot>
        {t('scanPausedBadge')}
      </Badge>
    );
  }
  const status = website.status;
  const labels: Record<string, string> = {
    idle: t('filter.status.idle'),
    scanning: t('filter.status.scanning'),
    active: t('filter.status.active'),
    error: t('filter.status.error'),
    deleting: t('filter.status.deleting'),
  };
  return (
    <Badge
      variant={
        status && status in statusVariant ? statusVariant[status] : 'outline'
      }
      dot
    >
      {(status && labels[status]) || status || t('viewDialog.unknown')}
    </Badge>
  );
}

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
  const canInspect = page.chunks_count > 0;
  const label = page.title || page.url;

  const identity = (
    <Text className="min-w-0 text-sm wrap-break-word">
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
    </Text>
  );

  const meta =
    failedCaption === null ? (
      <Row gap={3} align="center" className="text-muted-foreground text-xs">
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
        {page.last_crawled_at && (
          <span className="whitespace-nowrap">
            {t('pagesDialog.lastCrawled', {
              date: formatDate(page.last_crawled_at, 'medium'),
            })}
          </span>
        )}
      </Row>
    ) : (
      <Text
        variant="caption"
        className="text-muted-foreground"
        title={page.last_error ?? undefined}
      >
        {failedCaption}
      </Text>
    );

  const row = (
    <div className="min-w-0 flex-1 space-y-0.5">
      <div className="flex items-start justify-between gap-2">
        {identity}
        {failedCaption !== null && (
          <Badge variant="destructive" className="mt-0.5 shrink-0">
            {t('pagesDialog.failed')}
          </Badge>
        )}
      </div>
      {page.title ? (
        <Text variant="caption" className="break-all">
          {page.url}
        </Text>
      ) : null}
      {meta}
    </div>
  );

  if (!canInspect) {
    return <div className="py-2">{row}</div>;
  }

  return (
    <div className="py-2">
      <CollapsibleDetails
        variant="compact"
        summary={row}
        onToggle={handleToggle}
      >
        <div className="mt-2 space-y-2">
          {isPending && (
            <Row gap={0} align="stretch" justify="center" className="py-2">
              <Spinner size="sm" />
            </Row>
          )}
          {chunks?.length === 0 && (
            <Text variant="muted" className="text-sm">
              {t('pagesDialog.noChunks')}
            </Text>
          )}
          {chunks?.map((chunk) => (
            <div key={chunk.chunk_index} className="bg-muted/50 rounded-md p-3">
              <Text variant="caption" className="mb-1 block font-medium">
                {t('pagesDialog.chunkIndex', { index: chunk.chunk_index + 1 })}
              </Text>
              <Text className="max-h-48 overflow-y-auto text-sm wrap-break-word whitespace-pre-wrap">
                {chunk.chunk_content}
              </Text>
            </div>
          ))}
        </div>
      </CollapsibleDetails>
    </div>
  );
}

function SearchResultItem({ result }: { result: CrawlerSearchResult }) {
  const { t } = useT('websites');

  return (
    <BorderedSection>
      <div className="space-y-2">
        <Heading
          level={3}
          size="sm"
          weight="medium"
          className="min-w-0 break-words"
        >
          {result.title || result.url}
        </Heading>
        <Text variant="caption">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all hover:underline"
          >
            {result.url}
          </a>
        </Text>
        <div className="bg-muted/50 rounded-md p-3">
          <Text variant="caption" className="mb-1 block font-medium">
            {t('pagesDialog.chunkIndex', { index: result.chunk_index + 1 })}
          </Text>
          <Text className="max-h-48 overflow-y-auto text-sm wrap-break-word whitespace-pre-wrap">
            {result.chunk_content}
          </Text>
        </div>
      </div>
    </BorderedSection>
  );
}

/**
 * Website card (row click). View title is the site name (or the domain if
 * there is no title) — identity first, same as a product or contact. Status
 * sits on the title row as a badge; the scan dump stays on `title` for
 * operators, never as a red paragraph.
 *
 * Edit morphs in place on `size="default"`: the title becomes "Edit
 * website", the badge/domain/pencil drop, and Cancel/Save take the footer.
 * Closing the overlay to open a form overlay would blink the backdrop and
 * read as a second dialog. Table-row Edit still uses the standalone
 * `WebsiteEditDialog` (a real overlay enter).
 *
 * Pages keep a two-slot header — **Pages** left, indexed/failed tally
 * right — so a short inventory does not look untitled. Search is not a
 * live list filter: Enter runs BM25 on this domain's indexed chunks;
 * failed pages with 0 chunks never match.
 */
export function ViewWebsiteDialog({
  isOpen,
  onClose,
  website,
}: ViewWebsiteDialogProps) {
  const { t } = useT('websites');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canEdit = ability.can('write', 'knowledgeWrite');
  const [isEditing, setIsEditing] = useState(false);
  const {
    errors: editErrors,
    isPending: isEditPending,
    seed,
    setValue: setEditValue,
    scanInterval,
    scanIntervalOptions,
    submit: submitEdit,
  } = useWebsiteEditForm(website, () => setIsEditing(false));

  const [pages, setPages] = useState<CrawlerPage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CrawlerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const isSearchMode = activeQuery.length > 0;
  const title = website.title?.trim() || website.domain;
  const description = website.description?.trim() ?? '';
  const showDomainLink = Boolean(website.title?.trim());
  const paused = isScanPaused(website);
  const lastSyncError =
    website.status === 'error' &&
    !paused &&
    typeof website.metadata?.lastSyncError === 'string'
      ? website.metadata.lastSyncError
      : null;
  const scanErrorKind =
    lastSyncError === null ? 'generic' : classifyScanError(lastSyncError);
  const hollowScan = isHollowSiteScan(website, pages, paused);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        seed();
        setIsEditing(false);
        onClose();
      }
    },
    [onClose, seed],
  );

  const startEdit = useCallback(() => {
    seed();
    setIsEditing(true);
  }, [seed]);

  const cancelEdit = useCallback(() => {
    seed();
    setIsEditing(false);
  }, [seed]);

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

  const headerActions = (
    <>
      <WebsiteStatusBadge website={website} />
      {canEdit && !isEditing ? (
        <IconButton
          icon={Pencil}
          size="sm"
          aria-label={tCommon('actions.edit')}
          onClick={startEdit}
        />
      ) : null}
    </>
  );

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={isEditing ? t('editWebsite') : title}
      description={
        isEditing || !showDomainLink ? undefined : (
          <a
            href={websiteHref(website.domain)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {website.domain}
          </a>
        )
      }
      size="default"
      headerActions={isEditing ? undefined : headerActions}
      customFooter={
        isEditing ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelEdit}
              disabled={isEditPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="submit"
              form={WEBSITE_EDIT_FORM_ID}
              disabled={isEditPending}
              isLoading={isEditPending}
            >
              {tCommon('actions.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      {isEditing ? (
        <form
          id={WEBSITE_EDIT_FORM_ID}
          onSubmit={submitEdit}
          className="space-y-4"
          noValidate
        >
          <WebsiteEditFields
            website={website}
            scanInterval={scanInterval}
            scanIntervalOptions={scanIntervalOptions}
            errors={editErrors}
            isPending={isEditPending}
            setValue={setEditValue}
          />
        </form>
      ) : (
        <Stack gap={4}>
          {description.length > 0 && (
            <Text className="leading-relaxed">{description}</Text>
          )}
          {paused && (
            <Text variant="caption" className="text-muted-foreground">
              {t('viewDialog.scanPausedNotice')}
            </Text>
          )}
          {hollowScan ? (
            <div title={lastSyncError ?? undefined}>
              <EmptyState
                title={t(scanErrorMessageKey(scanErrorKind))}
                description={t(scanEmptyMessageKey(scanErrorKind))}
                className="py-6"
              />
            </div>
          ) : (
            <>
              {lastSyncError !== null && (
                <Text
                  variant="caption"
                  className="text-muted-foreground"
                  title={lastSyncError}
                >
                  {t(scanErrorMessageKey(scanErrorKind))}
                </Text>
              )}

              <Stack gap={2} aria-label={t('pagesDialog.title')}>
                {/* Enter submits; keystrokes only update the field. Filtering
                    the in-memory page list would miss chunk hits and pretend
                    failed URLs were searchable. */}
                <SearchInput
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t('pagesDialog.searchPlaceholder')}
                  aria-label={t('pagesDialog.searchPlaceholder')}
                  className="w-full max-w-none"
                  wrapperClassName="w-full"
                />

                {isSearchMode ? (
                  <>
                    {isSearching && (
                      <Row
                        gap={0}
                        align="stretch"
                        justify="center"
                        className="py-4"
                      >
                        <Spinner size="sm" />
                      </Row>
                    )}

                    {!isSearching && searchResults.length === 0 && (
                      <EmptyState
                        icon={SearchIcon}
                        title={t('pagesDialog.noSearchResults')}
                        description={t(
                          'pagesDialog.noSearchResultsDescription',
                        )}
                      />
                    )}

                    {searchResults.map((result, idx) => (
                      <SearchResultItem
                        key={`${result.url}-${result.chunk_index}-${idx}`}
                        result={result}
                      />
                    ))}
                  </>
                ) : !isFirstLoad && pages.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title={t('pagesDialog.noPages')}
                    description={t('pagesDialog.noPagesDescription')}
                  />
                ) : (
                  <>
                    <Skeletonize loading={isFirstLoad && isPending}>
                      <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                        {/* Label owns the left; the count is meta, not a
                            second title. One line even when failed is 0. */}
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <Text className="text-sm font-medium">
                            {t('pagesDialog.listTitle')}
                          </Text>
                          <Text
                            variant="caption"
                            className="shrink-0 text-right"
                          >
                            {website.crawledPageCount ?? 0}{' '}
                            {t('indexed').toLowerCase()}
                            {(website.failedPageCount ?? 0) > 0 &&
                              ` · ${t('pagesDialog.failedPages', { count: website.failedPageCount ?? 0 })}`}
                          </Text>
                        </div>
                        {(isFirstLoad && isPending
                          ? [
                              { ...PLACEHOLDER_PAGE, url: 'placeholder-1' },
                              { ...PLACEHOLDER_PAGE, url: 'placeholder-2' },
                              { ...PLACEHOLDER_PAGE, url: 'placeholder-3' },
                            ]
                          : pages
                        ).map((page) => (
                          <div key={page.url} className="px-3">
                            <PageRow page={page} websiteId={website._id} />
                          </div>
                        ))}
                      </div>
                    </Skeletonize>

                    {hasMore && (
                      <Row
                        gap={0}
                        align="stretch"
                        justify="center"
                        className="pt-2"
                      >
                        <Button
                          variant="secondary"
                          onClick={loadMore}
                          isLoading={isPending}
                        >
                          {t('pagesDialog.loadMore')}
                        </Button>
                      </Row>
                    )}
                  </>
                )}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </ViewDialog>
  );
}
