'use client';

import { Badge } from '@tale/ui/badge';
import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { EmptyState } from '@tale/ui/empty-state';
import { Heading } from '@tale/ui/heading';
import { Grid, HStack, Row } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { FileText, Search as SearchIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import type {
  CrawlerChunk,
  CrawlerPage,
  CrawlerSearchResult,
} from '@/convex/websites/types';
import { useT } from '@/lib/i18n/client';

const PAGE_SIZE = 20;

const statusVariant = {
  active: 'green',
  scanning: 'blue',
  idle: 'outline',
  error: 'destructive',
  deleting: 'destructive',
} as const;

interface ViewWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

const PLACEHOLDER_PAGE: CrawlerPage = {
  url: 'https://example.com/placeholder',
  title: 'Placeholder page title',
  word_count: 0,
  status: 'idle',
  content_hash: null,
  last_crawled_at: null,
  discovered_at: null,
  chunks_count: 0,
  indexed: false,
};

function PageRow({
  page,
  websiteId,
}: {
  page: CrawlerPage;
  websiteId: Doc<'websites'>['_id'];
}) {
  const { t } = useT('websites');
  const { formatDate } = useFormatDate();
  const [chunks, setChunks] = useState<CrawlerChunk[] | null>(null);

  const { mutate: fetchChunks, isPending } = useConvexAction(
    api.websites.actions.fetchChunks,
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

  const summary = (
    <div className="min-w-0 flex-1 space-y-1">
      <Heading level={3} size="sm" weight="medium" className="break-words">
        <SkeletonBox>{page.title || page.url}</SkeletonBox>
      </Heading>
      {page.title && (
        <Text variant="caption">
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <SkeletonBox>{page.url}</SkeletonBox>
          </a>
        </Text>
      )}
      <Row align="stretch" className="text-muted-foreground text-xs">
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
          <span>
            {t('pagesDialog.lastCrawled', {
              date: formatDate(page.last_crawled_at),
            })}
          </span>
        )}
      </Row>
    </div>
  );

  return (
    <BorderedSection>
      <CollapsibleDetails summary={summary} onToggle={handleToggle}>
        <div className="mt-3 space-y-2">
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
    </BorderedSection>
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

export function ViewWebsiteDialog({
  isOpen,
  onClose,
  website,
}: ViewWebsiteDialogProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('websites');

  const [pages, setPages] = useState<CrawlerPage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CrawlerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const isSearchMode = activeQuery.length > 0;

  const { mutate: fetchPages, isPending } = useConvexAction(
    api.websites.actions.fetchPages,
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

  const { mutate: searchContent } = useConvexAction(
    api.websites.actions.searchContent,
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

  const items = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('viewDialog.domain'),
        value: <Text>{website.domain}</Text>,
      },
      {
        label: t('viewDialog.status'),
        value: (
          <Row gap={2} wrap>
            <Badge
              variant={
                website.status && website.status in statusVariant
                  ? statusVariant[website.status]
                  : 'outline'
              }
              dot
            >
              {(website.status &&
                (
                  {
                    idle: t('filter.status.idle'),
                    scanning: t('filter.status.scanning'),
                    active: t('filter.status.active'),
                    error: t('filter.status.error'),
                    deleting: t('filter.status.deleting'),
                  } satisfies Record<string, string>
                )[website.status]) ||
                website.status ||
                t('viewDialog.unknown')}
            </Badge>
            {website.status === 'error' && website.metadata?.lastSyncError && (
              <Text variant="caption" className="text-destructive">
                {String(website.metadata.lastSyncError)}
              </Text>
            )}
          </Row>
        ),
      },
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
        value: website.lastScannedAt ? (
          <CopyableTimestamp date={website.lastScannedAt} preset="long" />
        ) : (
          <Text>{t('viewDialog.notScannedYet')}</Text>
        ),
      },
      {
        label: t('viewDialog.titleField'),
        value: <Text>{website.title || '-'}</Text>,
        colSpan: 2,
      },
      {
        label: t('viewDialog.description'),
        value: (
          <Text className="whitespace-pre-wrap">
            {website.description || '-'}
          </Text>
        ),
        colSpan: 2,
      },
      {
        label: t('viewDialog.created'),
        value: (
          <Text>{formatDate(new Date(website._creationTime), 'long')}</Text>
        ),
      },
    ],
    [website, t, formatDate, scanIntervals],
  );

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={t('viewDialog.title')}
      size="wide"
    >
      <StatGrid items={items} />

      <div className="mt-6 space-y-4">
        <HStack justify="between" align="center">
          <Heading level={2} size="sm" weight="semibold">
            {t('pagesDialog.title')}
          </Heading>
          <Text variant="caption">
            {website.crawledPageCount ?? 0} {t('indexed').toLowerCase()}
          </Text>
        </HStack>

        <Row gap={2} align="stretch">
          <SearchInput
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('pagesDialog.searchPlaceholder')}
            aria-label={t('pagesDialog.searchPlaceholder')}
            wrapperClassName="flex-1"
          />
          <Button
            variant="secondary"
            size="default"
            onClick={triggerSearch}
            disabled={!searchQuery.trim() || isSearching}
          >
            <SearchIcon className="size-4" />
          </Button>
        </Row>

        {isSearchMode ? (
          <>
            {isSearching && (
              <Row gap={0} align="stretch" justify="center" className="py-4">
                <Spinner size="sm" />
              </Row>
            )}

            {!isSearching && searchResults.length === 0 && (
              <EmptyState
                icon={SearchIcon}
                title={t('pagesDialog.noSearchResults')}
              />
            )}

            {searchResults.map((result, idx) => (
              <SearchResultItem
                key={`${result.url}-${result.chunk_index}-${idx}`}
                result={result}
              />
            ))}
          </>
        ) : (
          <>
            {!isFirstLoad && pages.length === 0 && (
              <EmptyState icon={FileText} title={t('pagesDialog.noPages')} />
            )}

            <Skeletonize loading={isFirstLoad && isPending}>
              <Grid sm={2} xl={3} gap={3}>
                {(isFirstLoad && isPending
                  ? [
                      { ...PLACEHOLDER_PAGE, url: 'placeholder-1' },
                      { ...PLACEHOLDER_PAGE, url: 'placeholder-2' },
                      { ...PLACEHOLDER_PAGE, url: 'placeholder-3' },
                    ]
                  : pages
                ).map((page) => (
                  <PageRow key={page.url} page={page} websiteId={website._id} />
                ))}
              </Grid>
            </Skeletonize>

            {hasMore && (
              <Row gap={0} align="stretch" justify="center" className="pt-2">
                <Button
                  variant="secondary"
                  onClick={loadMore}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Spinner size="sm" />
                  ) : (
                    t('pagesDialog.loadMore')
                  )}
                </Button>
              </Row>
            )}
          </>
        )}
      </div>
    </ViewDialog>
  );
}
