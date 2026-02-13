'use client';

import { Loader2, RotateCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { RagStatus } from '@/types/documents';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Badge, type BadgeProps } from '@/app/components/ui/feedback/badge';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useRetryRagIndexing } from '../hooks/actions';

interface RagStatusBadgeProps {
  status: RagStatus | undefined;
  /** Timestamp (in seconds) when the document was indexed */
  indexedAt?: number;
  /** Error message (for failed status) */
  error?: string;
  /** Document ID (required for retry functionality) */
  documentId?: string;
}

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const statusConfig: Record<RagStatus, { variant: BadgeVariant }> = {
  pending: { variant: 'blue' },
  queued: { variant: 'blue' },
  running: { variant: 'blue' },
  completed: { variant: 'green' },
  failed: { variant: 'destructive' },
  not_indexed: { variant: 'blue' },
  stale: { variant: 'orange' },
};

export function RagStatusBadge({
  status,
  indexedAt,
  error,
  documentId,
}: RagStatusBadgeProps) {
  const { t } = useT('documents');
  const { formatDate } = useFormatDate();
  const { mutateAsync: retryRagIndexing, isPending: isRetrying } =
    useRetryRagIndexing();
  const [isCompletedDialogOpen, setIsCompletedDialogOpen] = useState(false);
  const [isFailedDialogOpen, setIsFailedDialogOpen] = useState(false);

  // Get translated label for status
  const getStatusLabel = useCallback(
    (s: RagStatus) => {
      const labels: Record<RagStatus, string> = {
        pending: t('rag.status.pending'),
        queued: t('rag.status.queued'),
        running: t('rag.status.indexing'),
        completed: t('rag.status.indexed'),
        failed: t('rag.status.failed'),
        not_indexed: t('rag.status.notIndexed'),
        stale: t('rag.status.needsReindex'),
      };
      return labels[s];
    },
    [t],
  );

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!documentId) {
      toast({
        title: t('rag.toast.documentIdRequired'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const result = await retryRagIndexing({
        documentId: toId<'documents'>(documentId),
      });
      if (result.success) {
        toast({
          title: t('rag.toast.indexingStarted'),
          description: t('rag.toast.indexingQueued'),
        });
      } else {
        toast({
          title: t('rag.toast.retryFailed'),
          description: result.error || t('rag.toast.retryFailedDescription'),
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: t('rag.toast.unexpectedError'),
        variant: 'destructive',
      });
    }
  };

  // Treat undefined/null status as 'not_indexed' - show Index button
  const effectiveStatus: RagStatus = status || 'not_indexed';

  const config = statusConfig[effectiveStatus];

  const retryButton = (
    <Button
      size="icon"
      variant="ghost"
      className="hover:bg-muted size-6 rounded-full p-1"
      onClick={handleRetry}
      disabled={isRetrying || !documentId}
      title={t('rag.retryIndexing')}
      aria-label={t('rag.retryIndexing')}
    >
      {isRetrying ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RotateCw className="size-3.5" />
      )}
    </Button>
  );

  // Show clickable dialog with indexed date for completed status
  if (effectiveStatus === 'completed') {
    const indexedDate = indexedAt ? new Date(indexedAt * 1000) : null;
    const formattedDate = indexedDate
      ? formatDate(indexedDate, 'long')
      : t('rag.status.unknown');

    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCompletedDialogOpen(true);
          }}
          className="cursor-pointer"
          aria-label={t('rag.dialog.indexed.title')}
        >
          <Badge variant={config.variant} dot>
            {getStatusLabel(effectiveStatus)}
          </Badge>
        </button>
        <ViewDialog
          open={isCompletedDialogOpen}
          onOpenChange={setIsCompletedDialogOpen}
          title={t('rag.dialog.indexed.title')}
          description={t('rag.dialog.indexed.description')}
        >
          <div className="mt-4">
            <p className="text-sm">
              <span className="font-medium">
                {t('rag.dialog.indexed.indexedOn')}
              </span>{' '}
              {formattedDate}
            </p>
          </div>
        </ViewDialog>
      </>
    );
  }

  // Show failed status with inline retry button
  if (effectiveStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsFailedDialogOpen(true);
          }}
          className="cursor-pointer"
          aria-label={t('rag.dialog.failed.title')}
        >
          <Badge variant={config.variant} dot>
            {getStatusLabel(effectiveStatus)}
          </Badge>
        </button>
        <ViewDialog
          open={isFailedDialogOpen}
          onOpenChange={setIsFailedDialogOpen}
          title={t('rag.dialog.failed.title')}
          description={t('rag.dialog.failed.description')}
        >
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">
              {t('rag.dialog.failed.errorDetails')}
            </p>
            <pre className="bg-muted max-h-[200px] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {error || t('rag.dialog.failed.unknownError')}
            </pre>
          </div>
        </ViewDialog>
        {retryButton}
      </span>
    );
  }

  // Show stale status with reindex button
  if (effectiveStatus === 'stale') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant={config.variant} dot>
          {getStatusLabel(effectiveStatus)}
        </Badge>
        {retryButton}
      </span>
    );
  }

  // Show not_indexed status (or undefined) with Index button
  if (effectiveStatus === 'not_indexed') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant={config.variant} dot>
          {getStatusLabel(effectiveStatus)}
        </Badge>
        {retryButton}
      </span>
    );
  }

  // Pending, queued, running statuses
  return (
    <Badge variant={config.variant} dot>
      {getStatusLabel(effectiveStatus)}
    </Badge>
  );
}
