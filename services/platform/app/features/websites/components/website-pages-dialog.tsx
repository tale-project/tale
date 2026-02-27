'use client';

import { FileText, Search as SearchIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type {
  CrawlerChunk,
  CrawlerPage,
  CrawlerSearchResult,
} from '@/convex/websites/types';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

const PAGE_SIZE = 20;

interface WebsitePagesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  websiteId: Id<'websites'>;
  websiteDomain: string;
}

function PageSkeleton() {
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

function PageRow({
  page,
  websiteId,
}: {
  page: CrawlerPage;
  websiteId: Id<'websites'>;
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
    <div className="flex-1 space-y-1">
      <Heading level={3} size="sm" weight="medium">
        {page.title || page.url}
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
            {page.url}
          </a>
        </Text>
      )}
      <div className="text-muted-foreground flex gap-4 text-xs">
        <span>{t('pagesDialog.wordCount', { count: page.word_count })}</span>
        <span>{t('pagesDialog.chunks', { count: page.chunks_count })}</span>
        {page.last_crawled_at && (
          <span>
            {t('pagesDialog.lastCrawled', {
              date: formatDate(page.last_crawled_at),
            })}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <BorderedSection padding={4} gap={2}>
      <CollapsibleDetails summary={summary} onToggle={handleToggle}>
        <div className="mt-3 space-y-2">
          {isPending && (
            <div className="flex justify-center py-2">
              <Spinner size="sm" />
            </div>
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
    <BorderedSection padding={4} gap={2}>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <Heading level={3} size="sm" weight="medium">
            {result.title || result.url}
          </Heading>
          <Text variant="caption" className="text-muted-foreground shrink-0">
            {t('pagesDialog.searchResultScore', {
              score: (result.score * 100).toFixed(0) + '%',
            })}
          </Text>
        </div>
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
    api.websites.actions.fetchPages,
    {
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
        <div className="flex gap-2">
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
        </div>

        {isSearchMode ? (
          <>
            {isSearching && (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
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
            {isFirstLoad && isPending && (
              <>
                <PageSkeleton />
                <PageSkeleton />
                <PageSkeleton />
              </>
            )}

            {!isFirstLoad && pages.length === 0 && (
              <EmptyState icon={FileText} title={t('pagesDialog.noPages')} />
            )}

            {pages.map((page) => (
              <PageRow key={page.url} page={page} websiteId={websiteId} />
            ))}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadMore}
                  disabled={isPending}
                >
                  {isPending ? '...' : t('pagesDialog.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </ViewDialog>
  );
}
