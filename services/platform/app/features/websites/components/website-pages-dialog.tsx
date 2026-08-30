'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { EmptyState } from '@tale/ui/empty-state';
import { Heading } from '@tale/ui/heading';
import { Row } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { FileText, Search as SearchIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type {
  CrawlerChunk,
  CrawlerPage,
  CrawlerSearchResult,
} from '@/convex/websites/types';
import { useT } from '@/lib/i18n/client';

const PAGE_SIZE = 20;

interface WebsitePagesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  websiteId: string;
  websiteDomain: string;
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
  websiteId: string;
}) {
  const { t } = useT('websites');
  const { formatDate } = useFormatDate();
  const [chunks, setChunks] = useState<CrawlerChunk[] | null>(null);

  const { mutate: fetchChunks, isPending } = useConvexAction(
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

  const summary = (
    <div className="flex-1 space-y-1">
      <Heading level={3} size="sm" weight="medium">
        <SkeletonBox>{page.title || page.url}</SkeletonBox>
      </Heading>
      {page.title && (
        <Text variant="caption">
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
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
              <Text className="text-sm break-words whitespace-pre-wrap">
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
        <Heading level={3} size="sm" weight="medium">
          {result.title || result.url}
        </Heading>
        <Text variant="caption">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {result.url}
          </a>
        </Text>
        <div className="bg-muted/50 rounded-md p-3">
          <Text variant="caption" className="mb-1 block font-medium">
            {t('pagesDialog.chunkIndex', { index: result.chunk_index + 1 })}
          </Text>
          <Text className="text-sm break-words whitespace-pre-wrap">
            {result.chunk_content}
          </Text>
        </div>
      </div>
    </BorderedSection>
  );
}

export function WebsitePagesDialog({
  isOpen,
  onClose,
  websiteId,
  websiteDomain,
}: WebsitePagesDialogProps) {
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

  const { mutate: searchContent } = useConvexAction(
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
      fetchPages({ websiteId, offset: 0, limit: PAGE_SIZE });
    }
  }, [isOpen, websiteId, fetchPages]);

  const triggerSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (!query) return;
    setActiveQuery(query);
    setIsSearching(true);
    searchContent({ websiteId, query, limit: 20 });
  }, [searchQuery, websiteId, searchContent]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchPages({ websiteId, offset: nextOffset, limit: PAGE_SIZE });
  }, [offset, websiteId, fetchPages]);

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

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={`${t('pagesDialog.title')} — ${websiteDomain}`}
      size="wide"
    >
      <div className="min-h-[400px] space-y-4">
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

            <Skeletonize
              loading={isFirstLoad && isPending}
              className="contents"
            >
              {(isFirstLoad && isPending
                ? [
                    { ...PLACEHOLDER_PAGE, url: 'placeholder-1' },
                    { ...PLACEHOLDER_PAGE, url: 'placeholder-2' },
                    { ...PLACEHOLDER_PAGE, url: 'placeholder-3' },
                  ]
                : pages
              ).map((page) => (
                <PageRow key={page.url} page={page} websiteId={websiteId} />
              ))}
            </Skeletonize>

            {hasMore && (
              <Row gap={0} align="stretch" justify="center" className="pt-2">
                <Button
                  variant="secondary"
                  onClick={loadMore}
                  disabled={isPending}
                >
                  {isPending ? '...' : t('pagesDialog.loadMore')}
                </Button>
              </Row>
            )}
          </>
        )}
      </div>
    </ViewDialog>
  );
}
