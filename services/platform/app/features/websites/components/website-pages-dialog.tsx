'use client';

import type { Components } from 'react-markdown';

import { FileText } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import type { Id } from '@/convex/_generated/dataModel';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useListWebsitePagesPaginated } from '../hooks/queries';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- markdownComponents are structurally compatible with react-markdown Components; index signature mismatch is a React type version conflict
const mdComponents = markdownComponents as unknown as Components;

const COLLAPSED_MAX_HEIGHT = 256;

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

function CollapsibleMarkdown({ content }: { content: string }) {
  const { t } = useT('websites');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      contentRef.current = node;
      setIsOverflowing(node.scrollHeight > COLLAPSED_MAX_HEIGHT);
    }
  }, []);

  return (
    <div>
      <div
        ref={measureRef}
        className={cn(
          'text-foreground prose-sm max-w-none text-sm',
          markdownWrapperStyles,
          !isExpanded && 'overflow-hidden',
        )}
        style={
          !isExpanded && isOverflowing
            ? { maxHeight: COLLAPSED_MAX_HEIGHT }
            : undefined
        }
      >
        <ReactMarkdown components={mdComponents}>{content}</ReactMarkdown>
      </div>
      {isOverflowing && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-2 cursor-pointer text-xs font-medium transition-colors"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? t('pagesDialog.showLess') : t('pagesDialog.showMore')}
        </button>
      )}
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
          <EmptyState icon={FileText} title={t('pagesDialog.noPages')} />
        )}

        {results.map((page) => (
          <BorderedSection key={page._id} padding={4} gap={2}>
            <Heading level={3} size="sm" weight="medium">
              {page.title || page.url}
            </Heading>
            {page.title && <Text variant="caption">{page.url}</Text>}
            {page.content ? (
              <CollapsibleMarkdown content={page.content} />
            ) : (
              <Text variant="caption" className="italic">
                {t('pagesDialog.noContent')}
              </Text>
            )}
          </BorderedSection>
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
