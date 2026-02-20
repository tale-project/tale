'use client';

import type { Components } from 'react-markdown';

import { FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import type { Id } from '@/convex/_generated/dataModel';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Button } from '@/app/components/ui/primitives/button';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useListWebsitePagesPaginated } from '../hooks/queries';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- markdownComponents are structurally compatible with react-markdown Components; index signature mismatch is a React type version conflict
const mdComponents = markdownComponents as unknown as Components;

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
      <Skeleton className="h-3 w-2/3" />
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

  const { results, status, loadMore, isLoading } = useListWebsitePagesPaginated(
    {
      websiteId,
      initialNumItems: 10,
    },
  );

  const isDone = status === 'Exhausted';
  const isLoadingMore = status === 'LoadingMore';
  const isLoadingFirst = status === 'LoadingFirstPage';

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={`${t('pagesDialog.title')} — ${websiteDomain}`}
      size="wide"
    >
      <div className="space-y-4">
        {isLoadingFirst && (
          <>
            <PageSkeleton />
            <PageSkeleton />
            <PageSkeleton />
          </>
        )}

        {!isLoadingFirst && results.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-12">
            <FileText className="size-8" />
            <p className="text-sm">{t('pagesDialog.noPages')}</p>
          </div>
        )}

        {results.map((page) => (
          <article
            key={page._id}
            className="border-border rounded-lg border p-4"
          >
            <h3 className="text-foreground mb-1 text-sm font-medium">
              {page.title || page.url}
            </h3>
            {page.title && (
              <p className="text-muted-foreground mb-3 text-xs">{page.url}</p>
            )}
            {page.content ? (
              <div
                className={cn(
                  'text-foreground prose-sm max-w-none text-sm',
                  markdownWrapperStyles,
                )}
              >
                <ReactMarkdown components={mdComponents}>
                  {page.content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs italic">
                {t('pagesDialog.noContent')}
              </p>
            )}
          </article>
        ))}

        {!isDone && !isLoadingFirst && (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadMore(10)}
              disabled={isLoading || isLoadingMore}
            >
              {isLoadingMore ? '...' : t('pagesDialog.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </ViewDialog>
  );
}
