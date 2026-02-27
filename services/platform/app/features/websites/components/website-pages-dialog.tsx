'use client';

import { FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { CrawlerPage } from '@/convex/websites/types';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useFormatDate } from '@/app/hooks/use-format-date';
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

export function WebsitePagesDialog({
  isOpen,
  onClose,
  websiteId,
  websiteDomain,
}: WebsitePagesDialogProps) {
  const { t } = useT('websites');
  const { formatDate } = useFormatDate();
  const [pages, setPages] = useState<CrawlerPage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [isFirstLoad, setIsFirstLoad] = useState(true);

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
      },
    },
  );

  useEffect(() => {
    if (isOpen) {
      setPages([]);
      setOffset(0);
      setHasMore(false);
      setIsFirstLoad(true);
      fetchPages({ websiteId, offset: 0, limit: PAGE_SIZE });
    }
  }, [isOpen, websiteId, fetchPages]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchPages({ websiteId, offset: nextOffset, limit: PAGE_SIZE });
  }, [offset, websiteId, fetchPages]);

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={`${t('pagesDialog.title')} — ${websiteDomain}`}
      size="wide"
    >
      <div className="space-y-4">
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
          <BorderedSection key={page.url} padding={4} gap={2}>
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
                >
                  {page.url}
                </a>
              </Text>
            )}
            <div className="text-muted-foreground flex gap-4 text-xs">
              <span>
                {t('pagesDialog.wordCount', { count: page.word_count })}
              </span>
              <span>
                {t('pagesDialog.chunks', { count: page.chunks_count })}
              </span>
              {page.last_crawled_at && (
                <span>
                  {t('pagesDialog.lastCrawled', {
                    date: formatDate(page.last_crawled_at),
                  })}
                </span>
              )}
            </div>
          </BorderedSection>
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
      </div>
    </ViewDialog>
  );
}
